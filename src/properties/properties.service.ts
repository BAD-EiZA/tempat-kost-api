import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PropertyStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private codeify(name: string): string {
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20);
  }

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'property',
      'view',
    );
    const scope = this.workspaces.propertyScope(membership);
    return this.prisma.property.findMany({
      where: {
        workspaceId,
        status: { not: PropertyStatus.ARCHIVED },
        ...(scope ? { id: { in: scope } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { rooms: true } },
      },
    });
  }

  async get(auth: AuthUser, id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: { _count: { select: { rooms: true } } },
    });
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    const { membership } = await this.workspaces.assertPermission(
      auth,
      property.workspaceId,
      'property',
      'view',
    );
    const scope = this.workspaces.propertyScope(membership);
    if (scope && !scope.includes(id)) {
      throw new NotFoundException('Property not found');
    }
    return property;
  }

  async create(auth: AuthUser, dto: CreatePropertyDto) {
    const { user } = await this.workspaces.assertPermission(
      auth,
      dto.workspaceId,
      'property',
      'create',
    );
    await this.subscriptions.assertCanCreateProperty(dto.workspaceId);
    const baseCode = this.codeify(dto.code || dto.name) || 'PROP';
    let code = baseCode;
    let attempt = 0;
    while (
      await this.prisma.property.findUnique({
        where: {
          workspaceId_code: { workspaceId: dto.workspaceId, code },
        },
      })
    ) {
      attempt += 1;
      code = `${baseCode}-${attempt}`;
      if (attempt > 50) {
        throw new ConflictException('Unable to allocate property code');
      }
    }

    const property = await this.prisma.property.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name,
        code,
        status: PropertyStatus.ACTIVE,
        addressLine: dto.addressLine,
        city: dto.city,
        province: dto.province,
        contactPhone: dto.contactPhone,
      },
    });

    await this.prisma.workspace.update({
      where: { id: dto.workspaceId },
      data: {
        status: 'ACTIVE',
        onboardingStep: 'add_rooms',
      },
    });

    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'property.created',
      entityType: 'property',
      entityId: property.id,
      metadata: { name: property.name, code: property.code },
    });

    return property;
  }

  async update(auth: AuthUser, id: string, dto: UpdatePropertyDto) {
    const existing = await this.get(auth, id);
    const { user } = await this.workspaces.assertPermission(
      auth,
      existing.workspaceId,
      'property',
      'update',
    );

    const property = await this.prisma.property.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        addressLine: dto.addressLine,
        city: dto.city,
        province: dto.province,
        contactPhone: dto.contactPhone,
      },
    });

    await this.audit.log({
      workspaceId: existing.workspaceId,
      actorUserId: user.id,
      action: 'property.updated',
      entityType: 'property',
      entityId: id,
      metadata: dto as object,
    });

    return property;
  }

  async archive(auth: AuthUser, id: string) {
    const existing = await this.get(auth, id);
    const { user } = await this.workspaces.assertPermission(
      auth,
      existing.workspaceId,
      'property',
      'delete',
    );

    const property = await this.prisma.property.update({
      where: { id },
      data: { status: PropertyStatus.ARCHIVED },
    });

    await this.audit.log({
      workspaceId: existing.workspaceId,
      actorUserId: user.id,
      action: 'property.archived',
      entityType: 'property',
      entityId: id,
    });

    return property;
  }
}
