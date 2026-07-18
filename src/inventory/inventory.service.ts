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
    await this.workspaces.assertMember(auth, workspaceId);
    return this.prisma.inventoryItem.findMany({
      where: { workspaceId },
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
    await this.workspaces.assertMember(auth, input.workspaceId);
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
    await this.workspaces.assertMember(auth, item.workspaceId);
    return this.prisma.inventoryItem.update({ where: { id }, data });
  }

  async archive(auth: AuthUser, id: string) {
    return this.update(auth, id, { status: 'archived' });
  }
}
