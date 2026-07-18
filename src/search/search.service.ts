import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import {
  AI_PROVIDER_PORT,
  type AiProviderPort,
} from '../common/ports/ai-provider.port';
import { PrismaService } from '../common/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const ALLOWED = [
  'tenants',
  'rooms',
  'leases',
  'invoices',
  'properties',
  'payments',
  'maintenance',
] as const;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(AI_PROVIDER_PORT) private readonly ai: AiProviderPort,
  ) {}

  private linkFor(entity: string, id: string, workspaceId: string) {
    const q = `workspaceId=${encodeURIComponent(workspaceId)}`;
    switch (entity) {
      case 'tenants':
        return `/dashboard/tenants/${id}?${q}`;
      case 'rooms':
        return `/dashboard/rooms?${q}`;
      case 'leases':
        return `/dashboard/leases?${q}`;
      case 'invoices':
        return `/dashboard/billing?${q}`;
      case 'properties':
        return `/dashboard/properties?${q}`;
      case 'payments':
        return `/dashboard/payments?${q}`;
      case 'maintenance':
        return `/dashboard/maintenance?${q}`;
      default:
        return `/dashboard?${q}`;
    }
  }

  async smartSearch(auth: AuthUser, workspaceId: string, query: string) {
    await this.workspaces.assertMember(auth, workspaceId);
    await this.subscriptions.consumeAiCredit(workspaceId);

    const dslResult = await this.ai.nlToSearchDsl({
      query,
      allowedEntities: [...ALLOWED],
    });
    const dsl = dslResult.data;
    const entity = ALLOWED.includes(dsl.entity as (typeof ALLOWED)[number])
      ? dsl.entity
      : 'tenants';

    let results: Array<Record<string, unknown>> = [];
    const take = Math.min(dsl.limit ?? 50, 100);
    const filters = dsl.filters ?? {};
    const qText =
      typeof filters.q === 'string'
        ? filters.q
        : typeof filters.name === 'string'
          ? filters.name
          : query;

    switch (entity) {
      case 'tenants':
        results = await this.prisma.tenant.findMany({
          where: {
            workspaceId,
            ...(typeof filters.status === 'string'
              ? { status: filters.status as never }
              : {}),
            ...(qText
              ? {
                  OR: [
                    { fullName: { contains: qText, mode: 'insensitive' } },
                    { phone: { contains: qText } },
                    { email: { contains: qText, mode: 'insensitive' } },
                    { nik: { contains: qText } },
                  ],
                }
              : {}),
          },
          take,
          orderBy: { createdAt: 'desc' },
        });
        break;
      case 'rooms':
        results = await this.prisma.room.findMany({
          where: {
            workspaceId,
            ...(typeof filters.status === 'string'
              ? { status: filters.status as never }
              : {}),
            ...(typeof filters.maxRent === 'number'
              ? { rentAmount: { lte: filters.maxRent } }
              : {}),
            ...(qText
              ? {
                  OR: [
                    { name: { contains: qText, mode: 'insensitive' } },
                    { code: { contains: qText, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          take,
          include: { property: { select: { name: true } } },
        });
        break;
      case 'leases':
        results = await this.prisma.lease.findMany({
          where: {
            workspaceId,
            ...(typeof filters.status === 'string'
              ? { status: filters.status as never }
              : {}),
          },
          take,
          include: {
            tenant: { select: { fullName: true } },
            room: { select: { name: true } },
          },
        });
        break;
      case 'invoices': {
        const overdueHint =
          /belum bayar|overdue|nunggak|telat/i.test(query) ||
          filters.status === 'OVERDUE';
        results = await this.prisma.invoice.findMany({
          where: {
            workspaceId,
            ...(typeof filters.status === 'string'
              ? { status: filters.status as never }
              : overdueHint
                ? { status: { in: ['OVERDUE', 'OPEN', 'PARTIALLY_PAID'] } }
                : {}),
          },
          take,
          include: { tenant: { select: { fullName: true } } },
          orderBy: { dueDate: 'asc' },
        });
        break;
      }
      case 'properties':
        results = await this.prisma.property.findMany({
          where: {
            workspaceId,
            status: { not: 'ARCHIVED' },
            ...(qText
              ? { name: { contains: qText, mode: 'insensitive' } }
              : {}),
          },
          take,
        });
        break;
      case 'payments':
        results = await this.prisma.payment.findMany({
          where: {
            workspaceId,
            ...(typeof filters.status === 'string'
              ? { status: filters.status as never }
              : {}),
          },
          take,
          orderBy: { createdAt: 'desc' },
          include: { tenant: { select: { fullName: true } } },
        });
        break;
      case 'maintenance':
        results = await this.prisma.maintenanceRequest.findMany({
          where: {
            workspaceId,
            ...(typeof filters.status === 'string'
              ? { status: filters.status as never }
              : {}),
            ...(qText
              ? {
                  OR: [
                    { title: { contains: qText, mode: 'insensitive' } },
                    { description: { contains: qText, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          take,
          orderBy: { createdAt: 'desc' },
        });
        break;
      default:
        results = [];
    }

    if (!results.length && query) {
      results = await this.prisma.tenant.findMany({
        where: {
          workspaceId,
          fullName: { contains: query, mode: 'insensitive' },
        },
        take,
      });
    }

    const enriched = results.map((row) => {
      const id = String(row.id ?? '');
      return {
        ...row,
        _href: this.linkFor(entity, id, workspaceId),
        _label: String(
          row.fullName ??
            row.name ??
            row.invoiceNumber ??
            row.leaseNumber ??
            row.paymentNumber ??
            row.title ??
            id,
        ),
      };
    });

    return {
      query,
      dsl,
      entity,
      count: enriched.length,
      results: enriched,
    };
  }
}
