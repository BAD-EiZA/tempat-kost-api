import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const ALL_ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'approve',
  'export',
  'manage_settings',
  'manage_access',
] as const;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, workspaceId: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.role.findMany({
      where: { workspaceId },
      include: { permissions: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createCustom(
    auth: AuthUser,
    input: {
      workspaceId: string;
      key: string;
      name: string;
      permissions: Array<{ resource: string; action: string }>;
    },
  ) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'workspace',
      'manage_access',
    );
    // cannot grant more than creator has (owner has all)
    if (membership.role.key !== 'owner') {
      const allowed = new Set(
        membership.role.permissions.map((p) => `${p.resource}:${p.action}`),
      );
      for (const p of input.permissions) {
        if (!allowed.has(`${p.resource}:${p.action}`)) {
          throw new BadRequestException(
            `Cannot grant ${p.resource}:${p.action} beyond your role`,
          );
        }
      }
    }
    const key = input.key
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .slice(0, 40);
    const role = await this.prisma.role.create({
      data: {
        workspaceId: input.workspaceId,
        key,
        name: input.name,
        isSystem: false,
        permissions: {
          create: input.permissions.map((p) => ({
            resource: p.resource,
            action: p.action,
          })),
        },
      },
      include: { permissions: true },
    });
    await this.audit.log({
      workspaceId: input.workspaceId,
      actorUserId: user.id,
      action: 'role.created',
      entityType: 'role',
      entityId: role.id,
    });
    return role;
  }

  async setPermissions(
    auth: AuthUser,
    roleId: string,
    permissions: Array<{ resource: string; action: string }>,
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role?.workspaceId) throw new NotFoundException('Role not found');
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      role.workspaceId,
      'workspace',
      'manage_access',
    );
    if (role.key === 'owner') {
      throw new BadRequestException('Cannot edit owner role');
    }
    if (membership.role.key !== 'owner') {
      const allowed = new Set(
        membership.role.permissions.map((p) => `${p.resource}:${p.action}`),
      );
      for (const p of permissions) {
        if (!allowed.has(`${p.resource}:${p.action}`)) {
          throw new BadRequestException(
            `Cannot grant ${p.resource}:${p.action}`,
          );
        }
      }
    }
    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    await this.prisma.rolePermission.createMany({
      data: permissions.map((p) => ({
        roleId,
        resource: p.resource,
        action: p.action,
      })),
    });
    await this.audit.log({
      workspaceId: role.workspaceId,
      actorUserId: user.id,
      action: 'role.permissions_updated',
      entityType: 'role',
      entityId: roleId,
    });
    return this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });
  }

  catalog() {
    const resources = [
      'workspace',
      'property',
      'room',
      'tenant',
      'lease',
      'invoice',
      'payment',
      'expense',
      'report',
      'maintenance',
      'audit',
    ];
    return { resources, actions: ALL_ACTIONS };
  }
}
