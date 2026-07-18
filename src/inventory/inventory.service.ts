import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth, workspaceId, 'inventory', 'view',
    );
    return this.prisma.inventoryItem.findMany({
      where: { workspaceId, ...this.workspaces.propertyIdFilter(membership) },
      orderBy: { createdAt: 'desc' },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
      },
    });
  }

  async create(
    auth: AuthUser,
    input: {
      workspaceId: string;
      propertyId?: string;
      roomId?: string;
      name: string;
      code?: string;
      category?: string;
      condition?: string;
    },
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth, input.workspaceId, 'inventory', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    const [property, room] = await Promise.all([
      input.propertyId
        ? this.prisma.property.findFirst({ where: { id: input.propertyId, workspaceId: input.workspaceId } })
        : null,
      input.roomId
        ? this.prisma.room.findFirst({ where: { id: input.roomId, workspaceId: input.workspaceId, ...(input.propertyId ? { propertyId: input.propertyId } : {}) } })
        : null,
    ]);
    if (input.propertyId && !property) throw new NotFoundException('Property not found');
    if (input.roomId && !room) throw new NotFoundException('Room not found');
    return this.prisma.inventoryItem.create({
      data: {
        workspaceId: input.workspaceId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        name: input.name,
        code: input.code,
        category: input.category,
        condition: input.condition ?? 'good',
      },
    });
  }

  async update(
    auth: AuthUser,
    id: string,
    data: {
      name?: string;
      code?: string;
      category?: string;
      condition?: string;
      status?: string;
      propertyId?: string | null;
      roomId?: string | null;
      notes?: string;
    },
  ) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth, item.workspaceId, 'inventory', 'update',
    );
    this.workspaces.assertPropertyInScope(membership, item.propertyId);
    const propertyId = data.propertyId === undefined ? item.propertyId : data.propertyId;
    this.workspaces.assertPropertyInScope(membership, propertyId);
    const [property, room] = await Promise.all([
      propertyId
        ? this.prisma.property.findFirst({ where: { id: propertyId, workspaceId: item.workspaceId } })
        : null,
      data.roomId
        ? this.prisma.room.findFirst({ where: { id: data.roomId, workspaceId: item.workspaceId, ...(propertyId ? { propertyId } : {}) } })
        : null,
    ]);
    if (propertyId && !property) throw new NotFoundException('Property not found');
    if (data.roomId && !room) throw new NotFoundException('Room not found');
    return this.prisma.inventoryItem.update({ where: { id }, data });
  }

  async archive(auth: AuthUser, id: string) {
    return this.update(auth, id, { status: 'archived' });
  }
}
