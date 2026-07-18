import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async listBuildings(auth: AuthUser, propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth, property.workspaceId, 'room', 'view',
    );
    this.workspaces.assertPropertyInScope(membership, property.id);
    return this.prisma.building.findMany({
      where: { propertyId },
      include: { floors: { orderBy: { level: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async createBuilding(
    auth: AuthUser,
    input: { propertyId: string; name: string; code?: string },
  ) {
    const property = await this.prisma.property.findUnique({
      where: { id: input.propertyId },
    });
    if (!property) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth, property.workspaceId, 'room', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, property.id);
    return this.prisma.building.create({
      data: {
        workspaceId: property.workspaceId,
        propertyId: input.propertyId,
        name: input.name,
        code: input.code,
      },
    });
  }

  async createFloor(
    auth: AuthUser,
    input: { buildingId: string; name: string; level?: number },
  ) {
    const building = await this.prisma.building.findUnique({
      where: { id: input.buildingId },
      include: { property: true },
    });
    if (!building) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth, building.property.workspaceId, 'room', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, building.propertyId);
    return this.prisma.floor.create({
      data: {
        buildingId: input.buildingId,
        name: input.name,
        level: input.level ?? 1,
      },
    });
  }

  async listRoomTypes(auth: AuthUser, workspaceId: string, propertyId?: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth, workspaceId, 'room', 'view',
    );
    if (propertyId) this.workspaces.assertPropertyInScope(membership, propertyId);
    return this.prisma.roomType.findMany({
      where: {
        workspaceId,
        ...(propertyId ? { propertyId } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createRoomType(
    auth: AuthUser,
    input: {
      workspaceId: string;
      propertyId?: string;
      name: string;
      baseRent?: number;
      defaultDeposit?: number;
      capacity?: number;
      description?: string;
    },
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth, input.workspaceId, 'room', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    if (input.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: input.propertyId, workspaceId: input.workspaceId },
      });
      if (!property) throw new NotFoundException('Property not found');
    }
    return this.prisma.roomType.create({
      data: {
        workspaceId: input.workspaceId,
        propertyId: input.propertyId,
        name: input.name,
        baseRent: input.baseRent ?? 0,
        defaultDeposit: input.defaultDeposit ?? 0,
        capacity: input.capacity ?? 1,
        description: input.description,
      },
    });
  }
}
