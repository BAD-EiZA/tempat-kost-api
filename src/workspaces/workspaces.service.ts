import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';

const OWNER_PERMISSIONS: Array<{ resource: string; action: string }> = [
  { resource: 'workspace', action: 'manage_settings' },
  { resource: 'workspace', action: 'manage_access' },
  { resource: 'subscription', action: 'view' },
  { resource: 'subscription', action: 'manage_settings' },
  { resource: 'property', action: 'view' },
  { resource: 'property', action: 'create' },
  { resource: 'property', action: 'update' },
  { resource: 'property', action: 'delete' },
  { resource: 'room', action: 'view' },
  { resource: 'room', action: 'create' },
  { resource: 'room', action: 'update' },
  { resource: 'room', action: 'delete' },
  { resource: 'tenant', action: 'view' },
  { resource: 'tenant', action: 'create' },
  { resource: 'tenant', action: 'update' },
  { resource: 'lease', action: 'view' },
  { resource: 'lease', action: 'create' },
  { resource: 'lease', action: 'update' },
  { resource: 'invoice', action: 'view' },
  { resource: 'invoice', action: 'create' },
  { resource: 'invoice', action: 'update' },
  { resource: 'payment', action: 'view' },
  { resource: 'payment', action: 'create' },
  { resource: 'payment', action: 'approve' },
  { resource: 'expense', action: 'view' },
  { resource: 'expense', action: 'create' },
  { resource: 'expense', action: 'approve' },
  { resource: 'report', action: 'view' },
  { resource: 'report', action: 'export' },
  { resource: 'audit', action: 'view' },
];

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  private async ensureUser(auth: AuthUser) {
    return this.prisma.user.upsert({
      where: { externalUserId: auth.externalUserId },
      create: {
        externalUserId: auth.externalUserId,
        email: auth.email,
      },
      update: {
        email: auth.email ?? undefined,
      },
    });
  }

  async listForUser(auth: AuthUser) {
    const user = await this.ensureUser(auth);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { workspace: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      status: m.workspace.status,
      roleKey: m.role.key,
      membershipId: m.id,
    }));
  }

  async create(auth: AuthUser, name: string, slugInput?: string) {
    const user = await this.ensureUser(auth);
    const baseSlug = this.slugify(slugInput || name) || `ws-${Date.now()}`;
    let slug = baseSlug;
    let attempt = 0;
    while (await this.prisma.workspace.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 20) {
        throw new ConflictException('Unable to allocate workspace slug');
      }
    }

    const workspace = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          key: 'owner',
          name: 'Owner',
          isSystem: true,
          permissions: {
            create: OWNER_PERMISSIONS,
          },
        },
      });

      const ws = await tx.workspace.create({
        data: {
          name,
          slug,
          ownerUserId: user.id,
          status: 'ONBOARDING',
          onboardingStep: 'create_property',
          members: {
            create: {
              userId: user.id,
              roleId: role.id,
              status: 'ACTIVE',
            },
          },
        },
      });

      await tx.role.update({
        where: { id: role.id },
        data: { workspaceId: ws.id },
      });

      return ws;
    });

    await this.audit.log({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: workspace.id,
      metadata: { name, slug: workspace.slug },
    });

    // trial subscription: lazy via SubscriptionsService.ensureTrial on first use
    const trialPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { key: 'trial' },
    });
    if (trialPlan) {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);
      await this.prisma.workspaceSubscription.create({
        data: {
          workspaceId: workspace.id,
          planId: trialPlan.id,
          status: 'TRIALING',
          trialEndsAt,
        },
      });
    }

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      roleKey: 'owner',
    };
  }

  async assertMember(auth: AuthUser, workspaceId: string) {
    const user = await this.ensureUser(auth);
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: user.id },
      },
      include: {
        role: { include: { permissions: true } },
        propertyAccess: true,
      },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new UnauthorizedException('Not a workspace member');
    }
    return { user, membership };
  }

  async assertPermission(
    auth: AuthUser,
    workspaceId: string,
    resource: string,
    action: string,
  ) {
    const ctx = await this.assertMember(auth, workspaceId);
    if (ctx.membership.role.key === 'owner') return ctx;
    const ok = ctx.membership.role.permissions.some(
      (p) => p.resource === resource && p.action === action,
    );
    if (!ok) {
      throw new UnauthorizedException(
        `Missing permission ${resource}:${action}`,
      );
    }
    return ctx;
  }

  /** null = all properties; string[] = limited (empty = none) */
  propertyScope(
    membership: {
      role: { key: string };
      propertyAccess: Array<{ propertyId: string; expiresAt: Date | null }>;
    },
  ): string[] | null {
    const key = membership.role.key;
    if (key === 'owner' || key === 'admin') return null;
    // finance: all unless explicitly scoped
    if (key === 'finance' && membership.propertyAccess.length === 0) {
      return null;
    }
    const now = new Date();
    return membership.propertyAccess
      .filter((a) => !a.expiresAt || a.expiresAt > now)
      .map((a) => a.propertyId);
  }

  /** Prisma where fragment for propertyId field */
  propertyIdFilter(
    membership: {
      role: { key: string };
      propertyAccess: Array<{ propertyId: string; expiresAt: Date | null }>;
    },
  ): { propertyId?: { in: string[] } } {
    const scope = this.propertyScope(membership);
    if (scope === null) return {};
    return { propertyId: { in: scope.length ? scope : ['__none__'] } };
  }

  assertPropertyInScope(
    membership: {
      role: { key: string };
      propertyAccess: Array<{ propertyId: string; expiresAt: Date | null }>;
    },
    propertyId: string | null | undefined,
  ) {
    if (!propertyId) return;
    const scope = this.propertyScope(membership);
    if (scope && !scope.includes(propertyId)) {
      throw new UnauthorizedException('Property out of scope');
    }
  }

  async updateSettings(
    auth: AuthUser,
    workspaceId: string,
    data: {
      name?: string;
      timezone?: string;
      logoUrl?: string;
      invoicePrefix?: string;
      defaultDueDay?: number;
      lateFeePercent?: number;
      bankAccountName?: string;
      bankAccountNo?: string;
      bankName?: string;
    },
  ) {
    await this.assertPermission(
      auth,
      workspaceId,
      'workspace',
      'manage_settings',
    );
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        name: data.name,
        timezone: data.timezone,
        logoUrl: data.logoUrl,
        invoicePrefix: data.invoicePrefix,
        defaultDueDay: data.defaultDueDay,
        lateFeePercent: data.lateFeePercent,
        bankAccountName: data.bankAccountName,
        bankAccountNo: data.bankAccountNo,
        bankName: data.bankName,
      },
    });
  }

  async get(auth: AuthUser, workspaceId: string) {
    await this.assertMember(auth, workspaceId);
    return this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
  }
}
