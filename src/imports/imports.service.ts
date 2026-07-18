import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import {
  AI_PROVIDER_PORT,
  type AiProviderPort,
} from '../common/ports/ai-provider.port';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

export type ImportKind =
  | 'rooms'
  | 'tenants'
  | 'leases'
  | 'payments'
  | 'expenses';

const TARGETS: Record<ImportKind, string[]> = {
  rooms: ['name', 'code', 'rentAmount', 'depositAmount', 'floorLabel'],
  tenants: ['fullName', 'phone', 'email', 'occupation', 'nik'],
  leases: [
    'tenantName',
    'roomCode',
    'startDate',
    'rentAmount',
    'depositAmount',
  ],
  payments: [
    'tenantName',
    'amount',
    'paidAt',
    'method',
    'reference',
    'invoiceNumber',
  ],
  expenses: [
    'category',
    'amount',
    'expenseDate',
    'description',
    'vendor',
    'propertyName',
  ],
};

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    @Inject(AI_PROVIDER_PORT) private readonly ai: AiProviderPort,
  ) {}

  async mapAndPreview(
    auth: AuthUser,
    input: {
      workspaceId: string;
      kind: ImportKind;
      headers: string[];
      rows: string[][];
    },
  ) {
    await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'workspace',
      'manage_settings',
    );
    const targetFields = TARGETS[input.kind];

    const mapped = await this.ai.mapSpreadsheetColumns({
      headers: input.headers,
      sampleRows: input.rows.slice(0, 5),
      targetFields,
    });

    const dryRun = this.validateRows(
      input.kind,
      input.headers,
      input.rows,
      mapped.data.mapping,
    );

    const job = await this.prisma.importJob.create({
      data: {
        workspaceId: input.workspaceId,
        kind: input.kind,
        status: 'preview',
        mappingJson: mapped.data.mapping,
        rowCount: input.rows.length,
        resultJson: { dryRun },
      },
    });

    return {
      jobId: job.id,
      mapping: mapped.data.mapping,
      preview: input.rows.slice(0, 5),
      targetFields,
      dryRun,
    };
  }

  private validateRows(
    kind: ImportKind,
    headers: string[],
    rows: string[][],
    mapping: Record<string, string | null>,
  ) {
    const headerIndex = (field: string) => {
      const header = mapping[field];
      if (!header) return -1;
      return headers.findIndex((h) => h === header);
    };
    let valid = 0;
    let invalid = 0;
    const errors: Array<{ row: number; message: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (kind === 'rooms') {
          if (!row[headerIndex('name')]?.trim()) throw new Error('name required');
        } else if (kind === 'tenants') {
          if (!row[headerIndex('fullName')]?.trim())
            throw new Error('fullName required');
        } else if (kind === 'leases') {
          if (
            !row[headerIndex('tenantName')]?.trim() ||
            !row[headerIndex('roomCode')]?.trim()
          )
            throw new Error('tenantName+roomCode required');
        } else if (kind === 'payments') {
          const amt = Number(row[headerIndex('amount')] ?? NaN);
          if (!Number.isFinite(amt) || amt <= 0)
            throw new Error('amount required');
        } else if (kind === 'expenses') {
          const cat = row[headerIndex('category')]?.trim();
          const amt = Number(row[headerIndex('amount')] ?? NaN);
          if (!cat || !Number.isFinite(amt))
            throw new Error('category+amount required');
        }
        valid += 1;
      } catch (e) {
        invalid += 1;
        if (errors.length < 50) {
          errors.push({ row: i + 1, message: String(e) });
        }
      }
    }
    return { valid, invalid, sampleErrors: errors };
  }

  async commit(
    auth: AuthUser,
    input: {
      workspaceId: string;
      jobId: string;
      propertyId?: string;
      mapping: Record<string, string | null>;
      headers: string[];
      rows: string[][];
    },
  ) {
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      input.workspaceId,
      'workspace',
      'manage_settings',
    );
    const propertyFilter = this.workspaces.propertyIdFilter(membership);
    if (input.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: {
          id: input.propertyId,
          workspaceId: input.workspaceId,
          ...propertyFilter,
        },
        select: { id: true },
      });
      if (!property) throw new NotFoundException('Property not found');
    }
    const job = await this.prisma.importJob.findFirst({
      where: { id: input.jobId, workspaceId: input.workspaceId },
    });
    if (!job) throw new Error('Import job not found');

    const headerIndex = (field: string) => {
      const header = input.mapping[field];
      if (!header) return -1;
      return input.headers.findIndex((h) => h === header);
    };

    let created = 0;
    let errors = 0;
    const errorRows: Array<{ row: number; message: string }> = [];

    const kind = job.kind as ImportKind;

    if (kind === 'rooms') {
      if (!input.propertyId) throw new Error('propertyId required for rooms');
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        try {
          const name = row[headerIndex('name')]?.trim();
          if (!name) throw new Error('name required');
          const code =
            row[headerIndex('code')]?.trim()?.toUpperCase() ||
            name.toUpperCase();
          await this.prisma.room.create({
            data: {
              workspaceId: input.workspaceId,
              propertyId: input.propertyId,
              name,
              code,
              rentAmount: Number(row[headerIndex('rentAmount')] ?? 0) || 0,
              depositAmount:
                Number(row[headerIndex('depositAmount')] ?? 0) || 0,
              floorLabel: row[headerIndex('floorLabel')]?.trim() || null,
            },
          });
          created += 1;
        } catch (e) {
          errors += 1;
          errorRows.push({ row: i + 1, message: String(e) });
        }
      }
    } else if (kind === 'tenants') {
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        try {
          const fullName = row[headerIndex('fullName')]?.trim();
          if (!fullName) throw new Error('fullName required');
          await this.prisma.tenant.create({
            data: {
              workspaceId: input.workspaceId,
              fullName,
              phone: row[headerIndex('phone')]?.trim() || null,
              email: row[headerIndex('email')]?.trim() || null,
              occupation: row[headerIndex('occupation')]?.trim() || null,
              nik: row[headerIndex('nik')]?.trim() || null,
            },
          });
          created += 1;
        } catch (e) {
          errors += 1;
          errorRows.push({ row: i + 1, message: String(e) });
        }
      }
    } else if (kind === 'leases') {
      if (!input.propertyId) throw new Error('propertyId required for leases');
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        try {
          const tenantName = row[headerIndex('tenantName')]?.trim();
          const roomCode = row[headerIndex('roomCode')]?.trim()?.toUpperCase();
          if (!tenantName || !roomCode)
            throw new Error('tenantName+roomCode required');
          let tenant = await this.prisma.tenant.findFirst({
            where: {
              workspaceId: input.workspaceId,
              fullName: { equals: tenantName, mode: 'insensitive' },
            },
          });
          if (!tenant) {
            tenant = await this.prisma.tenant.create({
              data: {
                workspaceId: input.workspaceId,
                fullName: tenantName,
              },
            });
          }
          const room = await this.prisma.room.findFirst({
            where: {
              workspaceId: input.workspaceId,
              propertyId: input.propertyId,
              code: roomCode,
            },
          });
          if (!room) throw new Error(`room ${roomCode} not found`);
          const start =
            row[headerIndex('startDate')]?.trim() ||
            new Date().toISOString().slice(0, 10);
          const count = await this.prisma.lease.count({
            where: { workspaceId: input.workspaceId },
          });
          await this.prisma.lease.create({
            data: {
              workspaceId: input.workspaceId,
              propertyId: input.propertyId,
              roomId: room.id,
              tenantId: tenant.id,
              leaseNumber: `LS-IMP-${count + 1}`,
              status: 'DRAFT',
              startDate: new Date(start),
              rentAmount:
                Number(row[headerIndex('rentAmount')] ?? 0) ||
                Number(room.rentAmount),
              depositAmount:
                Number(row[headerIndex('depositAmount')] ?? 0) ||
                Number(room.depositAmount),
            },
          });
          created += 1;
        } catch (e) {
          errors += 1;
          errorRows.push({ row: i + 1, message: String(e) });
        }
      }
    } else if (kind === 'payments') {
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        try {
          const amount = Number(row[headerIndex('amount')] ?? NaN);
          if (!Number.isFinite(amount) || amount <= 0)
            throw new Error('amount required');
          const tenantName = row[headerIndex('tenantName')]?.trim();
          let tenantId: string | undefined;
           let propertyId: string | undefined = input.propertyId;
          let invoiceId: string | undefined;
          if (tenantName) {
            const t = await this.prisma.tenant.findFirst({
              where: {
                workspaceId: input.workspaceId,
                fullName: { equals: tenantName, mode: 'insensitive' },
              },
            });
            tenantId = t?.id;
          }
          const invNo = row[headerIndex('invoiceNumber')]?.trim();
          if (invNo) {
            const inv = await this.prisma.invoice.findFirst({
              where: {
                workspaceId: input.workspaceId,
                invoiceNumber: invNo,
                ...propertyFilter,
              },
            });
            if (inv) {
              invoiceId = inv.id;
              tenantId = tenantId ?? inv.tenantId ?? undefined;
              propertyId = inv.propertyId ?? undefined;
            }
          }
          if (!propertyId) {
            const prop = await this.prisma.property.findFirst({
              where: { workspaceId: input.workspaceId, ...propertyFilter },
            });
            propertyId = prop?.id;
          }
          const paidAt =
            row[headerIndex('paidAt')]?.trim() ||
            new Date().toISOString().slice(0, 10);
          const year = new Date().getFullYear();
          const count = await this.prisma.payment.count({
            where: { workspaceId: input.workspaceId },
          });
          const payment = await this.prisma.payment.create({
            data: {
              workspaceId: input.workspaceId,
              propertyId,
              tenantId,
              paymentNumber: `PAY-${year}-IMP${String(count + 1).padStart(5, '0')}`,
              amount,
              status: 'CONFIRMED',
              method: 'BANK_TRANSFER',
              manualReference:
                row[headerIndex('reference')]?.trim() ||
                row[headerIndex('method')]?.trim() ||
                null,
              paidAt: new Date(paidAt),
              confirmedAt: new Date(),
              notes: 'import',
            },
          });
          if (invoiceId) {
            await this.prisma.paymentAllocation.create({
              data: {
                paymentId: payment.id,
                invoiceId,
                amount,
              },
            });
          }
          created += 1;
        } catch (e) {
          errors += 1;
          errorRows.push({ row: i + 1, message: String(e) });
        }
      }
    } else if (kind === 'expenses') {
      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        try {
          const category = row[headerIndex('category')]?.trim();
          const amount = Number(row[headerIndex('amount')] ?? NaN);
          if (!category || !Number.isFinite(amount))
            throw new Error('category+amount required');
           let propertyId: string | undefined = input.propertyId;
          const propName = row[headerIndex('propertyName')]?.trim();
          if (propName) {
            const p = await this.prisma.property.findFirst({
              where: {
                workspaceId: input.workspaceId,
                ...propertyFilter,
                name: { equals: propName, mode: 'insensitive' },
              },
            });
            propertyId = p?.id;
          }
          const expenseDate =
            row[headerIndex('expenseDate')]?.trim() ||
            new Date().toISOString().slice(0, 10);
          await this.prisma.expense.create({
            data: {
              workspaceId: input.workspaceId,
              propertyId,
              category,
              amount,
              expenseDate: new Date(expenseDate),
              description: row[headerIndex('description')]?.trim() || null,
              vendor: row[headerIndex('vendor')]?.trim() || null,
              status: 'DRAFT',
            },
          });
          created += 1;
        } catch (e) {
          errors += 1;
          errorRows.push({ row: i + 1, message: String(e) });
        }
      }
    }

    const errorCsv = [
      'row,message',
      ...errorRows.map(
        (e) => `${e.row},"${String(e.message).replace(/"/g, '""')}"`,
      ),
    ].join('\n');

    await this.prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: errors && !created ? 'failed' : 'completed',
        errorCount: errors,
        resultJson: {
          created,
          errors,
          errorRows,
          errorCsv,
          actorUserId: user.id,
        },
      },
    });

    return { created, errors, errorRows, errorCsv };
  }
}
