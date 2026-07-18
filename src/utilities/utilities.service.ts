import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateUtilityPolicyDto } from './dto/create-utility-policy.dto';

@Injectable()
export class UtilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  async listPolicies(auth: AuthUser, workspaceId: string, propertyId?: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth, workspaceId, 'utility', 'view',
    );
    if (propertyId) this.workspaces.assertPropertyInScope(membership, propertyId);
    return this.prisma.utilityBillingPolicy.findMany({
      where: {
        workspaceId,
        ...(propertyId ? { propertyId } : this.workspaces.propertyIdFilter(membership)),
        isActive: true,
      },
      include: {
        property: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPolicy(auth: AuthUser, dto: CreateUtilityPolicyDto) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth, dto.workspaceId, 'utility', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, dto.propertyId);
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, workspaceId: dto.workspaceId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const policy = await this.prisma.utilityBillingPolicy.create({
      data: {
        workspaceId: dto.workspaceId,
        propertyId: dto.propertyId,
        utilityType: dto.utilityType ?? 'ELECTRICITY',
        payerType: dto.payerType,
        billingMethod: dto.billingMethod,
        ratePerUnit: dto.ratePerUnit,
        fixedMonthlyFee: dto.fixedMonthlyFee,
        ownerUnitAllowance: dto.ownerUnitAllowance,
      },
    });

    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'utility_policy.created',
      entityType: 'utility_billing_policy',
      entityId: policy.id,
    });

    return policy;
  }

  async generateBillFromReading(
    auth: AuthUser,
    input: { readingId: string; leaseId?: string },
  ) {
    const reading = await this.prisma.meterReading.findUnique({
      where: { id: input.readingId },
      include: {
        meter: {
          include: {
            property: true,
            room: true,
          },
        },
      },
    });
    if (!reading) throw new NotFoundException('Reading not found');
    const { membership } = await this.workspaces.assertPermission(
      auth, reading.meter.workspaceId, 'invoice', 'create',
    );
    this.workspaces.assertPropertyInScope(membership, reading.meter.propertyId);
    if (reading.status !== 'VERIFIED' && reading.status !== 'RECORDED') {
      throw new NotFoundException('Reading not ready');
    }

    const policy = await this.prisma.utilityBillingPolicy.findFirst({
      where: {
        workspaceId: reading.meter.workspaceId,
        propertyId: reading.meter.propertyId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const calc = this.calculateCharge({
      payerType: policy?.payerType ?? 'TENANT',
      billingMethod: policy?.billingMethod ?? 'INDIVIDUAL_POSTPAID_METER',
      consumption: Number(reading.consumption),
      ratePerUnit: policy?.ratePerUnit
        ? Number(policy.ratePerUnit)
        : 1700,
      fixedMonthlyFee: policy?.fixedMonthlyFee
        ? Number(policy.fixedMonthlyFee)
        : null,
      ownerUnitAllowance: policy?.ownerUnitAllowance
        ? Number(policy.ownerUnitAllowance)
        : null,
    });

    let lease =
      input.leaseId
        ? await this.prisma.lease.findFirst({
            where: {
              id: input.leaseId,
              workspaceId: reading.meter.workspaceId,
              propertyId: reading.meter.propertyId,
              ...(reading.meter.roomId ? { roomId: reading.meter.roomId } : {}),
            },
          })
        : null;
    if (!lease && reading.meter.roomId) {
      lease = await this.prisma.lease.findFirst({
        where: {
          roomId: reading.meter.roomId,
          workspaceId: reading.meter.workspaceId,
          propertyId: reading.meter.propertyId,
          status: { in: ['ACTIVE', 'ENDING_SOON'] },
        },
      });
    }

    const tenantCharge = Number(calc.tenantCharge.toFixed(2));
    const ownerCost = Number(calc.ownerCost.toFixed(2));
    let invoice = null;
    let expense = null;

    if (
      tenantCharge > 0 &&
      (policy?.payerType === 'TENANT' || policy?.payerType === 'SHARED')
    ) {
      if (!lease) throw new NotFoundException('Active lease required for tenant charge');
      const year = new Date().getFullYear();
      const count = await this.prisma.invoice.count({
        where: { workspaceId: reading.meter.workspaceId },
      });
      const invoiceNumber = `INV-${year}-U${String(count + 1).padStart(5, '0')}`;
      invoice = await this.prisma.invoice.create({
        data: {
          workspaceId: reading.meter.workspaceId,
          propertyId: reading.meter.propertyId,
          tenantId: lease.tenantId,
          leaseId: lease.id,
          invoiceNumber,
          type: 'UTILITY',
          status: 'OPEN',
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 7 * 86400000),
          subtotal: tenantCharge,
          total: tenantCharge,
          issuedAt: new Date(),
          notes: `Listrik ${reading.periodLabel}: ${reading.consumption} unit`,
          items: {
            create: [
              {
                description: `Listrik ${reading.periodLabel} (${reading.consumption} kWh)`,
                quantity: 1,
                unitPrice: tenantCharge,
                amount: tenantCharge,
              },
            ],
          },
        },
      });
    }

    if (
      ownerCost > 0 &&
      (policy?.payerType === 'OWNER' ||
        policy?.payerType === 'SHARED' ||
        policy?.payerType === 'INCLUDED_IN_RENT')
    ) {
      expense = await this.prisma.expense.create({
        data: {
          workspaceId: reading.meter.workspaceId,
          propertyId: reading.meter.propertyId,
          category: 'electricity',
          expenseDate: new Date(),
          amount: ownerCost,
          description: `Owner utility ${reading.periodLabel}`,
          status: 'APPROVED',
        },
      });
    }

    await this.prisma.meterReading.update({
      where: { id: reading.id },
      data: { status: 'BILLED' },
    });

    return {
      calc: {
        tenantCharge: calc.tenantCharge.toFixed(2),
        ownerCost: calc.ownerCost.toFixed(2),
        billableUnits: calc.billableUnits.toFixed(4),
      },
      invoice,
      expense,
    };
  }

  /**
   * Deterministic shared electricity calc (PRD example).
   * tenantCharge = max(0, consumption - ownerUnitAllowance) * rate
   * ownerCost = min(consumption, ownerUnitAllowance) * rate  when SHARED
   */
  calculateCharge(input: {
    payerType: string;
    billingMethod: string;
    consumption: number;
    ratePerUnit?: number | null;
    fixedMonthlyFee?: number | null;
    ownerUnitAllowance?: number | null;
  }) {
    const rate = new Prisma.Decimal(input.ratePerUnit ?? 0);
    const consumption = new Prisma.Decimal(input.consumption);
    const allowance = new Prisma.Decimal(input.ownerUnitAllowance ?? 0);
    const fixed = new Prisma.Decimal(input.fixedMonthlyFee ?? 0);

    if (input.payerType === 'OWNER' || input.payerType === 'INCLUDED_IN_RENT') {
      const ownerCost =
        input.billingMethod === 'FIXED_MONTHLY'
          ? fixed
          : consumption.mul(rate);
      return {
        tenantCharge: new Prisma.Decimal(0),
        ownerCost,
        billableUnits: consumption,
      };
    }

    if (input.billingMethod === 'FIXED_MONTHLY') {
      return {
        tenantCharge: fixed,
        ownerCost: new Prisma.Decimal(0),
        billableUnits: new Prisma.Decimal(0),
      };
    }

    if (input.payerType === 'SHARED') {
      const tenantUnits = Prisma.Decimal.max(
        consumption.sub(allowance),
        new Prisma.Decimal(0),
      );
      const ownerUnits = Prisma.Decimal.min(consumption, allowance);
      return {
        tenantCharge: tenantUnits.mul(rate),
        ownerCost: ownerUnits.mul(rate),
        billableUnits: tenantUnits,
      };
    }

    // TENANT
    return {
      tenantCharge: consumption.mul(rate),
      ownerCost: new Prisma.Decimal(0),
      billableUnits: consumption,
    };
  }
}
