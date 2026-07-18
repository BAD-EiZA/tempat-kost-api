import { Inject, Injectable } from '@nestjs/common';
import { InvoiceStatus, LeaseStatus, RoomStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../common/auth/auth.types';
import {
  JOB_QUEUE_PORT,
  type JobQueuePort,
} from '../common/ports/job-queue.port';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    @Inject(JOB_QUEUE_PORT) private readonly queue: JobQueuePort,
  ) {}

  async overview(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);

    const [
      properties,
      rooms,
      occupiedRooms,
      tenants,
      activeLeases,
      openInvoices,
      overdueInvoices,
      pendingPayments,
      expensesPaid,
    ] = await Promise.all([
      this.prisma.property.count({
        where: { workspaceId, status: { not: 'ARCHIVED' } },
      }),
      this.prisma.room.count({
        where: { workspaceId, status: { not: RoomStatus.INACTIVE } },
      }),
      this.prisma.room.count({
        where: { workspaceId, status: RoomStatus.OCCUPIED },
      }),
      this.prisma.tenant.count({
        where: { workspaceId, status: 'ACTIVE' },
      }),
      this.prisma.lease.count({
        where: { workspaceId, status: LeaseStatus.ACTIVE },
      }),
      this.prisma.invoice.aggregate({
        where: {
          workspaceId,
          status: {
            in: [
              InvoiceStatus.OPEN,
              InvoiceStatus.PARTIALLY_PAID,
              InvoiceStatus.PENDING_VERIFICATION,
              InvoiceStatus.OVERDUE,
            ],
          },
        },
        _sum: { total: true, amountPaid: true },
        _count: true,
      }),
      this.prisma.invoice.count({
        where: { workspaceId, status: InvoiceStatus.OVERDUE },
      }),
      this.prisma.payment.count({
        where: { workspaceId, status: 'PENDING' },
      }),
      this.prisma.expense.aggregate({
        where: { workspaceId, status: 'PAID' },
        _sum: { amount: true },
      }),
    ]);

    const billed = Number(openInvoices._sum.total ?? 0);
    const collected = Number(openInvoices._sum.amountPaid ?? 0);
    const occupancyRate =
      rooms > 0 ? Math.round((occupiedRooms / rooms) * 1000) / 10 : 0;

    return {
      properties,
      rooms,
      occupiedRooms,
      availableRooms: Math.max(rooms - occupiedRooms, 0),
      occupancyRate,
      activeTenants: tenants,
      activeLeases,
      openInvoiceCount: openInvoices._count,
      outstanding: Math.max(billed - collected, 0),
      overdueInvoices,
      pendingPayments,
      expensesPaid: Number(expensesPaid._sum.amount ?? 0),
    };
  }

  async aging(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    const now = new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        workspaceId,
        status: {
          in: [
            InvoiceStatus.OPEN,
            InvoiceStatus.PARTIALLY_PAID,
            InvoiceStatus.PENDING_VERIFICATION,
            InvoiceStatus.OVERDUE,
          ],
        },
      },
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        amountPaid: true,
        dueDate: true,
        status: true,
        tenant: { select: { fullName: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 500,
    });

    const buckets = {
      current: { count: 0, amount: 0 },
      d1_30: { count: 0, amount: 0 },
      d31_60: { count: 0, amount: 0 },
      d61_90: { count: 0, amount: 0 },
      d90_plus: { count: 0, amount: 0 },
    };

    const rows = invoices.map((inv) => {
      const outstanding = Math.max(
        Number(inv.total) - Number(inv.amountPaid),
        0,
      );
      const days = Math.floor(
        (now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      let bucket: keyof typeof buckets = 'current';
      if (days > 90) bucket = 'd90_plus';
      else if (days > 60) bucket = 'd61_90';
      else if (days > 30) bucket = 'd31_60';
      else if (days > 0) bucket = 'd1_30';
      buckets[bucket].count += 1;
      buckets[bucket].amount += outstanding;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        tenant: inv.tenant?.fullName ?? '—',
        status: inv.status,
        dueDate: inv.dueDate.toISOString().slice(0, 10),
        daysPastDue: days,
        outstanding,
        bucket,
      };
    });

    return { buckets, rows };
  }

  async pnl(
    auth: AuthUser,
    workspaceId: string,
    from?: string,
    to?: string,
  ) {
    await this.workspaces.assertMember(auth, workspaceId);
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date();
    const [payments, expenses] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          workspaceId,
          status: 'CONFIRMED',
          paidAt: { gte: fromDate, lte: toDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.expense.aggregate({
        where: {
          workspaceId,
          status: 'PAID',
          expenseDate: { gte: fromDate, lte: toDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    const income = Number(payments._sum.amount ?? 0);
    const expense = Number(expenses._sum.amount ?? 0);
    return {
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      income,
      expense,
      net: income - expense,
      paymentCount: payments._count,
      expenseCount: expenses._count,
    };
  }

  async occupancyTrend(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    const rooms = await this.prisma.room.groupBy({
      by: ['status'],
      where: { workspaceId, status: { not: 'INACTIVE' } },
      _count: true,
    });
    const byStatus = Object.fromEntries(
      rooms.map((r) => [r.status, r._count]),
    );
    const total = rooms.reduce((s, r) => s + r._count, 0);
    const occupied = Number(byStatus['OCCUPIED'] ?? 0);
    return {
      byStatus,
      total,
      occupied,
      available: Number(byStatus['AVAILABLE'] ?? 0),
      occupancyRate: total ? Math.round((occupied / total) * 1000) / 10 : 0,
    };
  }

  async exportCsv(
    auth: AuthUser,
    workspaceId: string,
    kind: 'invoices' | 'payments' | 'tenants' | 'expenses',
  ) {
    await this.workspaces.assertMember(auth, workspaceId);
    let rows: string[][] = [];
    if (kind === 'invoices') {
      const data = await this.prisma.invoice.findMany({
        where: { workspaceId },
        include: { tenant: true },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      });
      rows = [
        ['invoiceNumber', 'status', 'tenant', 'total', 'amountPaid', 'dueDate'],
        ...data.map((i) => [
          i.invoiceNumber,
          i.status,
          i.tenant?.fullName ?? '',
          String(i.total),
          String(i.amountPaid),
          i.dueDate.toISOString().slice(0, 10),
        ]),
      ];
    } else if (kind === 'payments') {
      const data = await this.prisma.payment.findMany({
        where: { workspaceId },
        include: { tenant: true },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      });
      rows = [
        ['paymentNumber', 'status', 'method', 'tenant', 'amount', 'paidAt'],
        ...data.map((p) => [
          p.paymentNumber,
          p.status,
          p.method,
          p.tenant?.fullName ?? '',
          String(p.amount),
          p.paidAt?.toISOString().slice(0, 10) ?? '',
        ]),
      ];
    } else if (kind === 'tenants') {
      const data = await this.prisma.tenant.findMany({
        where: { workspaceId },
        take: 2000,
      });
      rows = [
        ['fullName', 'phone', 'email', 'status'],
        ...data.map((t) => [
          t.fullName,
          t.phone ?? '',
          t.email ?? '',
          t.status,
        ]),
      ];
    } else {
      const data = await this.prisma.expense.findMany({
        where: { workspaceId },
        take: 2000,
      });
      rows = [
        ['category', 'amount', 'status', 'expenseDate', 'description'],
        ...data.map((e) => [
          e.category,
          String(e.amount),
          e.status,
          e.expenseDate.toISOString().slice(0, 10),
          e.description ?? '',
        ]),
      ];
    }
    const csv = rows
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');
    const rowCount = Math.max(rows.length - 1, 0);
    const jobId = randomUUID();
    await this.queue.enqueue(
      'reports',
      'export.csv',
      {
        workspaceId,
        kind,
        rowCount,
        csvPreview: csv.slice(0, 500),
      },
      { idempotencyKey: `export-${workspaceId}-${kind}-${jobId}` },
    );
    return {
      kind,
      csv,
      rowCount,
      jobId,
      async: true,
      note: 'CSV inline + queued to outbox for durable audit',
    };
  }
}
