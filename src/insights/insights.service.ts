import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import {
  AI_PROVIDER_PORT,
  type AiProviderPort,
} from '../common/ports/ai-provider.port';
import { PrismaService } from '../common/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(AI_PROVIDER_PORT) private readonly ai: AiProviderPort,
  ) {}

  private async metrics(
    workspaceId: string,
    propFilter: { propertyId?: string | { in: string[] } },
  ) {
    const [
      collected,
      billed,
      expenses,
      occupancy,
      rooms,
      overdue,
      activeLeases,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          workspaceId,
          status: 'CONFIRMED',
          ...propFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          workspaceId,
          status: { notIn: ['VOID', 'DRAFT'] },
          ...propFilter,
        },
        _sum: { total: true, amountPaid: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          workspaceId,
          status: 'PAID',
          ...propFilter,
        },
        _sum: { amount: true },
      }),
      this.prisma.room.count({
        where: {
          workspaceId,
          status: 'OCCUPIED',
          ...propFilter,
        },
      }),
      this.prisma.room.count({
        where: {
          workspaceId,
          status: { not: 'INACTIVE' },
          ...propFilter,
        },
      }),
      this.prisma.invoice.count({
        where: { workspaceId, status: 'OVERDUE', ...propFilter },
      }),
      this.prisma.lease.count({
        where: { workspaceId, status: 'ACTIVE', ...propFilter },
      }),
    ]);

    const billedTotal = Number(billed._sum.total ?? 0);
    const paidTotal = Number(billed._sum.amountPaid ?? 0);
    return {
      collected: Number(collected._sum.amount ?? 0),
      billed: billedTotal,
      outstanding: Math.max(billedTotal - paidTotal, 0),
      expenses: Number(expenses._sum.amount ?? 0),
      occupancyRate: rooms ? Math.round((occupancy / rooms) * 1000) / 10 : 0,
      occupiedRooms: occupancy,
      rooms,
      overdueInvoices: overdue,
      activeLeases,
      marginProxy:
        Number(collected._sum.amount ?? 0) - Number(expenses._sum.amount ?? 0),
    };
  }

  /** Monthly cash-in / cash-out series for charts */
  async cashHistory(
    auth: AuthUser,
    workspaceId: string,
    months = 6,
    propertyId?: string,
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'report',
      'view',
    );
    this.workspaces.assertPropertyInScope(membership, propertyId);
    const prop = propertyId
      ? { propertyId }
      : this.workspaces.propertyIdFilter(membership);
    const n = Math.min(Math.max(months, 1), 24);
    const series: Array<{
      month: string;
      cashIn: number;
      cashOut: number;
      net: number;
    }> = [];

    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const month = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
      const [inAgg, outAgg] = await Promise.all([
        this.prisma.payment.aggregate({
          where: {
            workspaceId,
            status: 'CONFIRMED',
            ...prop,
            paidAt: { gte: start, lt: end },
          },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: {
            workspaceId,
            status: 'PAID',
            ...prop,
            OR: [
              { paidAt: { gte: start, lt: end } },
              {
                paidAt: null,
                expenseDate: { gte: start, lt: end },
              },
            ],
          },
          _sum: { amount: true },
        }),
      ]);
      const cashIn = Number(inAgg._sum.amount ?? 0);
      const cashOut = Number(outAgg._sum.amount ?? 0);
      series.push({ month, cashIn, cashOut, net: cashIn - cashOut });
    }
    return { currency: 'IDR', months: n, series };
  }

  async financialSummary(
    auth: AuthUser,
    workspaceId: string,
    propertyId?: string,
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'report',
      'view',
    );
    this.workspaces.assertPropertyInScope(membership, propertyId);
    const propFilter = propertyId
      ? { propertyId }
      : this.workspaces.propertyIdFilter(membership);
    await this.subscriptions.consumeAiCredit(workspaceId);
    const m = await this.metrics(workspaceId, propFilter);
    const history = await this.cashHistory(auth, workspaceId, 3, propertyId);
    const out = await this.ai.summarizeFinance({
      period: 'bulan berjalan',
      propertyScope: propertyId ?? 'all',
      metrics: { ...m, historyMonths: history.series.length },
    });
    return {
      metrics: m,
      history: history.series,
      ...out.data,
      model: out.model,
    };
  }

  async cashFlowForecast(
    auth: AuthUser,
    workspaceId: string,
    propertyId?: string,
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      'report',
      'view',
    );
    this.workspaces.assertPropertyInScope(membership, propertyId);
    const propFilter = propertyId
      ? { propertyId }
      : this.workspaces.propertyIdFilter(membership);
    await this.subscriptions.consumeAiCredit(workspaceId);
    const m = await this.metrics(workspaceId, propFilter);
    const history = await this.cashHistory(auth, workspaceId, 6, propertyId);
    const openInvoices = await this.prisma.invoice.findMany({
      where: {
        workspaceId,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
        ...propFilter,
      },
      select: { total: true, amountPaid: true, dueDate: true },
    });
    const upcoming = openInvoices.reduce(
      (s, i) => s + Number(i.total) - Number(i.amountPaid),
      0,
    );
    const recurring = await this.prisma.recurringExpense.aggregate({
      where: {
        workspaceId,
        isActive: true,
        ...propFilter,
      },
      _sum: { amount: true },
    });
    const avgNet =
      history.series.length > 0
        ? history.series.reduce((s, x) => s + x.net, 0) / history.series.length
        : 0;
    const monthlyExpense =
      Number(recurring._sum.amount ?? 0) ||
      (history.series.length
        ? history.series.reduce((s, x) => s + x.cashOut, 0) /
          history.series.length
        : m.expenses / 3);

    const baseIn = upcoming * 0.85 + m.collected * 0.15;
    const baseOut = monthlyExpense;
    const base = Math.round(baseIn - baseOut + avgNet * 0.1);
    return {
      label: history.series.some((s) => s.cashIn || s.cashOut)
        ? 'history_aware'
        : 'limited_history',
      currency: 'IDR',
      scenarios: {
        base,
        optimistic: Math.round(base * 1.15),
        pessimistic: Math.round(base * 0.7),
      },
      assumptions: [
        'Collection rate assumed 85% of open invoices',
        'Expense based on paid history / recurring',
        'Blend with 6-month average net cash flow',
        'Not a guarantee — human review required',
      ],
      metrics: m,
      history: history.series,
      horizon: '30d',
    };
  }

  async rentRecommendation(
    auth: AuthUser,
    input: { workspaceId: string; roomId: string },
  ) {
    const { membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'report',
      'view',
    );
    const propertyFilter = this.workspaces.propertyIdFilter(membership);
    await this.subscriptions.consumeAiCredit(input.workspaceId);
    const room = await this.prisma.room.findFirst({
      where: {
        id: input.roomId,
        workspaceId: input.workspaceId,
        ...propertyFilter,
      },
      include: { property: true, roomType: true },
    });
    if (!room) throw new Error('Room not found');

    const propertyRooms = await this.prisma.room.findMany({
      where: { propertyId: room.propertyId, status: { not: 'INACTIVE' } },
      select: { id: true, status: true, rentAmount: true },
    });
    const occupied = propertyRooms.filter((r) => r.status === 'OCCUPIED').length;
    const rents = propertyRooms
      .map((r) => Number(r.rentAmount))
      .filter((n) => n > 0);
    const peerAvg =
      rents.length > 0
        ? Math.round(rents.reduce((a, b) => a + b, 0) / rents.length)
        : Number(room.rentAmount);

    const lastLease = await this.prisma.lease.findFirst({
      where: { roomId: room.id },
      orderBy: { updatedAt: 'desc' },
      select: { endDate: true, status: true, updatedAt: true },
    });
    let vacantDays = 0;
    if (room.status === 'AVAILABLE') {
      const since = lastLease?.endDate ?? lastLease?.updatedAt ?? room.updatedAt;
      vacantDays = Math.max(
        0,
        Math.floor((Date.now() - new Date(since).getTime()) / 86400000),
      );
    }

    const out = await this.ai.recommendRent({
      currentRent: Number(room.rentAmount),
      occupancyRate: propertyRooms.length
        ? Math.round((occupied / propertyRooms.length) * 100)
        : 0,
      vacantDays,
      roomType: room.roomType?.name ?? 'standard',
      facilities: [],
    });

    const data = out.data;
    // Blend AI with peer average if AI returns zeros
    const low =
      data.low && data.low > 0
        ? data.low
        : Math.round(Math.min(Number(room.rentAmount), peerAvg) * 0.95);
    const high =
      data.high && data.high > 0
        ? data.high
        : Math.round(Math.max(Number(room.rentAmount), peerAvg) * 1.08);

    return {
      roomId: room.id,
      roomName: room.name,
      propertyName: room.property?.name,
      currentRent: Number(room.rentAmount),
      peerAvgRent: peerAvg,
      occupancyRate: propertyRooms.length
        ? Math.round((occupied / propertyRooms.length) * 100)
        : 0,
      vacantDays,
      low,
      high,
      action: data.action ?? 'keep',
      rationale: data.rationale,
      model: out.model,
    };
  }
}
