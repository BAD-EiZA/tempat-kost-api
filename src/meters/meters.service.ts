import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class MetersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async listMeters(auth: AuthUser, workspaceId: string, propertyId?: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth, workspaceId, 'utility', 'view',
    );
    if (propertyId) this.workspaces.assertPropertyInScope(membership, propertyId);
    return this.prisma.utilityMeter.findMany({
      where: {
        workspaceId,
        ...(propertyId ? { propertyId } : this.workspaces.propertyIdFilter(membership)),
        isActive: true,
      },
      include: {
        property: { select: { id: true, name: true } },
        room: { select: { id: true, name: true } },
        readings: { orderBy: { readAt: 'desc' }, take: 1 },
      },
    });
  }

  async createMeter(
    auth: AuthUser,
    input: {
      workspaceId: string;
      propertyId: string;
      roomId?: string;
      label: string;
      meterNumber?: string;
    },
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth, input.workspaceId, 'utility', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, input.propertyId);
    const [property, room] = await Promise.all([
      this.prisma.property.findFirst({ where: { id: input.propertyId, workspaceId: input.workspaceId } }),
      input.roomId
        ? this.prisma.room.findFirst({ where: { id: input.roomId, workspaceId: input.workspaceId, propertyId: input.propertyId } })
        : null,
    ]);
    if (!property) throw new NotFoundException('Property not found');
    if (input.roomId && !room) throw new NotFoundException('Room not found');
    return this.prisma.utilityMeter.create({
      data: {
        workspaceId: input.workspaceId,
        propertyId: input.propertyId,
        roomId: input.roomId,
        label: input.label,
        meterNumber: input.meterNumber,
      },
    });
  }

  async recordReading(
    auth: AuthUser,
    input: {
      meterId: string;
      periodLabel: string;
      previousReading: number;
      currentReading: number;
      photoUrl?: string;
    },
  ) {
    const meter = await this.prisma.utilityMeter.findUnique({
      where: { id: input.meterId },
    });
    if (!meter) throw new NotFoundException('Meter not found');
    const { membership } = await this.workspaces.assertPermission(
      auth, meter.workspaceId, 'utility', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, meter.propertyId);

    if (input.currentReading < input.previousReading) {
      throw new BadRequestException(
        'Current reading cannot be less than previous (unless meter reset — not supported yet)',
      );
    }

    const consumption = new Prisma.Decimal(input.currentReading).sub(
      input.previousReading,
    );

    return this.prisma.meterReading.create({
      data: {
        meterId: input.meterId,
        periodLabel: input.periodLabel,
        previousReading: input.previousReading,
        currentReading: input.currentReading,
        consumption,
        photoUrl: input.photoUrl,
        status: 'RECORDED',
      },
    });
  }

  async verifyReading(auth: AuthUser, id: string) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id },
      include: { meter: true },
    });
    if (!reading) throw new NotFoundException('Reading not found');
    const { membership } = await this.workspaces.assertPermission(
      auth, reading.meter.workspaceId, 'utility', 'approve',
    );
    this.workspaces.assertPropertyInScope(membership, reading.meter.propertyId);
    return this.prisma.meterReading.update({
      where: { id },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });
  }
}
