import { Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
    private readonly ai: AiService,
  ) {}

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'maintenance',
      'view',
    );
    return this.prisma.maintenanceRequest.findMany({
      where: {
        workspaceId,
        ...this.workspaces.propertyIdFilter(membership),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
        tenant: { select: { id: true, fullName: true } },
      },
    });
  }

  async create(
    auth: AuthUser,
    input: {
      workspaceId: string;
      propertyId: string;
      roomId?: string;
      tenantId?: string;
      title: string;
      description: string;
      category?: string;
      urgency?: string;
      photoUrls?: string[];
      runAi?: boolean;
    },
  ) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'maintenance',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    const [property, room, tenant] = await Promise.all([
      this.prisma.property.findFirst({ where: { id: input.propertyId, workspaceId: input.workspaceId } }),
      input.roomId
        ? this.prisma.room.findFirst({ where: { id: input.roomId, workspaceId: input.workspaceId, propertyId: input.propertyId } })
        : null,
      input.tenantId
        ? this.prisma.tenant.findFirst({ where: { id: input.tenantId, workspaceId: input.workspaceId } })
        : null,
    ]);
    if (!property) throw new NotFoundException('Property not found');
    if (input.roomId && !room) throw new NotFoundException('Room not found');
    if (input.tenantId && !tenant) throw new NotFoundException('Tenant not found');

    let aiJson: Record<string, unknown> | undefined;
    let urgency = input.urgency ?? 'medium';
    let category = input.category;
    let estimateLow: number | undefined;
    let estimateHigh: number | undefined;
    let estimatedCost: number | undefined;

    if (input.runAi) {
      try {
        const job = await this.ai.triageMaintenance(auth, {
          workspaceId: input.workspaceId,
          description: input.description,
          categoryHint: input.category,
        });
        const result = (job.resultJson ?? {}) as Record<string, unknown>;
        aiJson = { triage: result, jobId: job.id };
        if (typeof result.urgency === 'string') urgency = result.urgency;
        if (typeof result.category === 'string') category = result.category;

        if (input.photoUrls?.length) {
          try {
            const dmg = await this.ai.analyzeDamage(auth, {
              workspaceId: input.workspaceId,
              imageUrls: input.photoUrls,
              description: input.description,
            });
            aiJson = {
              ...aiJson,
              damage: dmg.resultJson,
              damageJobId: dmg.id,
            };
          } catch {
            /* optional */
          }
        }

        try {
          const est = await this.ai.estimateRepair(auth, {
            workspaceId: input.workspaceId,
            description: input.description,
            imageUrls: input.photoUrls,
          });
          const er = (est.resultJson ?? {}) as Record<string, unknown>;
          estimateLow = Number(er.lowAmount ?? 0) || undefined;
          estimateHigh = Number(er.highAmount ?? 0) || undefined;
          if (estimateLow != null && estimateHigh != null) {
            estimatedCost = Math.round((estimateLow + estimateHigh) / 2);
          }
          aiJson = {
            ...aiJson,
            estimate: er,
            estimateJobId: est.id,
          };
        } catch {
          /* optional */
        }
      } catch {
        /* AI optional */
      }
    }

    const req = await this.prisma.maintenanceRequest.create({
      data: {
        workspaceId: input.workspaceId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        tenantId: input.tenantId,
        title: input.title,
        description: input.description,
        category,
        urgency,
        photoUrls: input.photoUrls?.length
          ? (input.photoUrls as unknown as Prisma.InputJsonValue)
          : undefined,
        aiJson: aiJson as Prisma.InputJsonValue | undefined,
        estimateLow,
        estimateHigh,
        estimatedCost,
      },
    });
    await this.audit.log({
      workspaceId: input.workspaceId,
      actorUserId: user.id,
      action: 'maintenance.created',
      entityType: 'maintenance_request',
      entityId: req.id,
    });
    return req;
  }

  async updateStatus(
    auth: AuthUser,
    id: string,
    status: MaintenanceStatus,
    assignedTo?: string,
  ) {
    const existing = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Not found');
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      existing.workspaceId,
      'maintenance',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, existing.propertyId);
    const updated = await this.prisma.maintenanceRequest.update({
      where: { id },
      data: {
        status,
        assignedTo,
        resolvedAt:
          status === 'RESOLVED' || status === 'CLOSED'
            ? new Date()
            : existing.resolvedAt,
      },
    });
    await this.audit.log({
      workspaceId: existing.workspaceId,
      actorUserId: user.id,
      action: 'maintenance.status_updated',
      entityType: 'maintenance_request',
      entityId: id,
      metadata: { status },
    });
    return updated;
  }
}
