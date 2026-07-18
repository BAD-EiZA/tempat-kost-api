import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DepositTxnType, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  // ── packages ──
  async listPackages(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'property',
      'view',
    );
    return this.prisma.packageLog.findMany({
      where: { workspaceId, ...this.workspaces.propertyIdFilter(membership) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createPackage(
    auth: AuthUser,
    input: {
      workspaceId: string;
      recipient: string;
      courier?: string;
      photoUrl?: string;
      notes?: string;
    },
  ) {
    const { user } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'property',
      'update',
    );
    return this.prisma.packageLog.create({
      data: {
        workspaceId: input.workspaceId,
        recipient: input.recipient,
        courier: input.courier,
        photoUrl: input.photoUrl,
        receivedBy: user.fullName ?? user.email ?? user.id,
        notes: input.notes,
      },
    });
  }

  async pickupPackage(auth: AuthUser, id: string) {
    const pkg = await this.prisma.packageLog.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      pkg.workspaceId,
      'property',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, pkg.propertyId);
    return this.prisma.packageLog.update({
      where: { id },
      data: { pickedUp: true },
    });
  }

  // ── guests ──
  async listGuests(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'property',
      'view',
    );
    return this.prisma.guestLog.findMany({
      where: { workspaceId, ...this.workspaces.propertyIdFilter(membership) },
      orderBy: { checkInAt: 'desc' },
      take: 100,
    });
  }

  async createGuest(
    auth: AuthUser,
    input: {
      workspaceId: string;
      guestName: string;
      roomLabel?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'property',
      'update',
    );
    return this.prisma.guestLog.create({
      data: {
        workspaceId: input.workspaceId,
        guestName: input.guestName,
        roomLabel: input.roomLabel,
        phone: input.phone,
        notes: input.notes,
      },
    });
  }

  async checkoutGuest(auth: AuthUser, id: string) {
    const g = await this.prisma.guestLog.findUnique({ where: { id } });
    if (!g) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      g.workspaceId,
      'property',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, g.propertyId);
    return this.prisma.guestLog.update({
      where: { id },
      data: { checkOutAt: new Date() },
    });
  }

  // ── announcements ──
  async listAnnouncements(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertPermission(auth, workspaceId, 'report', 'view');
    return this.prisma.announcement.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAnnouncement(
    auth: AuthUser,
    input: {
      workspaceId: string;
      title: string;
      body: string;
      publish?: boolean;
    },
  ) {
    await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'workspace',
      'manage_settings',
    );
    return this.prisma.announcement.create({
      data: {
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body,
        publishedAt: input.publish ? new Date() : null,
      },
    });
  }

  async publishAnnouncement(auth: AuthUser, id: string) {
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    await this.workspaces.assertPermission(
      auth,
      a.workspaceId,
      'workspace',
      'manage_settings',
    );
    return this.prisma.announcement.update({
      where: { id },
      data: { publishedAt: new Date() },
    });
  }

  // ── surveys ──
  async listSurveys(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'property',
      'view',
    );
    return this.prisma.surveySchedule.findMany({
      where: { workspaceId, ...this.workspaces.propertyIdFilter(membership) },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async createSurvey(
    auth: AuthUser,
    input: {
      workspaceId: string;
      prospectId?: string;
      propertyId?: string;
      scheduledAt: string;
      staffNote?: string;
    },
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'property',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    const [property, prospect] = await Promise.all([
      input.propertyId
        ? this.prisma.property.findFirst({
            where: { id: input.propertyId, workspaceId: input.workspaceId },
          })
        : null,
      input.prospectId
        ? this.prisma.prospect.findFirst({
            where: { id: input.prospectId, workspaceId: input.workspaceId },
          })
        : null,
    ]);
    if (input.propertyId && !property) throw new NotFoundException();
    if (input.prospectId && !prospect) throw new NotFoundException();
    return this.prisma.surveySchedule.create({
      data: {
        workspaceId: input.workspaceId,
        prospectId: input.prospectId,
        propertyId: input.propertyId,
        scheduledAt: new Date(input.scheduledAt),
        staffNote: input.staffNote,
      },
    });
  }

  // ── inspections ──
  async listTemplates(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertPermission(auth, workspaceId, 'property', 'view');
    return this.prisma.inspectionTemplate.findMany({
      where: { workspaceId },
    });
  }

  async createTemplate(
    auth: AuthUser,
    input: {
      workspaceId: string;
      name: string;
      kind?: string;
      items: Array<{ label: string; requiredPhoto?: boolean }>;
    },
  ) {
    await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'property',
      'update',
    );
    return this.prisma.inspectionTemplate.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        kind: input.kind ?? 'routine',
        itemsJson: input.items,
      },
    });
  }

  async createInspection(
    auth: AuthUser,
    input: {
      workspaceId: string;
      templateId?: string;
      propertyId?: string;
      roomId?: string;
      leaseId?: string;
      kind?: string;
      result?: object;
      notes?: string;
      complete?: boolean;
    },
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'property',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    const [template, property, room, lease] = await Promise.all([
      input.templateId
        ? this.prisma.inspectionTemplate.findFirst({
            where: { id: input.templateId, workspaceId: input.workspaceId },
          })
        : null,
      input.propertyId
        ? this.prisma.property.findFirst({
            where: { id: input.propertyId, workspaceId: input.workspaceId },
          })
        : null,
      input.roomId
        ? this.prisma.room.findFirst({
            where: {
              id: input.roomId,
              workspaceId: input.workspaceId,
              ...(input.propertyId ? { propertyId: input.propertyId } : {}),
            },
          })
        : null,
      input.leaseId
        ? this.prisma.lease.findFirst({
            where: {
              id: input.leaseId,
              workspaceId: input.workspaceId,
              ...(input.propertyId ? { propertyId: input.propertyId } : {}),
            },
          })
        : null,
    ]);
    if (input.templateId && !template) throw new NotFoundException();
    if (input.propertyId && !property) throw new NotFoundException();
    if (input.roomId && !room) throw new NotFoundException();
    if (input.leaseId && !lease) throw new NotFoundException();
    if (room) this.workspaces.assertPropertyInScope(membership, room.propertyId);
    if (lease) this.workspaces.assertPropertyInScope(membership, lease.propertyId);
    return this.prisma.inspection.create({
      data: {
        workspaceId: input.workspaceId,
        templateId: input.templateId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        leaseId: input.leaseId,
        kind: input.kind ?? 'routine',
        resultJson: input.result,
        notes: input.notes,
        status: input.complete ? 'completed' : 'draft',
        completedAt: input.complete ? new Date() : null,
      },
    });
  }

  async listInspections(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'property',
      'view',
    );
    return this.prisma.inspection.findMany({
      where: { workspaceId, ...this.workspaces.propertyIdFilter(membership) },
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { name: true } } },
    });
  }

  // ── approvals ──
  async listApprovals(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertPermission(auth, workspaceId, 'expense', 'view');
    return this.prisma.approvalRequest.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async requestApproval(
    auth: AuthUser,
    input: {
      workspaceId: string;
      kind: string;
      entityType: string;
      entityId: string;
      payload?: object;
      note?: string;
    },
  ) {
    const { user } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'expense',
      'create',
    );
    return this.prisma.approvalRequest.create({
      data: {
        workspaceId: input.workspaceId,
        kind: input.kind,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: input.payload,
        note: input.note,
        requestedBy: user.id,
        status: 'pending',
      },
    });
  }

  async decideApproval(
    auth: AuthUser,
    id: string,
    status: 'approved' | 'rejected',
    note?: string,
  ) {
    const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException();
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      req.workspaceId,
      'expense',
      'approve',
    );
    if (req.status !== 'pending') return req;
    return this.prisma.$transaction(async (tx) => {
      const decided = await tx.approvalRequest.updateMany({
        where: { id, status: 'pending' },
        data: {
          status,
          decidedBy: user.id,
          decidedAt: new Date(),
          note: note ?? req.note,
        },
      });
      if (decided.count === 0) {
        return tx.approvalRequest.findUniqueOrThrow({ where: { id } });
      }

      if (status === 'approved' && req.kind === 'deposit_deduction') {
        const payload = req.payload as {
          damageAmount?: number;
          reason?: string;
          refundAmount?: number;
        } | null;
        const damage = new Prisma.Decimal(payload?.damageAmount ?? 0);
        const account = await tx.depositAccount.findUnique({
          where: { id: req.entityId },
          include: { lease: { select: { propertyId: true } } },
        });
        if (
          !account ||
          account.workspaceId !== req.workspaceId ||
          damage.lessThanOrEqualTo(0)
        ) {
          throw new BadRequestException('Invalid deposit deduction approval');
        }
        this.workspaces.assertPropertyInScope(
          membership,
          account.lease.propertyId,
        );
        const afterDamage = new Prisma.Decimal(account.balance).sub(damage);
        if (afterDamage.lessThan(0)) {
          throw new BadRequestException('Deposit balance cannot go negative');
        }
        const refund =
          payload?.refundAmount === undefined
            ? afterDamage
            : new Prisma.Decimal(payload.refundAmount);
        if (refund.lessThan(0) || refund.greaterThan(afterDamage)) {
          throw new BadRequestException('Invalid deposit refund amount');
        }
        const finalBalance = afterDamage.sub(refund);
        await tx.depositAccount.update({
          where: { id: account.id },
          data: { balance: finalBalance },
        });
        await tx.depositTransaction.create({
          data: {
            depositAccountId: account.id,
            type: DepositTxnType.DEDUCTION,
            amount: damage,
            balanceAfter: afterDamage,
            reason: payload?.reason ?? 'Approved checkout damage',
          },
        });
        if (refund.greaterThan(0)) {
          await tx.depositTransaction.create({
            data: {
              depositAccountId: account.id,
              type: DepositTxnType.REFUND,
              amount: refund,
              balanceAfter: finalBalance,
              reason: 'Checkout refund',
            },
          });
        }
      }

      return tx.approvalRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  // ── feature flags ──
  async listFlags(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'workspace',
      'manage_settings',
    );
    return this.prisma.workspaceFeatureFlag.findMany({
      where: { workspaceId },
    });
  }

  async setFlag(
    auth: AuthUser,
    input: { workspaceId: string; key: string; enabled: boolean },
  ) {
    await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'workspace',
      'manage_settings',
    );
    return this.prisma.workspaceFeatureFlag.upsert({
      where: {
        workspaceId_key: {
          workspaceId: input.workspaceId,
          key: input.key,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        key: input.key,
        enabled: input.enabled,
      },
      update: { enabled: input.enabled },
    });
  }

  // ── recurring expenses ──
  async listRecurring(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'expense',
      'view',
    );
    return this.prisma.recurringExpense.findMany({
      where: { workspaceId, ...this.workspaces.propertyIdFilter(membership) },
      orderBy: { nextDate: 'asc' },
    });
  }

  async createRecurring(
    auth: AuthUser,
    input: {
      workspaceId: string;
      category: string;
      amount: number;
      frequency?: string;
      nextDate: string;
      vendor?: string;
      description?: string;
      propertyId?: string;
    },
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'expense',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    if (input.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: input.propertyId, workspaceId: input.workspaceId },
      });
      if (!property) throw new NotFoundException();
    }
    return this.prisma.recurringExpense.create({
      data: {
        workspaceId: input.workspaceId,
        category: input.category,
        amount: input.amount,
        frequency: input.frequency ?? 'monthly',
        nextDate: new Date(input.nextDate),
        vendor: input.vendor,
        description: input.description,
        propertyId: input.propertyId,
      },
    });
  }
}
