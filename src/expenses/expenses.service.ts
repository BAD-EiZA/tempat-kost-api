import { Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateExpenseDto } from './dto/create-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthUser, workspaceId: string) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'expense',
      'view',
    );
    return this.prisma.expense.findMany({
      where: {
        workspaceId,
        ...this.workspaces.propertyIdFilter(membership),
      },
      orderBy: { expenseDate: 'desc' },
      include: {
        property: { select: { id: true, name: true } },
      },
    });
  }

  async create(auth: AuthUser, dto: CreateExpenseDto) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      dto.workspaceId,
      'expense',
      'create',
    );
    this.workspaces.assertPropertyInScope(membership, dto.propertyId);
    if (dto.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, workspaceId: dto.workspaceId },
      });
      if (!property) throw new NotFoundException('Property not found');
    }
    const expense = await this.prisma.expense.create({
      data: {
        workspaceId: dto.workspaceId,
        propertyId: dto.propertyId,
        category: dto.category,
        vendor: dto.vendor,
        expenseDate: new Date(dto.expenseDate),
        amount: dto.amount,
        description: dto.description,
        paymentMethod: dto.paymentMethod,
        status: ExpenseStatus.DRAFT,
      },
    });
    await this.audit.log({
      workspaceId: dto.workspaceId,
      actorUserId: user.id,
      action: 'expense.created',
      entityType: 'expense',
      entityId: expense.id,
    });
    return expense;
  }

  async setStatus(
    auth: AuthUser,
    id: string,
    status: ExpenseStatus,
  ) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      expense.workspaceId,
      'expense',
      status === ExpenseStatus.APPROVED || status === ExpenseStatus.PAID
        ? 'approve'
        : 'update',
    );
    this.workspaces.assertPropertyInScope(membership, expense.propertyId);
    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        status,
        paidAt: status === ExpenseStatus.PAID ? new Date() : expense.paidAt,
      },
    });
    await this.audit.log({
      workspaceId: expense.workspaceId,
      actorUserId: user.id,
      action: `expense.${status.toLowerCase()}`,
      entityType: 'expense',
      entityId: id,
    });
    return updated;
  }
}
