import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  private money(n: number): Prisma.Decimal {
    return new Prisma.Decimal(n.toFixed(2));
  }

  private async nextInvoiceNumber(workspaceId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.invoice.count({ where: { workspaceId } });
    return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertMember(
      auth,
      workspaceId,
    );
    return this.prisma.invoice.findMany({
      where: {
        workspaceId,
        ...this.workspaces.propertyIdFilter(membership),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { id: true, fullName: true } },
        property: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async get(auth: AuthUser, id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        tenant: true,
        property: true,
        lease: true,
        allocations: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.workspaces.assertMember(auth, invoice.workspaceId);
    return invoice;
  }

  async create(auth: AuthUser, dto: CreateInvoiceDto) {
    const { user } = await this.workspaces.assertMember(auth, dto.workspaceId);
    if (!dto.items?.length) {
      throw new BadRequestException('Invoice needs at least one item');
    }

    if (dto.leaseId) {
      const lease = await this.prisma.lease.findFirst({
        where: { id: dto.leaseId, workspaceId: dto.workspaceId },
      });
      if (!lease) throw new NotFoundException('Lease not found');
    }

    let subtotal = new Prisma.Decimal(0);
    const itemsData = dto.items.map((item, idx) => {
      const amount = this.money(item.quantity * item.unitPrice);
      subtotal = subtotal.add(amount);
      return {
        description: item.description,
        quantity: this.money(item.quantity),
        unitPrice: this.money(item.unitPrice),
        amount,
        sortOrder: idx,
      };
    });

    const invoiceNumber = await this.nextInvoiceNumber(dto.workspaceId);
    const invoice = await this.prisma.invoice.create({
      data: {
        workspaceId: dto.workspaceId,
        propertyId: dto.propertyId,
        tenantId: dto.tenantId,
        leaseId: dto.leaseId,
        invoiceNumber,
        type: dto.type ?? 'RENT',
        status: InvoiceStatus.DRAFT,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        subtotal,
        total: subtotal,
        notes: dto.notes,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: { invoiceNumber, total: String(subtotal) },
    });

    return invoice;
  }

  async issue(auth: AuthUser, id: string) {
    const invoice = await this.get(auth, id);
    if (invoice.status !== InvoiceStatus.DRAFT && invoice.status !== InvoiceStatus.SCHEDULED) {
      throw new BadRequestException('Only draft/scheduled invoices can be issued');
    }
    const { user } = await this.workspaces.assertMember(
      auth,
      invoice.workspaceId,
    );
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.OPEN,
        issuedAt: new Date(),
      },
      include: { items: true },
    });
    await this.audit.log({
      workspaceId: invoice.workspaceId,
      actorUserId: user.id,
      action: 'invoice.issued',
      entityType: 'invoice',
      entityId: id,
    });
    return updated;
  }

  async void(auth: AuthUser, id: string) {
    const invoice = await this.get(auth, id);
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Cannot void paid invoice');
    }
    if (invoice.status === InvoiceStatus.VOID) return invoice;
    const { user } = await this.workspaces.assertMember(
      auth,
      invoice.workspaceId,
    );
    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.VOID,
        voidedAt: new Date(),
      },
    });
    await this.audit.log({
      workspaceId: invoice.workspaceId,
      actorUserId: user.id,
      action: 'invoice.voided',
      entityType: 'invoice',
      entityId: id,
    });
    return updated;
  }

  async createFromLease(auth: AuthUser, leaseId: string) {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease) throw new NotFoundException('Lease not found');
    await this.workspaces.assertMember(auth, lease.workspaceId);

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(lease.dueDay);

    return this.create(auth, {
      workspaceId: lease.workspaceId,
      propertyId: lease.propertyId,
      tenantId: lease.tenantId,
      leaseId: lease.id,
      type: 'RENT',
      issueDate: issueDate.toISOString().slice(0, 10),
      dueDate: dueDate.toISOString().slice(0, 10),
      items: [
        {
          description: `Sewa ${lease.leaseNumber}`,
          quantity: 1,
          unitPrice: Number(lease.rentAmount),
        },
      ],
    });
  }

  async addAdjustment(
    auth: AuthUser,
    invoiceId: string,
    input: { description: string; amount: number },
  ) {
    const invoice = await this.get(auth, invoiceId);
    if (
      invoice.status === InvoiceStatus.VOID ||
      invoice.status === InvoiceStatus.PAID
    ) {
      throw new BadRequestException('Cannot adjust void/paid invoice');
    }
    const { user } = await this.workspaces.assertMember(
      auth,
      invoice.workspaceId,
    );
    const amount = this.money(input.amount);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.invoiceItem.create({
        data: {
          invoiceId,
          description: input.description,
          quantity: 1,
          unitPrice: amount,
          amount,
          sortOrder: 99,
        },
      });
      const items = await tx.invoiceItem.findMany({ where: { invoiceId } });
      const total = items.reduce(
        (s, i) => s.add(i.amount),
        new Prisma.Decimal(0),
      );
      return tx.invoice.update({
        where: { id: invoiceId },
        data: { subtotal: total, total },
        include: { items: true },
      });
    });
    await this.audit.log({
      workspaceId: invoice.workspaceId,
      actorUserId: user.id,
      action: 'invoice.adjusted',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: input,
    });
    return updated;
  }

  async applyLateFee(auth: AuthUser, invoiceId: string, percent?: number) {
    const invoice = await this.get(auth, invoiceId);
    if (invoice.status !== InvoiceStatus.OPEN && invoice.status !== InvoiceStatus.OVERDUE) {
      throw new BadRequestException('Late fee only for open/overdue');
    }
    const ws = await this.prisma.workspace.findUnique({
      where: { id: invoice.workspaceId },
    });
    const pct = percent ?? Number(ws?.lateFeePercent ?? 2);
    const outstanding =
      Number(invoice.total) - Number(invoice.amountPaid);
    const fee = Math.round((outstanding * pct) / 100);
    if (fee <= 0) throw new BadRequestException('No outstanding');
    return this.addAdjustment(auth, invoiceId, {
      description: `Denda keterlambatan ${pct}%`,
      amount: fee,
    });
  }

  async markOverdue(auth: AuthUser, invoiceId: string) {
    const invoice = await this.get(auth, invoiceId);
    if (invoice.status !== InvoiceStatus.OPEN) return invoice;
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.OVERDUE },
    });
  }
}
