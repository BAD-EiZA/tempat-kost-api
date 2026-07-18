import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoomStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  BulkCreateRoomsDto,
  CreateRoomDto,
} from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private async assertProperty(workspaceId: string, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, workspaceId },
    });
    if (!property) {
      throw new NotFoundException('Property not found in workspace');
    }
    return property;
  }

  async list(
    auth: AuthUser,
    workspaceId: string,
    propertyId?: string,
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'room',
      'view',
    );
    const scope = this.workspaces.propertyScope(membership);
    if (propertyId) {
      this.workspaces.assertPropertyInScope(membership, propertyId);
    }
    return this.prisma.room.findMany({
      where: {
        workspaceId,
        ...(propertyId
          ? { propertyId }
          : scope
            ? { propertyId: { in: scope.length ? scope : ['__none__'] } }
            : {}),
        status: { not: RoomStatus.INACTIVE },
      },
      orderBy: [{ propertyId: 'asc' }, { code: 'asc' }],
      include: {
        property: { select: { id: true, name: true, code: true } },
        roomType: { select: { id: true, name: true } },
        building: { select: { id: true, name: true } },
        floor: { select: { id: true, name: true, level: true } },
      },
    });
  }

  async get(auth: AuthUser, id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        property: { select: { id: true, name: true, code: true } },
        roomType: { select: { id: true, name: true } },
        building: { select: { id: true, name: true } },
        floor: { select: { id: true, name: true, level: true } },
      },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    const { membership } = await this.workspaces.assertPermission(
      auth,
      room.workspaceId,
      'room',
      'view',
    );
    this.workspaces.assertPropertyInScope(membership, room.propertyId);
    return room;
  }

  async create(auth: AuthUser, dto: CreateRoomDto) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      dto.workspaceId,
      'room',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, dto.propertyId);
    await this.subscriptions.assertCanCreateRoom(dto.workspaceId);
    await this.assertProperty(dto.workspaceId, dto.propertyId);
    if (dto.roomTypeId) {
      const roomType = await this.prisma.roomType.findFirst({
        where: { id: dto.roomTypeId, workspaceId: dto.workspaceId },
      });
      if (!roomType) throw new NotFoundException('Room type not found');
    }
    if (dto.buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: dto.buildingId, workspaceId: dto.workspaceId, propertyId: dto.propertyId },
      });
      if (!building) throw new NotFoundException('Building not found');
    }
    if (dto.floorId) {
      const floor = await this.prisma.floor.findFirst({
        where: { id: dto.floorId, building: { workspaceId: dto.workspaceId, propertyId: dto.propertyId } },
      });
      if (!floor) throw new NotFoundException('Floor not found');
    }

    const code = (dto.code || dto.name).trim().toUpperCase();
    const exists = await this.prisma.room.findUnique({
      where: {
        propertyId_code: { propertyId: dto.propertyId, code },
      },
    });
    if (exists) {
      throw new ConflictException('Room code already exists on property');
    }

    const room = await this.prisma.room.create({
      data: {
        workspaceId: dto.workspaceId,
        propertyId: dto.propertyId,
        roomTypeId: dto.roomTypeId,
        buildingId: dto.buildingId,
        floorId: dto.floorId,
        name: dto.name,
        code,
        floorLabel: dto.floorLabel,
        rentAmount: dto.rentAmount ?? 0,
        depositAmount: dto.depositAmount ?? 0,
        capacity: dto.capacity ?? 1,
      },
    });

    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'room.created',
      entityType: 'room',
      entityId: room.id,
      metadata: { name: room.name, code: room.code },
    });

    return room;
  }

  async bulkCreate(auth: AuthUser, dto: BulkCreateRoomsDto) {
    if (dto.count > 100) {
      throw new BadRequestException('Max 100 rooms per bulk create');
    }
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      dto.workspaceId,
      'room',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, dto.propertyId);
    await this.subscriptions.assertCanCreateRoom(dto.workspaceId);
    await this.assertProperty(dto.workspaceId, dto.propertyId);

    const pad = String(dto.startNumber + dto.count - 1).length;
    const created = [];

    for (let i = 0; i < dto.count; i++) {
      const num = dto.startNumber + i;
      const suffix = String(num).padStart(pad, '0');
      const code = `${dto.prefix}${suffix}`.toUpperCase();
      const name = `${dto.prefix}${suffix}`;

      const exists = await this.prisma.room.findUnique({
        where: {
          propertyId_code: { propertyId: dto.propertyId, code },
        },
      });
      if (exists) {
        continue;
      }

      const room = await this.prisma.room.create({
        data: {
          workspaceId: dto.workspaceId,
          propertyId: dto.propertyId,
          roomTypeId: dto.roomTypeId,
          name,
          code,
          floorLabel: dto.floorLabel,
          rentAmount: dto.rentAmount ?? 0,
          depositAmount: dto.depositAmount ?? 0,
        },
      });
      created.push(room);
    }

    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'room.bulk_created',
      entityType: 'property',
      entityId: dto.propertyId,
      metadata: { count: created.length, prefix: dto.prefix },
    });

    return { created: created.length, rooms: created };
  }

  async update(auth: AuthUser, id: string, dto: UpdateRoomDto) {
    const existing = await this.get(auth, id);
    const { user } = await this.workspaces.assertPermission(
      auth,
      existing.workspaceId,
      'room',
      'update',
    );
    if (dto.roomTypeId) {
      const roomType = await this.prisma.roomType.findFirst({
        where: { id: dto.roomTypeId, workspaceId: existing.workspaceId },
      });
      if (!roomType) throw new NotFoundException('Room type not found');
    }
    if (dto.buildingId) {
      const building = await this.prisma.building.findFirst({
        where: { id: dto.buildingId, workspaceId: existing.workspaceId, propertyId: existing.propertyId },
      });
      if (!building) throw new NotFoundException('Building not found');
    }
    if (dto.floorId) {
      const floor = await this.prisma.floor.findFirst({
        where: { id: dto.floorId, building: { workspaceId: existing.workspaceId, propertyId: existing.propertyId } },
      });
      if (!floor) throw new NotFoundException('Floor not found');
    }

    const room = await this.prisma.room.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        roomTypeId: dto.roomTypeId,
        buildingId: dto.buildingId,
        floorId: dto.floorId,
        floorLabel: dto.floorLabel,
        rentAmount: dto.rentAmount,
        depositAmount: dto.depositAmount,
        capacity: dto.capacity,
        notes: dto.notes,
      },
    });

    await this.audit.log({
      workspaceId: existing.workspaceId,
      actorUserId: user.id,
      action: 'room.updated',
      entityType: 'room',
      entityId: id,
      metadata: dto as object,
    });

    return room;
  }
}
