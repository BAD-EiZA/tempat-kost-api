import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types';
import {
  AI_PROVIDER_PORT,
  type AiProviderPort,
} from '../common/ports/ai-provider.port';
import { PrismaService } from '../common/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

const OCR_FIELD_KEYS = [
  'fullName',
  'nik',
  'phone',
  'email',
  'hometownAddress',
  'dateOfBirth',
  'gender',
] as const;

@Injectable()
export class TenantDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(AI_PROVIDER_PORT) private readonly ai: AiProviderPort,
  ) {}

  private assertTenantInScope(
    membership: Parameters<WorkspacesService['propertyScope']>[0],
    leases: Array<{ propertyId: string }>,
  ) {
    const scope = this.workspaces.propertyScope(membership);
    if (scope && leases.length && !leases.some((l) => scope.includes(l.propertyId))) {
      throw new NotFoundException();
    }
  }

  async list(auth: AuthUser, tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { leases: { select: { propertyId: true } } },
    });
    if (!tenant) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      tenant.workspaceId,
      'tenant',
      'view',
    );
    this.assertTenantInScope(membership, tenant.leases);
    return this.prisma.tenantDocument.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    auth: AuthUser,
    input: {
      tenantId: string;
      kind?: string;
      fileUrl: string;
      fileName?: string;
      runOcr?: boolean;
      base64?: string;
      mimeType?: string;
      consent?: boolean;
    },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      include: { leases: { select: { propertyId: true } } },
    });
    if (!tenant) throw new NotFoundException();
    const { user, membership } = await this.workspaces.assertPermission(
      auth,
      tenant.workspaceId,
      'tenant',
      'update',
    );
    this.assertTenantInScope(membership, tenant.leases);

    if (input.runOcr && !input.consent) {
      throw new BadRequestException(
        'OCR KTP membutuhkan persetujuan (consent) penyewa/operator',
      );
    }

    let ocrJson: object | undefined;
    if (input.runOcr) {
      await this.subscriptions.consumeAiCredit(tenant.workspaceId);
      const out = await this.ai.extractIdentity({
        imageUrl: input.fileUrl,
        base64: input.base64,
        mimeType: input.mimeType,
      });
      ocrJson = {
        ...(out.data as object),
        _meta: {
          model: out.model,
          confidence: out.confidence,
          extractedAt: new Date().toISOString(),
        },
      };
    }

    return this.prisma.tenantDocument.create({
      data: {
        tenantId: input.tenantId,
        kind: input.kind ?? 'ktp',
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        status: ocrJson ? 'ocr_done' : 'uploaded',
        ocrJson,
        consentAt: input.consent ? new Date() : undefined,
        consentById: input.consent ? user.id : undefined,
      },
    });
  }

  /** Apply OCR fields to tenant after human confirm */
  async applyOcr(auth: AuthUser, documentId: string, fields?: string[]) {
    const doc = await this.prisma.tenantDocument.findUnique({
      where: { id: documentId },
      include: { tenant: true },
    });
    if (!doc) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      doc.tenant.workspaceId,
      'tenant',
      'update',
    );
    const leases = await this.prisma.lease.findMany({
      where: { tenantId: doc.tenantId },
      select: { propertyId: true },
    });
    this.assertTenantInScope(membership, leases);
    if (!doc.ocrJson) {
      throw new BadRequestException('Dokumen belum punya hasil OCR');
    }
    if (!doc.consentAt) {
      throw new BadRequestException(
        'Apply OCR butuh consent tercatat di dokumen',
      );
    }

    const ocr = doc.ocrJson as Record<string, unknown>;
    const allow = new Set(
      fields?.length ? fields : [...OCR_FIELD_KEYS],
    );

    const data: {
      fullName?: string;
      nik?: string;
      phone?: string;
      email?: string;
      hometownAddress?: string;
      dateOfBirth?: Date;
      gender?: string;
    } = {};

    const fullName =
      (typeof ocr.fullName === 'string' && ocr.fullName) ||
      (typeof ocr.name === 'string' && ocr.name) ||
      null;
    if (allow.has('fullName') && fullName) data.fullName = fullName.trim();

    if (allow.has('nik')) {
      const nik = String(ocr.nik ?? ocr.NIK ?? '').replace(/\D/g, '');
      if (nik.length >= 14) data.nik = nik;
    }
    if (allow.has('phone') && typeof ocr.phone === 'string')
      data.phone = ocr.phone.trim();
    if (allow.has('email') && typeof ocr.email === 'string')
      data.email = ocr.email.trim();
    if (allow.has('hometownAddress')) {
      const addr =
        (typeof ocr.address === 'string' && ocr.address) ||
        (typeof ocr.alamat === 'string' && ocr.alamat) ||
        null;
      if (addr) data.hometownAddress = addr.trim();
    }
    if (allow.has('dateOfBirth')) {
      const raw =
        (typeof ocr.birthDate === 'string' && ocr.birthDate) ||
        (typeof ocr.dateOfBirth === 'string' && ocr.dateOfBirth) ||
        null;
      if (raw) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) data.dateOfBirth = d;
      }
    }
    if (allow.has('gender')) {
      const g =
        (typeof ocr.gender === 'string' && ocr.gender) ||
        (typeof ocr.jenisKelamin === 'string' && ocr.jenisKelamin) ||
        null;
      if (g) {
        const lower = g.toLowerCase();
        data.gender =
          lower.startsWith('l') || lower.includes('male')
            ? 'L'
            : lower.startsWith('p') || lower.includes('female')
              ? 'P'
              : g.slice(0, 16);
      }
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException('Tidak ada field OCR yang bisa diterapkan');
    }

    const tenant = await this.prisma.tenant.update({
      where: { id: doc.tenantId },
      data,
    });
    await this.prisma.tenantDocument.update({
      where: { id: documentId },
      data: {
        status: 'applied',
        appliedFields: Object.keys(data),
      },
    });
    return {
      tenant,
      applied: Object.keys(data),
      availableFields: OCR_FIELD_KEYS,
    };
  }
}
