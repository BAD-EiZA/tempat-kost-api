import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  assertAdminSecret(secret?: string) {
    const expected = this.config.get<string>('INTERNAL_API_SECRET');
    if (!secret || secret !== expected) {
      throw new UnauthorizedException('Invalid admin secret');
    }
  }

  async overview() {
    const [
      users,
      workspaces,
      properties,
      rooms,
      activeSubs,
      aiJobs,
      failedWebhooks,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.workspace.count(),
      this.prisma.property.count(),
      this.prisma.room.count(),
      this.prisma.workspaceSubscription.count({
        where: { status: { in: ['TRIALING', 'ACTIVE'] } },
      }),
      this.prisma.aiJob.count(),
      this.prisma.webhookEvent.count({ where: { status: 'FAILED' } }),
    ]);
    return {
      users,
      workspaces,
      properties,
      rooms,
      activeSubscriptions: activeSubs,
      aiJobs,
      failedWebhooks,
    };
  }

  async listWorkspaces() {
    return this.prisma.workspace.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { properties: true, members: true } },
      },
    });
  }

  async extendTrial(workspaceId: string, days: number) {
    const sub = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId },
    });
    if (!sub) return null;
    const base = sub.trialEndsAt && sub.trialEndsAt > new Date()
      ? sub.trialEndsAt
      : new Date();
    base.setDate(base.getDate() + days);
    return this.prisma.workspaceSubscription.update({
      where: { workspaceId },
      data: { trialEndsAt: base, status: 'TRIALING' },
    });
  }

  async suspend(workspaceId: string) {
    return this.prisma.workspaceSubscription.update({
      where: { workspaceId },
      data: { status: 'SUSPENDED' },
    });
  }
}
