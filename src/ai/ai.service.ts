import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import {
  AI_PROVIDER_PORT,
  type AiProviderPort,
} from '../common/ports/ai-provider.port';
import { PrismaService } from '../common/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER_PORT) private readonly ai: AiProviderPort,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private async startJob(
    auth: AuthUser,
    workspaceId: string,
    jobType: string,
    input: object,
    resource: string,
    action: string,
  ) {
    const { user } = await this.workspaces.assertPermission(
      auth,
      workspaceId,
      resource,
      action,
    );
    await this.subscriptions.consumeAiCredit(workspaceId);
    return this.prisma.aiJob.create({
      data: {
        workspaceId,
        jobType,
        status: 'PROCESSING',
        inputJson: input,
        provider: 'gemini',
          model: 'gemini-3.5-flash',
          attemptCount: 1,
        },
    }).then(async (job) => ({ job, user }));
  }

  private async runProvider<T>(jobId: string, call: () => Promise<T>) {
    try {
      return await call();
    } catch (error) {
      await this.prisma.aiJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorMessage: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 500),
        },
      });
      throw error;
    }
  }

  private async complete(
    jobId: string,
    result: object,
    confidence: object,
    usageUnits?: number,
  ) {
    return this.prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'NEEDS_REVIEW',
        resultJson: result,
        confidenceJson: confidence,
        usageUnits: usageUnits ?? 0,
      },
    });
  }

  async categorizeExpense(
    auth: AuthUser,
    input: {
      workspaceId: string;
      description: string;
      vendor?: string;
      amount?: number;
    },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'expense_categorization',
      input,
      'expense',
      'create',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.categorizeExpense(input),
    );
    return this.complete(job.id, out.data, out.confidence, out.usageUnits);
  }

  async draftCommunication(
    auth: AuthUser,
    input: {
      workspaceId: string;
      purpose: string;
      audience: string;
      context: Record<string, unknown>;
      tone: string;
      channel: string;
    },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'communication_draft',
      input,
      'tenant',
      'create',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.draftCommunication(input),
    );
    return this.complete(job.id, out.data, out.confidence, out.usageUnits);
  }

  async triageMaintenance(
    auth: AuthUser,
    input: { workspaceId: string; description: string; categoryHint?: string },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'maintenance_triage',
      input,
      'property',
      'update',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.triageMaintenance(input),
    );
    return this.complete(job.id, out.data, out.confidence, out.usageUnits);
  }

  async extractPaymentProof(
    auth: AuthUser,
    input: {
      workspaceId: string;
      imageUrl?: string;
      base64?: string;
      mimeType?: string;
      expectedAmount?: number;
      manualReference?: string;
    },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'payment_proof_extraction',
      { hasImage: !!(input.imageUrl || input.base64) },
      'payment',
      'create',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.extractPaymentProof(input),
    );
    const data = out.data as Record<string, unknown>;
    const ocrAmount = Number(
      data.amount ?? data.nominal ?? data.gross_amount ?? NaN,
    );
    const ocrRef = String(
      data.reference ?? data.ref ?? data.transaction_id ?? '',
    );
    const flags: string[] = [];
    if (
      input.expectedAmount != null &&
      Number.isFinite(ocrAmount) &&
      Math.abs(ocrAmount - input.expectedAmount) > 1
    ) {
      flags.push(
        `amount_mismatch:ocr=${ocrAmount}:expected=${input.expectedAmount}`,
      );
    }
    if (
      input.manualReference &&
      ocrRef &&
      !ocrRef
        .toLowerCase()
        .includes(input.manualReference.toLowerCase().slice(0, 6))
    ) {
      flags.push('reference_mismatch');
    }
    if (!Number.isFinite(ocrAmount)) flags.push('amount_unreadable');

    const dup = await this.prisma.aiJob.findFirst({
      where: {
        workspaceId: input.workspaceId,
        jobType: 'payment_proof_extraction',
        id: { not: job.id },
        resultJson: { not: Prisma.DbNull },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    if (dup?.resultJson && ocrRef) {
      const prev = dup.resultJson as Record<string, unknown>;
      const prevRef = String(prev.reference ?? prev.ref ?? '');
      if (prevRef && prevRef === ocrRef) flags.push('possible_duplicate_ref');
    }

    return this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: 'NEEDS_REVIEW',
        resultJson: data as object,
        confidenceJson: out.confidence as object,
        usageUnits: out.usageUnits ?? 0,
        riskFlags: flags,
      },
    });
  }

  async smartSearch(
    auth: AuthUser,
    input: {
      workspaceId: string;
      query: string;
      allowedEntities: string[];
    },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'smart_search',
      input,
      'report',
      'view',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.nlToSearchDsl(input),
    );
    return this.complete(job.id, out.data, out.confidence, out.usageUnits);
  }

  async extractIdentity(
    auth: AuthUser,
    input: {
      workspaceId: string;
      imageUrl?: string;
      base64?: string;
      mimeType?: string;
    },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'identity_extraction',
      { consent: true },
      'tenant',
      'update',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.extractIdentity(input),
    );
    return this.complete(job.id, out.data, out.confidence, out.usageUnits);
  }

  async analyzeDamage(
    auth: AuthUser,
    input: {
      workspaceId: string;
      imageUrls: string[];
      description?: string;
    },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'damage_analysis',
      input,
      'property',
      'update',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.analyzeDamage(input),
    );
    return this.complete(job.id, out.data, out.confidence, out.usageUnits);
  }

  async estimateRepair(
    auth: AuthUser,
    input: {
      workspaceId: string;
      description: string;
      imageUrls?: string[];
    },
  ) {
    const { job } = await this.startJob(
      auth,
      input.workspaceId,
      'repair_estimate',
      input,
      'property',
      'update',
    );
    const out = await this.runProvider(job.id, () =>
      this.ai.estimateRepair(input),
    );
    return this.complete(job.id, out.data, out.confidence, out.usageUnits);
  }

  async getJob(auth: AuthUser, id: string) {
    const job = await this.prisma.aiJob.findUnique({ where: { id } });
    if (!job) return null;
    const [resource] = this.jobPermission(job.jobType);
    await this.workspaces.assertPermission(
      auth,
      job.workspaceId,
      resource,
      'view',
    );
    return job;
  }

  private jobPermission(jobType: string): [string, string] {
    switch (jobType) {
      case 'expense_categorization':
        return ['expense', 'create'];
      case 'payment_proof_extraction':
        return ['payment', 'create'];
      case 'smart_search':
        return ['report', 'view'];
      case 'identity_extraction':
        return ['tenant', 'update'];
      case 'damage_analysis':
      case 'repair_estimate':
      case 'maintenance_triage':
        return ['property', 'update'];
      default:
        return ['tenant', 'create'];
    }
  }

  async confirm(auth: AuthUser, id: string) {
    const job = await this.getJob(auth, id);
    if (!job) return null;
    const [resource, action] = this.jobPermission(job.jobType);
    const { user } = await this.workspaces.assertPermission(
      auth,
      job.workspaceId,
      resource,
      action,
    );
    return this.prisma.aiJob.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });
  }

  async reject(auth: AuthUser, id: string) {
    const job = await this.getJob(auth, id);
    if (!job) return null;
    const [resource, action] = this.jobPermission(job.jobType);
    const { user } = await this.workspaces.assertPermission(
      auth,
      job.workspaceId,
      resource,
      action,
    );
    return this.prisma.aiJob.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });
  }
}
