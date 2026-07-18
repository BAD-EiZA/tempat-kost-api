import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import {
  AI_PROVIDER_PORT,
  type AiProviderPort,
} from '../common/ports/ai-provider.port';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_PORT) private readonly ai: AiProviderPort,
  ) {}

  private async userId(auth: AuthUser) {
    const u = await this.prisma.user.upsert({
      where: { externalUserId: auth.externalUserId },
      create: { externalUserId: auth.externalUserId, email: auth.email },
      update: { email: auth.email ?? undefined },
    });
    return u.id;
  }

  async getOrCreate(auth: AuthUser, workspaceId?: string) {
    const userId = await this.userId(auth);
    let draft = await this.prisma.onboardingDraft.findFirst({
      where: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!draft) {
      draft = await this.prisma.onboardingDraft.create({
        data: {
          userId,
          workspaceId,
          step: 'welcome',
          answersJson: {},
        },
      });
    }
    return draft;
  }

  async saveStep(
    auth: AuthUser,
    input: {
      draftId: string;
      step: string;
      answers: Record<string, unknown>;
      workspaceId?: string;
    },
  ) {
    await this.userId(auth);
    const existing = await this.prisma.onboardingDraft.findUnique({
      where: { id: input.draftId },
    });
    const merged = {
      ...((existing?.answersJson as Record<string, unknown>) ?? {}),
      ...input.answers,
    };
    return this.prisma.onboardingDraft.update({
      where: { id: input.draftId },
      data: {
        step: input.step,
        answersJson: merged as Prisma.InputJsonValue,
        workspaceId: input.workspaceId ?? existing?.workspaceId,
      },
    });
  }

  async suggest(auth: AuthUser, draftId: string) {
    await this.userId(auth);
    const draft = await this.prisma.onboardingDraft.findUnique({
      where: { id: draftId },
    });
    if (!draft) throw new Error('Draft not found');
    const answers = (draft.answersJson ?? {}) as Record<string, unknown>;
    const rooms = Number(answers.estimatedRooms ?? 10);
    const props = Number(answers.propertyCount ?? 1);
    const city = String(answers.city ?? 'Jakarta');
    const suggestion = {
      propertyStructure: {
        buildings: props > 1 ? props : 1,
        floorsPerBuilding: rooms > 20 ? 3 : 2,
        roomsPerFloor: Math.ceil(rooms / Math.max(props * 2, 1)),
      },
      roomTypes: [
        { name: 'Standard', baseRent: 1500000, capacity: 1 },
        { name: 'Deluxe', baseRent: 2000000, capacity: 1 },
      ],
      utilityPolicy: {
        payerType: answers.electricityBy === 'owner' ? 'OWNER' : 'TENANT',
        billingMethod:
          answers.electricityBy === 'owner'
            ? 'INCLUDED'
            : 'FIXED_MONTHLY',
        fixedMonthlyFee: 150000,
      },
      invoice: {
        dueDay: 1,
        lateFeePercent: 2,
        city,
      },
      nextChecklist: [
        'Buat properti',
        'Tambah tipe kamar',
        'Bulk create kamar',
        'Import / tambah penyewa',
        'Atur rekening & invoice',
        'Undang tim',
      ],
      note: 'Preview AI — konfirmasi manual sebelum diterapkan',
    };

    try {
      const draftText = await this.ai.draftCommunication({
        purpose: `Saran onboarding kos di ${city} ~${rooms} kamar`,
        audience: 'owner',
        context: answers,
        tone: 'friendly',
        channel: 'in_app',
      });
      Object.assign(suggestion, { aiNote: draftText.data.body });
    } catch {
      /* ignore */
    }

    return this.prisma.onboardingDraft.update({
      where: { id: draftId },
      data: {
        suggestionJson: suggestion as Prisma.InputJsonValue,
        step: 'review',
      },
    });
  }

  /** Create property + sample rooms + utility policy from suggestion */
  async apply(
    auth: AuthUser,
    input: { draftId: string; workspaceId: string; propertyName?: string },
  ) {
    const userId = await this.userId(auth);
    const draft = await this.prisma.onboardingDraft.findUnique({
      where: { id: input.draftId },
    });
    if (!draft || draft.userId !== userId) throw new Error('Draft not found');
    const suggestion = (draft.suggestionJson ?? {}) as Record<string, unknown>;
    const answers = (draft.answersJson ?? {}) as Record<string, unknown>;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: input.workspaceId, userId, status: 'ACTIVE' },
    });
    if (!member) throw new Error('Not a workspace member');

    const city = String(answers.city ?? 'Jakarta');
    const name =
      input.propertyName?.trim() ||
      `Kos ${city} ${new Date().getFullYear()}`;
    const code = `P${Date.now().toString(36).slice(-6).toUpperCase()}`;

    const property = await this.prisma.property.create({
      data: {
        workspaceId: input.workspaceId,
        name,
        code,
        status: 'ACTIVE',
        city,
      },
    });

    const roomTypes = Array.isArray(suggestion.roomTypes)
      ? (suggestion.roomTypes as Array<{
          name?: string;
          baseRent?: number;
          capacity?: number;
        }>)
      : [{ name: 'Standard', baseRent: 1500000, capacity: 1 }];

    const structure = (suggestion.propertyStructure ?? {}) as {
      roomsPerFloor?: number;
      floorsPerBuilding?: number;
    };
    const roomCount = Math.min(
      Math.max(
        Number(answers.estimatedRooms) ||
          (structure.roomsPerFloor ?? 5) *
            (structure.floorsPerBuilding ?? 2),
        1,
      ),
      40,
    );
    const baseRent = Number(roomTypes[0]?.baseRent ?? 1500000);
    const rooms = [];
    for (let i = 1; i <= roomCount; i++) {
      rooms.push(
        await this.prisma.room.create({
          data: {
            workspaceId: input.workspaceId,
            propertyId: property.id,
            name: `${String(i).padStart(2, '0')}`,
            code: `${code}-R${i}`,
            status: 'AVAILABLE',
            rentAmount: baseRent,
            depositAmount: baseRent,
            capacity: roomTypes[0]?.capacity ?? 1,
          },
        }),
      );
    }

    const util = (suggestion.utilityPolicy ?? {}) as {
      payerType?: string;
      billingMethod?: string;
      fixedMonthlyFee?: number;
    };
    let policy = null;
    try {
      policy = await this.prisma.utilityBillingPolicy.create({
        data: {
          workspaceId: input.workspaceId,
          propertyId: property.id,
          payerType: (util.payerType as never) ?? 'TENANT',
          billingMethod: (util.billingMethod as never) ?? 'FIXED_MONTHLY',
          fixedMonthlyFee: util.fixedMonthlyFee ?? 150000,
        },
      });
    } catch {
      /* schema may differ */
    }

    await this.prisma.onboardingDraft.update({
      where: { id: draft.id },
      data: {
        workspaceId: input.workspaceId,
        step: 'applied',
        answersJson: {
          ...answers,
          appliedPropertyId: property.id,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      property,
      roomsCreated: rooms.length,
      utilityPolicy: policy,
      note: 'Suggestion applied — review rooms & utility policy',
    };
  }
}
