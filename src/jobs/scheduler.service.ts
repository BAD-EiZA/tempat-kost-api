import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus, LeaseStatus, Prisma } from '@prisma/client';
import { CrmService } from '../crm/crm.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly crm: CrmService,
  ) {}

  async runInvoiceScheduler() {
    const leases = await this.prisma.lease.findMany({
      where: { status: LeaseStatus.ACTIVE },
      include: { tenant: true },
    });

    let created = 0;
    const today = new Date();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    for (const lease of leases) {
      const invoiceNumber = `INV-${period}-${lease.leaseNumber}`;
      let invoice = await this.prisma.invoice.findUnique({
        where: {
          workspaceId_invoiceNumber: {
            workspaceId: lease.workspaceId,
            invoiceNumber,
          },
        },
      });
      if (!invoice) {
        const dueDate = new Date(
          today.getFullYear(),
          today.getMonth(),
          lease.dueDay,
        );
        if (dueDate < today) {
          dueDate.setMonth(dueDate.getMonth() + 1);
        }

        const amount = new Prisma.Decimal(lease.rentAmount);
        invoice = await this.prisma.invoice.create({
          data: {
            workspaceId: lease.workspaceId,
            propertyId: lease.propertyId,
            tenantId: lease.tenantId,
            leaseId: lease.id,
            invoiceNumber,
            type: 'RENT',
            status: InvoiceStatus.OPEN,
            issueDate: today,
            dueDate,
            subtotal: amount,
            total: amount,
            issuedAt: today,
            items: {
              create: [
                {
                  description: `Sewa ${period} · ${lease.leaseNumber}`,
                  quantity: 1,
                  unitPrice: amount,
                  amount,
                },
              ],
            },
          },
        });
        created += 1;
      }

      await this.notifications.notifyTenantPortal(
        lease.tenantId,
        'Tagihan baru',
        `Tagihan ${invoiceNumber} telah diterbitkan`,
        'invoice',
        invoice.id,
      );
    }

    this.logger.log(`invoice-scheduler created=${created}`);
    return { created, scanned: leases.length };
  }

  async runReminderScheduler() {
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.OPEN, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lte: soon },
      },
      include: { tenant: true },
      take: 200,
    });

    let sent = 0;
    for (const inv of invoices) {
      if (!inv.tenantId) continue;
      const delivered = await this.notifications.notifyTenantPortal(
        inv.tenantId,
        'Pengingat tagihan',
        `${inv.invoiceNumber} jatuh tempo ${inv.dueDate.toISOString().slice(0, 10)}`,
        'invoice',
        inv.id,
      );
      if (delivered) sent += 1;
    }
    return { sent };
  }

  async runLeaseExpiry() {
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const leases = await this.prisma.lease.findMany({
      where: {
        status: LeaseStatus.ACTIVE,
        endDate: { lte: in30, gte: new Date() },
      },
    });
    let marked = 0;
    for (const lease of leases) {
      await this.prisma.lease.update({
        where: { id: lease.id },
        data: { status: LeaseStatus.ENDING_SOON },
      });
      marked += 1;
    }
    return { marked };
  }

  async runSubscriptionCheck() {
    const now = new Date();
    const expired = await this.prisma.workspaceSubscription.updateMany({
      where: {
        status: 'TRIALING',
        trialEndsAt: { lt: now },
      },
      data: { status: 'SUSPENDED' },
    });
    return { suspendedTrials: expired.count };
  }

  async runBookingExpiry() {
    return this.crm.expireBookings();
  }

  async runRecurringExpenses() {
    const today = new Date();
    const due = await this.prisma.recurringExpense.findMany({
      where: { isActive: true, nextDate: { lte: today } },
      take: 100,
    });
    let created = 0;
    for (const r of due) {
      await this.prisma.expense.create({
        data: {
          workspaceId: r.workspaceId,
          propertyId: r.propertyId,
          category: r.category,
          vendor: r.vendor,
          expenseDate: today,
          amount: r.amount,
          description: r.description ?? `Recurring: ${r.category}`,
          status: 'DRAFT',
        },
      });
      const next = new Date(r.nextDate);
      if (r.frequency === 'weekly') next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      await this.prisma.recurringExpense.update({
        where: { id: r.id },
        data: { nextDate: next },
      });
      created += 1;
    }
    return { created };
  }

  /** Drain unpublished outbox with retry + DLQ (failedAt after 5 attempts). */
  async runOutboxDrain() {
    const pending = await this.prisma.domainOutbox.findMany({
      where: { publishedAt: null, failedAt: null, attempts: { lt: 5 } },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    let processed = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        const payload = row.payload as Record<string, unknown>;
        if (row.eventType === 'export.csv') {
          this.logger.debug(
            `export.csv workspace=${payload.workspaceId} rows=${payload.rowCount}`,
          );
        }
        if (row.eventType === 'notification.email') {
          this.logger.log(
            `[outbox-email] to=${payload.to} subject=${payload.subject}`,
          );
        }
        if (row.eventType === 'notification.reminder') {
          const wsId = String(payload.workspaceId ?? '');
          if (wsId) {
            await this.notifications.notifyWorkspaceOwners(
              wsId,
              String(payload.title ?? 'Reminder'),
              String(payload.body ?? ''),
              typeof payload.entityType === 'string'
                ? payload.entityType
                : undefined,
              typeof payload.entityId === 'string'
                ? payload.entityId
                : undefined,
            );
          }
        }
        await this.prisma.domainOutbox.update({
          where: { id: row.id },
          data: {
            publishedAt: new Date(),
            attempts: { increment: 1 },
            lastError: null,
          },
        });
        processed += 1;
      } catch (e) {
        const attempts = row.attempts + 1;
        const dead = attempts >= 5;
        await this.prisma.domainOutbox.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: String(e).slice(0, 500),
            failedAt: dead ? new Date() : null,
          },
        });
        failed += 1;
        this.logger.warn(`outbox fail ${row.id} attempt=${attempts}: ${String(e)}`);
      }
    }
    return { scanned: pending.length, processed, failed };
  }
}
