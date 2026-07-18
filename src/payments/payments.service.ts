import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
    private readonly receipts: ReceiptsService,
    private readonly ai: AiService,
  ) {}

  private money(n: number | string | Prisma.Decimal): Prisma.Decimal {
    return new Prisma.Decimal(n);
  }

  private async nextPaymentNumber(workspaceId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.payment.count({ where: { workspaceId } });
    return `PAY-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  private invoiceStatusAfterPaid(
    total: Prisma.Decimal,
    amountPaid: Prisma.Decimal,
  ): InvoiceStatus {
    if (amountPaid.greaterThanOrEqualTo(total)) return InvoiceStatus.PAID;
    if (amountPaid.greaterThan(0)) return InvoiceStatus.PARTIALLY_PAID;
    return InvoiceStatus.OPEN;
  }

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'payment',
      'view',
    );
    return this.prisma.payment.findMany({
      where: {
        workspaceId,
        ...this.workspaces.propertyIdFilter(membership),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { id: true, fullName: true } },
        allocations: {
          include: {
            invoice: {
              select: { id: true, invoiceNumber: true, status: true },
            },
          },
        },
        receipt: true,
      },
    });
  }

  async get(auth: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        tenant: true,
        allocations: { include: { invoice: true } },
        receipt: true,
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const { membership } = await this.workspaces.assertPermission(
      auth,
      payment.workspaceId,
      'payment',
      'view',
    );
    this.workspaces.assertPropertyInScope(membership, payment.propertyId);
    const aiJobs = await this.prisma.aiJob.findMany({
      where: {
        workspaceId: payment.workspaceId,
        sourceEntityType: 'payment',
        sourceEntityId: id,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return { ...payment, aiJobs };
  }

  async createManual(auth: AuthUser, dto: CreatePaymentDto) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      dto.workspaceId,
      'payment',
      'create',
    );
    const amount = this.money(dto.amount);

    let invoice: {
      id: string;
      workspaceId: string;
      tenantId: string | null;
      propertyId: string | null;
      total: Prisma.Decimal;
      amountPaid: Prisma.Decimal;
      status: InvoiceStatus;
    } | null = null;

    if (dto.invoiceId) {
      invoice = await this.prisma.invoice.findFirst({
        where: { id: dto.invoiceId, workspaceId: dto.workspaceId },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      this.workspaces.assertPropertyInScope(membership, invoice.propertyId);
      if (
        invoice.status === InvoiceStatus.VOID ||
        invoice.status === InvoiceStatus.DRAFT
      ) {
        throw new BadRequestException('Invoice not payable in current status');
      }
    }
    const propertyId = dto.propertyId ?? invoice?.propertyId;
    const tenantId = dto.tenantId ?? invoice?.tenantId;
    this.workspaces.assertPropertyInScope(membership, propertyId);
    const [property, tenant] = await Promise.all([
      propertyId
        ? this.prisma.property.findFirst({
            where: { id: propertyId, workspaceId: dto.workspaceId },
          })
        : null,
      tenantId
        ? this.prisma.tenant.findFirst({
            where: { id: tenantId, workspaceId: dto.workspaceId },
          })
        : null,
    ]);
    if (propertyId && !property)
      throw new NotFoundException('Property not found');
    if (tenantId && !tenant) throw new NotFoundException('Tenant not found');
    if (
      invoice &&
      (invoice.propertyId !== propertyId || invoice.tenantId !== tenantId)
    ) {
      throw new BadRequestException('Payment relations must match invoice');
    }

    const paymentNumber = await this.nextPaymentNumber(dto.workspaceId);

    const noteParts = [dto.notes, dto.proofUrl ? `proof:${dto.proofUrl}` : null]
      .filter(Boolean)
      .join(' | ');

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          workspaceId: dto.workspaceId,
          propertyId,
          tenantId,
          paymentNumber,
          method: dto.method ?? 'BANK_TRANSFER',
          status: PaymentStatus.PENDING,
          amount,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          manualReference: dto.manualReference,
          notes: noteParts || null,
        },
      });

      if (invoice) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: created.id,
            invoiceId: invoice.id,
            amount,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: InvoiceStatus.PENDING_VERIFICATION },
        });
      }

      return created;
    });

    let aiJob = null;
    if (dto.runAiOcr && (dto.proofUrl || dto.proofBase64)) {
      try {
        aiJob = await this.ai.extractPaymentProof(auth, {
          workspaceId: dto.workspaceId,
          imageUrl: dto.proofUrl,
          base64: dto.proofBase64,
          mimeType: dto.proofMimeType,
          expectedAmount: Number(amount),
          manualReference: dto.manualReference,
        });
        if (aiJob?.id) {
          await this.prisma.aiJob.update({
            where: { id: aiJob.id },
            data: {
              sourceEntityType: 'payment',
              sourceEntityId: payment.id,
            },
          });
        }
      } catch {
        aiJob = null;
      }
    }

    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'payment.created',
      entityType: 'payment',
      entityId: payment.id,
      metadata: {
        paymentNumber,
        amount: String(amount),
        invoiceId: dto.invoiceId,
        aiJobId: aiJob?.id,
      },
    });

    return { ...payment, aiJob };
  }

  async confirm(auth: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      payment.workspaceId,
      'payment',
      'approve',
    );
    this.workspaces.assertPropertyInScope(membership, payment.propertyId);
    if (payment.status === PaymentStatus.CONFIRMED) return payment;
    if (payment.status === PaymentStatus.REJECTED) {
      throw new BadRequestException('Rejected payment cannot be confirmed');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        return {
          payment: await tx.payment.findUniqueOrThrow({ where: { id } }),
          claimed: false,
        };
      }

      for (const alloc of payment.allocations) {
        const inv = await tx.invoice.findUnique({
          where: { id: alloc.invoiceId },
        });
        if (!inv) continue;
        const amountPaid = this.money(inv.amountPaid).add(alloc.amount);
        const status = this.invoiceStatusAfterPaid(
          this.money(inv.total),
          amountPaid,
        );
        const changed = await tx.invoice.updateMany({
          where: { id: inv.id, amountPaid: inv.amountPaid },
          data: { amountPaid, status },
        });
        if (changed.count !== 1) {
          throw new BadRequestException('Invoice balance changed; retry');
        }
      }

      return {
        payment: await tx.payment.findUniqueOrThrow({ where: { id } }),
        claimed: true,
      };
    });

    if (!result.claimed) return result.payment;

    await this.audit.log({
      workspaceId: payment.workspaceId,
      actorUserId: user.id,
      action: 'payment.confirmed',
      entityType: 'payment',
      entityId: id,
    });

    await this.receipts.createForPayment(id).catch(() => null);
    return result.payment;
  }

  async reject(auth: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      payment.workspaceId,
      'payment',
      'approve',
    );
    this.workspaces.assertPropertyInScope(membership, payment.propertyId);
    if (payment.status === PaymentStatus.CONFIRMED) {
      throw new BadRequestException('Confirmed payment cannot be rejected');
    }
    if (payment.status === PaymentStatus.REJECTED) return payment;

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.REJECTED,
          rejectedAt: new Date(),
        },
      });

      for (const alloc of payment.allocations) {
        const inv = await tx.invoice.findUnique({
          where: { id: alloc.invoiceId },
        });
        if (!inv) continue;
        if (inv.status === InvoiceStatus.PENDING_VERIFICATION) {
          const amountPaid = this.money(inv.amountPaid);
          const status = amountPaid.greaterThan(0)
            ? InvoiceStatus.PARTIALLY_PAID
            : InvoiceStatus.OPEN;
          await tx.invoice.update({
            where: { id: inv.id },
            data: { status },
          });
        }
      }

      return updated;
    });

    await this.audit.log({
      workspaceId: payment.workspaceId,
      actorUserId: user.id,
      action: 'payment.rejected',
      entityType: 'payment',
      entityId: id,
    });

    return result;
  }
}
