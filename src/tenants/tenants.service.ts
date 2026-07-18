import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'tenant',
      'view',
    );
    const scope = this.workspaces.propertyScope(membership);
    if (scope === null) {
      return this.prisma.tenant.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { leases: true } } },
      });
    }
    // limited: tenants with lease on scoped properties, or no leases yet
    return this.prisma.tenant.findMany({
      where: {
        workspaceId,
        OR: [
          { leases: { some: { propertyId: { in: scope.length ? scope : ['__none__'] } } } },
          { leases: { none: {} } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { leases: true } } },
    });
  }

  async get(auth: AuthUser, id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        leases: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            room: { select: { id: true, name: true, code: true } },
            property: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const { membership } = await this.workspaces.assertPermission(
      auth,
      tenant.workspaceId,
      'tenant',
      'view',
    );
    const scope = this.workspaces.propertyScope(membership);
    if (scope && tenant.leases.length && !tenant.leases.some((l) => scope.includes(l.propertyId))) {
      throw new NotFoundException('Tenant not found');
    }
    return scope
      ? { ...tenant, leases: tenant.leases.filter((l) => scope.includes(l.propertyId)) }
      : tenant;
  }

  async create(auth: AuthUser, dto: CreateTenantDto) {
    const { user } = await this.workspaces.assertPermission(
      auth,
      dto.workspaceId,
      'tenant',
      'create',
    );
    const tenant = await this.prisma.tenant.create({
      data: {
        workspaceId: dto.workspaceId,
        fullName: dto.fullName,
        preferredName: dto.preferredName,
        email: dto.email,
        phone: dto.phone,
        occupation: dto.occupation,
        notes: dto.notes,
      },
    });
    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { fullName: tenant.fullName },
    });
    return tenant;
  }

  async update(auth: AuthUser, id: string, dto: UpdateTenantDto) {
    const existing = await this.get(auth, id);
    const { user } = await this.workspaces.assertPermission(
      auth,
      existing.workspaceId,
      'tenant',
      'update',
    );
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        preferredName: dto.preferredName,
        email: dto.email,
        phone: dto.phone,
        occupation: dto.occupation,
        notes: dto.notes,
        status: dto.status,
      },
    });
    await this.audit.log({
      workspaceId: existing.workspaceId,
      actorUserId: user.id,
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: id,
    });
    return tenant;
  }
}
