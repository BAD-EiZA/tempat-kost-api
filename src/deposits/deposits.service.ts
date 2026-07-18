import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DepositTxnType, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'payment',
      'view',
    );
    const scope = this.workspaces.propertyScope(membership);
    return this.prisma.depositAccount.findMany({
      where: {
        workspaceId,
        ...(scope
          ? {
              lease: {
                propertyId: { in: scope.length ? scope : ['__none__'] },
              },
            }
          : {}),
      },
      include: {
        tenant: { select: { id: true, fullName: true } },
        lease: { select: { id: true, leaseNumber: true, status: true } },
        transactions: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async ensureForLease(
    tx: Prisma.TransactionClient,
    input: {
      workspaceId: string;
      tenantId: string;
      leaseId: string;
      depositAmount: Prisma.Decimal | number | string;
    },
  ) {
    const existing = await tx.depositAccount.findUnique({
      where: { leaseId: input.leaseId },
    });
    if (existing) return existing;

    const charged = new Prisma.Decimal(input.depositAmount);
    const account = await tx.depositAccount.create({
      data: {
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        leaseId: input.leaseId,
        balance: new Prisma.Decimal(0),
      },
    });

    if (charged.greaterThan(0)) {
      await tx.depositTransaction.create({
        data: {
          depositAccountId: account.id,
          type: DepositTxnType.CHARGED,
          amount: charged,
          balanceAfter: new Prisma.Decimal(0),
          reason: 'Deposit charged on lease activation',
        },
      });
    }

    return account;
  }

  async record(
    auth: AuthUser,
    input: {
      depositAccountId: string;
      type: DepositTxnType;
      amount: number;
      reason?: string;
    },
  ) {
    const account = await this.prisma.depositAccount.findUnique({
      where: { id: input.depositAccountId },
      include: { lease: { select: { propertyId: true } } },
    });
    if (!account) throw new NotFoundException('Deposit account not found');
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      account.workspaceId,
      'payment',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, account.lease.propertyId);

    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be positive');
    }
    if (input.type === DepositTxnType.DEDUCTION) {
      throw new BadRequestException('Deposit deductions require approval');
    }

    let next = new Prisma.Decimal(account.balance);
    if (
      input.type === DepositTxnType.PAID ||
      input.type === DepositTxnType.ADDITIONAL
    ) {
      next = next.add(amount);
    } else if (input.type === DepositTxnType.REFUND) {
      next = next.sub(amount);
    } else if (input.type === DepositTxnType.ADJUSTMENT) {
      next = next.add(amount);
    } else if (input.type === DepositTxnType.CHARGED) {
      // liability note only — balance unchanged until paid
    }

    if (next.lessThan(0)) {
      throw new BadRequestException('Deposit balance cannot go negative');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.depositAccount.updateMany({
        where: { id: account.id, balance: account.balance },
        data: { balance: next },
      });
      if (changed.count !== 1) {
        throw new BadRequestException('Deposit balance changed; retry');
      }
      const txn = await tx.depositTransaction.create({
        data: {
          depositAccountId: account.id,
          type: input.type,
          amount,
          balanceAfter: next,
          reason: input.reason,
        },
      });
      const updated = await tx.depositAccount.findUniqueOrThrow({
        where: { id: account.id },
        include: { lease: { select: { propertyId: true } } },
      });
      return { account: updated, transaction: txn };
    });

    await this.audit.log({
      workspaceId: account.workspaceId,
      actorUserId: user.id,
      action: 'deposit.transaction',
      entityType: 'deposit_account',
      entityId: account.id,
      metadata: {
        type: input.type,
        amount: String(amount),
        reason: input.reason,
      },
    });

    return result;
  }

  /** Checkout settlement: deduct damage then refund remainder (needs approval for deduction if > 0). */
  async settleCheckout(
    auth: AuthUser,
    input: {
      depositAccountId: string;
      damageAmount?: number;
      damageReason?: string;
      refundAmount?: number;
      requireApproval?: boolean;
    },
  ) {
    const account = await this.prisma.depositAccount.findUnique({
      where: { id: input.depositAccountId },
      include: { lease: { select: { propertyId: true } } },
    });
    if (!account) throw new NotFoundException('Deposit account not found');
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      account.workspaceId,
      'payment',
      'approve',
    );
    this.workspaces.assertPropertyInScope(membership, account.lease.propertyId);

    const damage = input.damageAmount ?? 0;
    if (damage < 0 || (input.refundAmount ?? 0) < 0) {
      throw new BadRequestException('Settlement amounts cannot be negative');
    }
    if (damage > 0) {
      const existing = await this.prisma.approvalRequest.findFirst({
        where: {
          workspaceId: account.workspaceId,
          kind: 'deposit_deduction',
          entityId: account.id,
          status: 'pending',
        },
      });
      const approval =
        existing ??
        (await this.prisma.approvalRequest.create({
          data: {
            workspaceId: account.workspaceId,
            kind: 'deposit_deduction',
            entityType: 'deposit_account',
            entityId: account.id,
            payload: {
              damageAmount: damage,
              reason: input.damageReason,
              refundAmount: input.refundAmount,
            },
            requestedBy: user.id,
            status: 'pending',
            note: input.damageReason,
          },
        }));
      return {
        pendingApproval: true,
        approvalId: approval.id,
        message: 'Deduction submitted for approval',
      };
    }

    let last = { account, transaction: null as unknown };
    const bal = Number(
      (last as { account: { balance: unknown } }).account.balance,
    );
    const refund =
      input.refundAmount !== undefined ? input.refundAmount : Math.max(bal, 0);
    if (refund > 0) {
      last = await this.record(auth, {
        depositAccountId: account.id,
        type: DepositTxnType.REFUND,
        amount: refund,
        reason: 'Checkout refund',
      });
    }
    return { pendingApproval: false, ...last };
  }
}
