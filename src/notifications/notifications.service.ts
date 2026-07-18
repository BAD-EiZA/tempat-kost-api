import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async listForUser(auth: AuthUser, workspaceId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { externalUserId: auth.externalUserId },
    });
    if (!user) return [];
    return this.prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createInApp(input: {
    workspaceId?: string;
    userId?: string;
    title: string;
    body: string;
    entityType?: string;
    entityId?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        channel: 'IN_APP',
        title: input.title,
        body: input.body,
        status: 'SENT',
        sentAt: new Date(),
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  }

  async markRead(auth: AuthUser, id: string) {
    const user = await this.prisma.user.findUnique({
      where: { externalUserId: auth.externalUserId },
    });
    if (!user) return null;
    return this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { status: 'READ', readAt: new Date() },
    });
  }

  async markAllRead(auth: AuthUser, workspaceId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { externalUserId: auth.externalUserId },
    });
    if (!user) return { count: 0 };
    const r = await this.prisma.notification.updateMany({
      where: {
        userId: user.id,
        status: { not: 'READ' },
        ...(workspaceId ? { workspaceId } : {}),
      },
      data: { status: 'READ', readAt: new Date() },
    });
    return { count: r.count };
  }

  async registerPush(
    auth: AuthUser,
    input: {
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent?: string;
    },
  ) {
    const user = await this.prisma.user.upsert({
      where: { externalUserId: auth.externalUserId },
      create: { externalUserId: auth.externalUserId, email: auth.email },
      update: {},
    });
    return this.prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: { userId: user.id, endpoint: input.endpoint },
      },
      create: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      },
      update: {
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      },
    });
  }

  async listPush(auth: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { externalUserId: auth.externalUserId },
    });
    if (!user) return [];
    return this.prisma.pushSubscription.findMany({
      where: { userId: user.id },
      select: { id: true, endpoint: true, createdAt: true },
    });
  }

  async notifyWorkspaceOwners(
    workspaceId: string,
    title: string,
    body: string,
    entityType?: string,
    entityId?: string,
  ) {
    const owners = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        status: 'ACTIVE',
        role: { key: { in: ['owner', 'admin', 'finance'] } },
      },
    });
    await Promise.all(
      owners.map((m) =>
        this.createInApp({
          workspaceId,
          userId: m.userId,
          title,
          body,
          entityType,
          entityId,
        }),
      ),
    );
  }

  async notifyTenantPortal(
    tenantId: string,
    title: string,
    body: string,
    entityType: string,
    entityId: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { workspaceId: true, portalUserId: true },
    });
    if (!tenant?.portalUserId) return false;

    const exists = await this.prisma.notification.findFirst({
      where: {
        workspaceId: tenant.workspaceId,
        userId: tenant.portalUserId,
        title,
        body,
        entityType,
        entityId,
      },
      select: { id: true },
    });
    if (exists) return false;

    await this.createInApp({
      workspaceId: tenant.workspaceId,
      userId: tenant.portalUserId,
      title,
      body,
      entityType,
      entityId,
    });
    return true;
  }
}
