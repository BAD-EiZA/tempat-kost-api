import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureUser(auth: AuthUser) {
    return this.prisma.user.upsert({
      where: { externalUserId: auth.externalUserId },
      create: {
        externalUserId: auth.externalUserId,
        email: auth.email,
      },
      update: { email: auth.email ?? undefined },
    });
  }

  async me(auth: AuthUser) {
    const user = await this.ensureUser(auth);
    const tenants = await this.prisma.tenant.findMany({
      where: {
        OR: [
          { portalUserId: user.id },
          ...(user.email ? [{ email: user.email }] : []),
        ],
      },
      include: {
        leases: {
          where: { status: { in: ['ACTIVE', 'ENDING_SOON', 'UPCOMING'] } },
          include: {
            room: { select: { id: true, name: true, code: true } },
            property: { select: { id: true, name: true } },
          },
          orderBy: { startDate: 'desc' },
        },
      },
    });

    // auto-link by email
    for (const t of tenants) {
      if (!t.portalUserId && user.email && t.email === user.email) {
        await this.prisma.tenant.update({
          where: { id: t.id },
          data: { portalUserId: user.id },
        });
        t.portalUserId = user.id;
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      tenants: tenants.map((t) => ({
        id: t.id,
        fullName: t.fullName,
        workspaceId: t.workspaceId,
        status: t.status,
        leases: t.leases,
      })),
    };
  }

  private async assertPortalTenant(auth: AuthUser, tenantId: string) {
    const user = await this.ensureUser(auth);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const linked =
      tenant.portalUserId === user.id ||
      (!!user.email && tenant.email === user.email);
    if (!linked) throw new ForbiddenException('Not your tenant profile');
    if (!tenant.portalUserId && user.email && tenant.email === user.email) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { portalUserId: user.id },
      });
    }
    return tenant;
  }

  async home(auth: AuthUser, tenantId: string) {
    await this.assertPortalTenant(auth, tenantId);
    const [openInvoices, recentPayments, maintenance, activeLease] =
      await Promise.all([
        this.prisma.invoice.findMany({
          where: {
            tenantId,
            status: {
              in: [
                'OPEN',
                'PARTIALLY_PAID',
                'PENDING_VERIFICATION',
                'OVERDUE',
              ],
            },
          },
          orderBy: { dueDate: 'asc' },
          take: 10,
          include: { items: true },
        }),
        this.prisma.payment.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.maintenanceRequest.findMany({
          where: {
            tenantId,
            status: { notIn: ['CLOSED', 'REJECTED'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.lease.findFirst({
          where: { tenantId, status: { in: ['ACTIVE', 'ENDING_SOON'] } },
          include: {
            room: true,
            property: true,
          },
        }),
      ]);

    const outstanding = openInvoices.reduce((sum, inv) => {
      return sum + Number(inv.total) - Number(inv.amountPaid);
    }, 0);

    return {
      outstanding,
      openInvoices,
      recentPayments,
      maintenance,
      activeLease,
    };
  }

  async invoices(auth: AuthUser, tenantId: string) {
    await this.assertPortalTenant(auth, tenantId);
    return this.prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  async getInvoice(auth: AuthUser, tenantId: string, invoiceId: string) {
    await this.assertPortalTenant(auth, tenantId);
    const inv = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { items: true, property: true },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  async contracts(auth: AuthUser, tenantId: string) {
    await this.assertPortalTenant(auth, tenantId);
    return this.prisma.lease.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' },
      include: {
        room: { select: { id: true, name: true, code: true } },
        property: { select: { id: true, name: true, addressLine: true } },
        checkinRecord: true,
        checkoutRecord: true,
      },
    });
  }

  async paymentAttempts(auth: AuthUser, tenantId: string) {
    await this.assertPortalTenant(auth, tenantId);
    return this.prisma.paymentAttempt.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async uploadProof(
    auth: AuthUser,
    input: {
      tenantId: string;
      invoiceId: string;
      amount?: number;
      proofUrl: string;
      manualReference?: string;
      notes?: string;
    },
  ) {
    const tenant = await this.assertPortalTenant(auth, input.tenantId);
    const inv = await this.prisma.invoice.findFirst({
      where: { id: input.invoiceId, tenantId: tenant.id },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (
      inv.status === 'PAID' ||
      inv.status === 'VOID' ||
      inv.status === 'DRAFT'
    ) {
      throw new ForbiddenException('Invoice not payable');
    }
    const outstanding =
      Number(inv.total) - Number(inv.amountPaid);
    const amount = input.amount && input.amount > 0 ? input.amount : outstanding;
    if (amount <= 0) throw new ForbiddenException('Nothing outstanding');

    const year = new Date().getFullYear();
    const count = await this.prisma.payment.count({
      where: { workspaceId: inv.workspaceId },
    });
    const paymentNumber = `PAY-${year}-P${String(count + 1).padStart(5, '0')}`;
    const note = [
      input.notes,
      `proof:${input.proofUrl}`,
      'source:portal_manual',
    ]
      .filter(Boolean)
      .join(' | ');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          workspaceId: inv.workspaceId,
          propertyId: inv.propertyId,
          tenantId: tenant.id,
          paymentNumber,
          method: 'BANK_TRANSFER',
          status: 'PENDING',
          amount,
          paidAt: new Date(),
          manualReference: input.manualReference,
          notes: note,
        },
      });
      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: inv.id,
          amount,
        },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: { status: 'PENDING_VERIFICATION' },
      });
      return payment;
    });
  }

  async createMaintenance(
    auth: AuthUser,
    input: {
      tenantId: string;
      title: string;
      description: string;
      category?: string;
      urgency?: string;
    },
  ) {
    const tenant = await this.assertPortalTenant(auth, input.tenantId);
    const lease = await this.prisma.lease.findFirst({
      where: {
        tenantId: tenant.id,
        status: { in: ['ACTIVE', 'ENDING_SOON'] },
      },
    });
    if (!lease) throw new NotFoundException('No active lease');

    return this.prisma.maintenanceRequest.create({
      data: {
        workspaceId: tenant.workspaceId,
        propertyId: lease.propertyId,
        roomId: lease.roomId,
        tenantId: tenant.id,
        title: input.title,
        description: input.description,
        category: input.category,
        urgency: input.urgency ?? 'medium',
      },
    });
  }

  async announcements(auth: AuthUser, tenantId: string) {
    const tenant = await this.assertPortalTenant(auth, tenantId);
    return this.prisma.announcement.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
  }

  async utilities(auth: AuthUser, tenantId: string) {
    const tenant = await this.assertPortalTenant(auth, tenantId);
    const lease = await this.prisma.lease.findFirst({
      where: { tenantId, status: { in: ['ACTIVE', 'ENDING_SOON'] } },
      include: {
        room: true,
        property: true,
      },
    });
    if (!lease) {
      return { lease: null, policies: [], invoices: [], readings: [] };
    }
    const [policies, invoices, meters] = await Promise.all([
      this.prisma.utilityBillingPolicy.findMany({
        where: {
          workspaceId: tenant.workspaceId,
          propertyId: lease.propertyId,
          isActive: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          tenantId,
          type: 'UTILITY',
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: { items: true },
      }),
      this.prisma.utilityMeter.findMany({
        where: {
          workspaceId: tenant.workspaceId,
          OR: [{ roomId: lease.roomId }, { propertyId: lease.propertyId }],
        },
        include: {
          readings: { orderBy: { readAt: 'desc' }, take: 3 },
        },
      }),
    ]);
    return {
      lease: {
        id: lease.id,
        room: lease.room.name,
        property: lease.property.name,
      },
      policies,
      invoices,
      meters,
    };
  }

  async getProfile(auth: AuthUser, tenantId: string) {
    await this.assertPortalTenant(auth, tenantId);
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        fullName: true,
        preferredName: true,
        phone: true,
        email: true,
        emergencyName: true,
        emergencyPhone: true,
      },
    });
  }

  async updateProfile(
    auth: AuthUser,
    tenantId: string,
    input: {
      preferredName?: string;
      phone?: string;
      email?: string;
      emergencyName?: string;
      emergencyPhone?: string;
    },
  ) {
    await this.assertPortalTenant(auth, tenantId);
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        preferredName: input.preferredName,
        phone: input.phone,
        email: input.email,
        emergencyName: input.emergencyName,
        emergencyPhone: input.emergencyPhone,
      },
      select: {
        id: true,
        fullName: true,
        preferredName: true,
        phone: true,
        email: true,
        emergencyName: true,
        emergencyPhone: true,
      },
    });
  }

  async contractsWithSignLinks(auth: AuthUser, tenantId: string) {
    const leases = await this.contracts(auth, tenantId);
    const leaseIds = leases.map((l) => l.id);
    const docs = await this.prisma.contractDocument.findMany({
      where: { leaseId: { in: leaseIds } },
      orderBy: { version: 'desc' },
    });
    return leases.map((l) => ({
      ...l,
      contracts: docs
        .filter((d) => d.leaseId === l.id)
        .map((d) => ({
          id: d.id,
          version: d.version,
          status: d.status,
          signToken: d.signToken,
          signedAt: d.signedAt,
        })),
    }));
  }
}
