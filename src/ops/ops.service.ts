import { Injectable, NotFoundException } from '@nestjs/common';
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
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.packageLog.findMany({
      where: { workspaceId },
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
    const { user } = await this.workspaces.assertMember(
      auth,
      input.workspaceId,
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
    await this.workspaces.assertMember(auth, pkg.workspaceId);
    return this.prisma.packageLog.update({
      where: { id },
      data: { pickedUp: true },
    });
  }

  // ── guests ──
  async listGuests(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.guestLog.findMany({
      where: { workspaceId },
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
    await this.workspaces.assertMember(auth, input.workspaceId);
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
    await this.workspaces.assertMember(auth, g.workspaceId);
    return this.prisma.guestLog.update({
      where: { id },
      data: { checkOutAt: new Date() },
    });
  }

  // ── announcements ──
  async listAnnouncements(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.announcement.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAnnouncement(
    auth: AuthUser,
    input: { workspaceId: string; title: string; body: string; publish?: boolean },
  ) {
    await this.workspaces.assertMember(auth, input.workspaceId);
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
    await this.workspaces.assertMember(auth, a.workspaceId);
    return this.prisma.announcement.update({
      where: { id },
      data: { publishedAt: new Date() },
    });
  }

  // ── surveys ──
  async listSurveys(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.surveySchedule.findMany({
      where: { workspaceId },
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
    await this.workspaces.assertMember(auth, input.workspaceId);
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
    await this.workspaces.assertMember(auth, workspaceId);
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
    await this.workspaces.assertMember(auth, input.workspaceId);
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
    await this.workspaces.assertMember(auth, input.workspaceId);
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
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.inspection.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { name: true } } },
    });
  }

  // ── approvals ──
  async listApprovals(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
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
    const { user } = await this.workspaces.assertMember(
      auth,
      input.workspaceId,
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
    const { user } = await this.workspaces.assertPermission(
      auth,
      req.workspaceId,
      'expense',
      'approve',
    );
    return this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status,
        decidedBy: user.id,
        decidedAt: new Date(),
        note: note ?? req.note,
      },
    });
  }

  // ── feature flags ──
  async listFlags(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
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
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.recurringExpense.findMany({
      where: { workspaceId },
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
    await this.workspaces.assertMember(auth, input.workspaceId);
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
