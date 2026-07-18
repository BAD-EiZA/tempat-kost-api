import {
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const TRIAL_DAYS = 14;

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async onModuleInit() {
    await this.prisma.subscriptionPlan.upsert({
      where: { key: 'trial' },
      create: {
        key: 'trial',
        name: 'Trial',
        maxProperties: 1,
        maxRooms: 15,
        maxMembers: 3,
        maxAiCredits: 20,
        priceMonthly: 0,
      },
      update: {},
    });
    await this.prisma.subscriptionPlan.upsert({
      where: { key: 'starter' },
      create: {
        key: 'starter',
        name: 'Starter',
        maxProperties: 3,
        maxRooms: 50,
        maxMembers: 10,
        maxAiCredits: 100,
        priceMonthly: 99000,
      },
      update: {},
    });
    await this.prisma.subscriptionPlan.upsert({
      where: { key: 'growth' },
      create: {
        key: 'growth',
        name: 'Growth',
        maxProperties: 15,
        maxRooms: 300,
        maxMembers: 50,
        maxAiCredits: 500,
        priceMonthly: 299000,
      },
      update: {},
    });
  }

  async ensureTrial(workspaceId: string) {
    const existing = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    if (existing) return existing;

    const trial = await this.prisma.subscriptionPlan.findUniqueOrThrow({
      where: { key: 'trial' },
    });
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    return this.prisma.workspaceSubscription.create({
      data: {
        workspaceId,
        planId: trial.id,
        status: 'TRIALING',
        trialEndsAt,
      },
      include: { plan: true },
    });
  }

  async getForWorkspace(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'subscription',
      'view',
    );
    return this.ensureTrial(workspaceId);
  }

  async assertCanCreateProperty(workspaceId: string) {
    const sub = await this.ensureTrial(workspaceId);
    this.assertWritable(sub.status);
    const count = await this.prisma.property.count({
      where: { workspaceId, status: { not: 'ARCHIVED' } },
    });
    if (count >= sub.plan.maxProperties) {
      throw new ForbiddenException(
        `Plan limit: max ${sub.plan.maxProperties} properties`,
      );
    }
  }

  async assertCanCreateRoom(workspaceId: string) {
    const sub = await this.ensureTrial(workspaceId);
    this.assertWritable(sub.status);
    const count = await this.prisma.room.count({
      where: { workspaceId, status: { not: 'INACTIVE' } },
    });
    if (count >= sub.plan.maxRooms) {
      throw new ForbiddenException(
        `Plan limit: max ${sub.plan.maxRooms} rooms`,
      );
    }
  }

  async assertAiCredit(workspaceId: string) {
    const sub = await this.ensureTrial(workspaceId);
    this.assertWritable(sub.status);
    if (sub.aiCreditsUsed >= sub.plan.maxAiCredits) {
      throw new ForbiddenException('AI credit quota exhausted');
    }
  }

  async consumeAiCredit(workspaceId: string, units = 1) {
    await this.assertAiCredit(workspaceId);
    return this.prisma.workspaceSubscription.update({
      where: { workspaceId },
      data: { aiCreditsUsed: { increment: units } },
    });
  }

  private assertWritable(status: string) {
    if (status === 'SUSPENDED' || status === 'CANCELLED') {
      throw new ForbiddenException('Subscription is not active');
    }
  }

  async listPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceMonthly: 'asc' },
    });
  }
}
