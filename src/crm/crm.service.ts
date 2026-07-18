import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, ProspectStatus, RoomStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  async listProspects(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'tenant',
      'view',
    );
    return this.prisma.prospect.findMany({
      where: {
        workspaceId,
        ...this.workspaces.propertyIdFilter(membership),
      },
      orderBy: { createdAt: 'desc' },
      include: { property: { select: { id: true, name: true } } },
    });
  }

  async createProspect(
    auth: AuthUser,
    input: {
      workspaceId: string;
      fullName: string;
      phone?: string;
      email?: string;
      propertyId?: string;
      budget?: number;
      source?: string;
      notes?: string;
    },
  ) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'tenant',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    if (input.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: input.propertyId, workspaceId: input.workspaceId },
        select: { id: true },
      });
      if (!property) throw new NotFoundException('Property not found');
    }
    const p = await this.prisma.prospect.create({
      data: {
        workspaceId: input.workspaceId,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        propertyId: input.propertyId,
        budget: input.budget,
        source: input.source,
        notes: input.notes,
      },
    });
    await this.audit.log({
      workspaceId: input.workspaceId,
      actorUserId: user.id,
      action: 'prospect.created',
      entityType: 'prospect',
      entityId: p.id,
    });
    return p;
  }

  async updateProspectStatus(
    auth: AuthUser,
    id: string,
    status: ProspectStatus,
    lostReason?: string,
  ) {
    const p = await this.prisma.prospect.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      p.workspaceId,
      'tenant',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, p.propertyId);
    return this.prisma.prospect.update({
      where: { id },
      data: {
        status,
        lostReason:
          status === 'LOST'
            ? (lostReason ?? p.lostReason ?? 'unspecified')
            : null,
      },
    });
  }

  async funnel(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'tenant',
      'view',
    );
    const scopeFilter = this.workspaces.propertyIdFilter(membership);
    const rows = await this.prisma.prospect.groupBy({
      by: ['status'],
      where: { workspaceId, ...scopeFilter },
      _count: true,
    });
    const lost = await this.prisma.prospect.groupBy({
      by: ['lostReason'],
      where: { workspaceId, status: 'LOST', ...scopeFilter },
      _count: true,
    });
    return {
      byStatus: Object.fromEntries(rows.map((r) => [r.status, r._count])),
      lostReasons: lost.map((r) => ({
        reason: r.lostReason ?? 'unspecified',
        count: r._count,
      })),
      total: rows.reduce((s, r) => s + r._count, 0),
    };
  }

  async createBooking(
    auth: AuthUser,
    input: {
      workspaceId: string;
      propertyId: string;
      roomId?: string;
      prospectId?: string;
      holdDays?: number;
      feeAmount?: number;
      notes?: string;
    },
  ) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'lease',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    const property = await this.prisma.property.findFirst({
      where: { id: input.propertyId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!property) throw new NotFoundException('Property not found');
    if (input.prospectId) {
      const prospect = await this.prisma.prospect.findFirst({
        where: { id: input.prospectId, workspaceId: input.workspaceId },
        select: { propertyId: true },
      });
      if (
        !prospect ||
        (prospect.propertyId && prospect.propertyId !== input.propertyId)
      ) {
        throw new BadRequestException('Prospect does not belong to property');
      }
    }
    const holdUntil = new Date();
    holdUntil.setDate(holdUntil.getDate() + (input.holdDays ?? 3));

    const booking = await this.prisma.$transaction(async (tx) => {
      if (input.roomId) {
        const reserved = await tx.room.updateMany({
          where: {
            id: input.roomId,
            workspaceId: input.workspaceId,
            propertyId: input.propertyId,
            status: RoomStatus.AVAILABLE,
          },
          data: { status: RoomStatus.RESERVED },
        });
        if (reserved.count !== 1) {
          throw new BadRequestException('Room not available');
        }
      }
      return tx.booking.create({
        data: {
          workspaceId: input.workspaceId,
          propertyId: input.propertyId,
          roomId: input.roomId,
          prospectId: input.prospectId,
          holdUntil,
          feeAmount: input.feeAmount ?? 0,
          notes: input.notes,
          status: BookingStatus.HOLD,
        },
      });
    });

    await this.audit.log({
      workspaceId: input.workspaceId,
      actorUserId: user.id,
      action: 'booking.created',
      entityType: 'booking',
      entityId: booking.id,
    });
    return booking;
  }

  async listBookings(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'lease',
      'view',
    );
    return this.prisma.booking.findMany({
      where: {
        workspaceId,
        ...this.workspaces.propertyIdFilter(membership),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        property: { select: { id: true, name: true } },
        prospect: { select: { id: true, fullName: true, phone: true } },
      },
    });
  }

  async expireBookings() {
    const now = new Date();
    const expired = await this.prisma.booking.findMany({
      where: { status: BookingStatus.HOLD, holdUntil: { lt: now } },
    });
    for (const b of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: b.id },
          data: { status: BookingStatus.EXPIRED },
        });
        if (b.roomId) {
          const activeLease = await tx.lease.count({
            where: {
              roomId: b.roomId,
              status: { in: ['ACTIVE', 'ENDING_SOON'] },
            },
          });
          if (!activeLease) {
            await tx.room.update({
              where: { id: b.roomId },
              data: { status: RoomStatus.AVAILABLE },
            });
          }
        }
      });
    }
    return { expired: expired.length };
  }

  async convertProspect(auth: AuthUser, prospectId: string) {
    const p = await this.prisma.prospect.findUnique({
      where: { id: prospectId },
    });
    if (!p) throw new NotFoundException();
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      p.workspaceId,
      'tenant',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, p.propertyId);
    const tenant = await this.prisma.tenant.create({
      data: {
        workspaceId: p.workspaceId,
        fullName: p.fullName,
        phone: p.phone,
        email: p.email,
        status: 'PROSPECT',
      },
    });
    await this.prisma.prospect.update({
      where: { id: prospectId },
      data: { status: ProspectStatus.CONVERTED },
    });
    await this.audit.log({
      workspaceId: p.workspaceId,
      actorUserId: user.id,
      action: 'prospect.converted',
      entityType: 'tenant',
      entityId: tenant.id,
    });
    return tenant;
  }

  async createBookingFeeInvoice(auth: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { prospect: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const { membership } = await this.workspaces.assertPermission(
      auth,
      booking.workspaceId,
      'invoice',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, booking.propertyId);
    if (Number(booking.feeAmount) <= 0) {
      throw new BadRequestException('Booking fee is zero');
    }
    if (booking.feeInvoiceId) {
      return this.prisma.invoice.findUnique({
        where: { id: booking.feeInvoiceId },
      });
    }

    let tenantId: string | undefined;
    if (booking.prospectId && booking.prospect) {
      const existing = await this.prisma.tenant.findFirst({
        where: {
          workspaceId: booking.workspaceId,
          OR: [
            { phone: booking.prospect.phone ?? undefined },
            { email: booking.prospect.email ?? undefined },
            { fullName: booking.prospect.fullName },
          ],
        },
      });
      if (existing) tenantId = existing.id;
      else {
        const t = await this.prisma.tenant.create({
          data: {
            workspaceId: booking.workspaceId,
            fullName: booking.prospect.fullName,
            phone: booking.prospect.phone,
            email: booking.prospect.email,
            status: 'PROSPECT',
          },
        });
        tenantId = t.id;
      }
    }

    const year = new Date().getFullYear();
    const count = await this.prisma.invoice.count({
      where: { workspaceId: booking.workspaceId },
    });
    const invoiceNumber = `INV-${year}-B${String(count + 1).padStart(5, '0')}`;
    const amount = Number(booking.feeAmount);
    const invoice = await this.prisma.invoice.create({
      data: {
        workspaceId: booking.workspaceId,
        propertyId: booking.propertyId,
        tenantId,
        invoiceNumber,
        type: 'BOOKING',
        status: 'OPEN',
        issueDate: new Date(),
        dueDate: booking.holdUntil,
        subtotal: amount,
        total: amount,
        issuedAt: new Date(),
        notes: `Booking fee ${booking.id}`,
        items: {
          create: [
            {
              description: 'Booking fee / hold kamar',
              quantity: 1,
              unitPrice: amount,
              amount,
            },
          ],
        },
      },
    });
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { feeInvoiceId: invoice.id, status: BookingStatus.HOLD },
    });
    return invoice;
  }

  async markBookingPaid(auth: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      booking.workspaceId,
      'lease',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, booking.propertyId);
    if (Number(booking.feeAmount) > 0) {
      if (!booking.feeInvoiceId) {
        throw new BadRequestException('Booking fee invoice missing');
      }
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          id: booking.feeInvoiceId,
          workspaceId: booking.workspaceId,
          status: 'PAID',
        },
        select: { id: true },
      });
      if (!invoice) throw new BadRequestException('Booking fee is not paid');
    }
    return this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.PAID },
    });
  }
}
