import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaseStatus, RoomStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { DepositsService } from '../deposits/deposits.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateLeaseDto } from './dto/create-lease.dto';

const ACTIVE_LIKE: LeaseStatus[] = [
  LeaseStatus.ACTIVE,
  LeaseStatus.UPCOMING,
  LeaseStatus.ENDING_SOON,
  LeaseStatus.PENDING_SIGNATURE,
  LeaseStatus.PENDING_APPROVAL,
];

@Injectable()
export class LeasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
    private readonly deposits: DepositsService,
  ) {}

  private async nextLeaseNumber(workspaceId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.lease.count({ where: { workspaceId } });
    return `LS-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  async list(auth: AuthUser, workspaceId: string, propertyId?: string) {
    const { membership } = await this.workspaces.assertMember(
      auth,
      workspaceId,
    );
    if (propertyId) {
      this.workspaces.assertPropertyInScope(membership, propertyId);
    }
    const scopeFilter = propertyId
      ? { propertyId }
      : this.workspaces.propertyIdFilter(membership);
    return this.prisma.lease.findMany({
      where: {
        workspaceId,
        ...scopeFilter,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { id: true, fullName: true, phone: true } },
        room: { select: { id: true, name: true, code: true } },
        property: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async get(auth: AuthUser, id: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id },
      include: {
        tenant: true,
        room: true,
        property: true,
      },
    });
    if (!lease) throw new NotFoundException('Lease not found');
    await this.workspaces.assertMember(auth, lease.workspaceId);
    return lease;
  }

  async create(auth: AuthUser, dto: CreateLeaseDto) {
    const { user } = await this.workspaces.assertMember(auth, dto.workspaceId);

    const [room, tenant] = await Promise.all([
      this.prisma.room.findFirst({
        where: {
          id: dto.roomId,
          workspaceId: dto.workspaceId,
          propertyId: dto.propertyId,
        },
      }),
      this.prisma.tenant.findFirst({
        where: { id: dto.tenantId, workspaceId: dto.workspaceId },
      }),
    ]);
    if (!room) throw new NotFoundException('Room not found in property');
    if (!tenant) throw new NotFoundException('Tenant not found');

    const activeOnRoom = await this.prisma.lease.count({
      where: {
        roomId: dto.roomId,
        status: { in: ACTIVE_LIKE },
      },
    });
    if (activeOnRoom >= room.capacity) {
      throw new BadRequestException(
        'Room capacity exceeded for active/upcoming leases',
      );
    }

    const leaseNumber = await this.nextLeaseNumber(dto.workspaceId);
    const lease = await this.prisma.lease.create({
      data: {
        workspaceId: dto.workspaceId,
        propertyId: dto.propertyId,
        roomId: dto.roomId,
        tenantId: dto.tenantId,
        leaseNumber,
        status: LeaseStatus.DRAFT,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        rentAmount: dto.rentAmount,
        depositAmount: dto.depositAmount ?? room.depositAmount,
        dueDay: dto.dueDay ?? 1,
        notes: dto.notes,
      },
    });

    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'lease.created',
      entityType: 'lease',
      entityId: lease.id,
      metadata: { leaseNumber },
    });

    return lease;
  }

  async activate(
    auth: AuthUser,
    id: string,
    checklist?: {
      identityVerified?: boolean;
      contractSigned?: boolean;
      depositRecorded?: boolean;
      initialPaymentOk?: boolean;
      roomConditionNotes?: string;
      meterInitial?: number;
      keysHanded?: boolean;
      rulesAccepted?: boolean;
      notes?: string;
    },
  ) {
    const lease = await this.get(auth, id);
    if (lease.status === LeaseStatus.ACTIVE) {
      return lease;
    }
    if (
      lease.status === LeaseStatus.ENDED ||
      lease.status === LeaseStatus.TERMINATED ||
      lease.status === LeaseStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot activate closed lease');
    }

    const { user } = await this.workspaces.assertMember(
      auth,
      lease.workspaceId,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.lease.update({
        where: { id },
        data: {
          status: LeaseStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });
      await tx.room.update({
        where: { id: lease.roomId },
        data: { status: RoomStatus.OCCUPIED },
      });
      await tx.tenant.update({
        where: { id: lease.tenantId },
        data: { status: 'ACTIVE' },
      });
      await this.deposits.ensureForLease(tx, {
        workspaceId: lease.workspaceId,
        tenantId: lease.tenantId,
        leaseId: lease.id,
        depositAmount: lease.depositAmount,
      });
      await tx.checkinRecord.upsert({
        where: { leaseId: id },
        create: {
          leaseId: id,
          identityVerified: checklist?.identityVerified ?? true,
          contractSigned: checklist?.contractSigned ?? true,
          depositRecorded: checklist?.depositRecorded ?? true,
          initialPaymentOk: checklist?.initialPaymentOk ?? false,
          roomConditionNotes: checklist?.roomConditionNotes,
          meterInitial: checklist?.meterInitial,
          keysHanded: checklist?.keysHanded ?? true,
          rulesAccepted: checklist?.rulesAccepted ?? true,
          notes: checklist?.notes,
        },
        update: {
          identityVerified: checklist?.identityVerified ?? true,
          contractSigned: checklist?.contractSigned ?? true,
          depositRecorded: checklist?.depositRecorded ?? true,
          keysHanded: checklist?.keysHanded ?? true,
          rulesAccepted: checklist?.rulesAccepted ?? true,
          notes: checklist?.notes,
        },
      });
      return updated;
    });

    await this.audit.log({
      workspaceId: lease.workspaceId,
      actorUserId: user.id,
      action: 'lease.activated',
      entityType: 'lease',
      entityId: id,
    });

    return result;
  }

  async end(
    auth: AuthUser,
    id: string,
    checkout?: {
      exitDate?: string;
      inspectionNotes?: string;
      meterFinal?: number;
      keysReturned?: boolean;
      damageCost?: number;
      depositSettlement?: string;
      notes?: string;
    },
  ) {
    const lease = await this.get(auth, id);
    if (lease.status !== LeaseStatus.ACTIVE && lease.status !== LeaseStatus.ENDING_SOON) {
      throw new BadRequestException('Only active leases can be ended');
    }
    const { user } = await this.workspaces.assertMember(
      auth,
      lease.workspaceId,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.lease.update({
        where: { id },
        data: {
          status: LeaseStatus.ENDED,
          endedAt: new Date(),
        },
      });
      const otherActive = await tx.lease.count({
        where: {
          roomId: lease.roomId,
          id: { not: id },
          status: { in: [LeaseStatus.ACTIVE, LeaseStatus.ENDING_SOON] },
        },
      });
      if (otherActive === 0) {
        await tx.room.update({
          where: { id: lease.roomId },
          data: { status: RoomStatus.AVAILABLE },
        });
      }
      await tx.checkoutRecord.upsert({
        where: { leaseId: id },
        create: {
          leaseId: id,
          exitDate: checkout?.exitDate
            ? new Date(checkout.exitDate)
            : new Date(),
          inspectionNotes: checkout?.inspectionNotes,
          meterFinal: checkout?.meterFinal,
          keysReturned: checkout?.keysReturned ?? true,
          damageCost: checkout?.damageCost ?? 0,
          depositSettlement: checkout?.depositSettlement,
          notes: checkout?.notes,
        },
        update: {
          inspectionNotes: checkout?.inspectionNotes,
          meterFinal: checkout?.meterFinal,
          keysReturned: checkout?.keysReturned ?? true,
          damageCost: checkout?.damageCost ?? 0,
          depositSettlement: checkout?.depositSettlement,
          notes: checkout?.notes,
        },
      });
      return updated;
    });

    await this.audit.log({
      workspaceId: lease.workspaceId,
      actorUserId: user.id,
      action: 'lease.ended',
      entityType: 'lease',
      entityId: id,
    });

    return result;
  }
}
