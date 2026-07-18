import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { AuthUser } from '../common/auth/auth.types';
import { textToPdfBase64 } from '../common/pdf/pdf.util';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  private buildBody(lease: {
    leaseNumber: string;
    startDate: Date;
    endDate: Date | null;
    rentAmount: { toString(): string };
    depositAmount: { toString(): string };
    tenant: { fullName: string; phone: string | null; email: string | null };
    room: { name: string; code: string };
    property: { name: string; addressLine: string | null };
  }) {
    return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Kontrak ${lease.leaseNumber}</title>
<style>body{font-family:serif;max-width:700px;margin:40px auto;line-height:1.6}
h1{font-size:18px;text-align:center}table{width:100%;border-collapse:collapse}
td{padding:4px 0;vertical-align:top}.sig{margin-top:48px;display:flex;justify-content:space-between}
.sig div{width:40%;text-align:center;border-top:1px solid #000;padding-top:8px;margin-top:80px}
</style></head><body>
<h1>PERJANJIAN SEWA KAMAR KOS</h1>
<p>Nomor: <b>${lease.leaseNumber}</b></p>
<table>
<tr><td>Properti</td><td>${lease.property.name}</td></tr>
<tr><td>Alamat</td><td>${lease.property.addressLine ?? '-'}</td></tr>
<tr><td>Kamar</td><td>${lease.room.name} (${lease.room.code})</td></tr>
<tr><td>Penyewa</td><td>${lease.tenant.fullName}</td></tr>
<tr><td>Telepon / Email</td><td>${lease.tenant.phone ?? '-'} / ${lease.tenant.email ?? '-'}</td></tr>
<tr><td>Mulai</td><td>${lease.startDate.toISOString().slice(0, 10)}</td></tr>
<tr><td>Selesai</td><td>${lease.endDate ? lease.endDate.toISOString().slice(0, 10) : 'Tidak ditentukan'}</td></tr>
<tr><td>Sewa / bulan</td><td>Rp ${Number(lease.rentAmount).toLocaleString('id-ID')}</td></tr>
<tr><td>Deposit</td><td>Rp ${Number(lease.depositAmount).toLocaleString('id-ID')}</td></tr>
</table>
<p>Para pihak sepakat atas ketentuan sewa di atas. Penyewa wajib mematuhi peraturan kos.
Perubahan sewa/utilitas hanya melalui addendum.</p>
<div class="sig"><div>Pemilik / Pengelola</div><div>Penyewa<br/>${lease.tenant.fullName}</div></div>
</body></html>`.trim();
  }

  async generate(auth: AuthUser, leaseId: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        tenant: true,
        room: true,
        property: true,
      },
    });
    if (!lease) throw new NotFoundException('Lease not found');
    const { membership } = await this.workspaces.assertPermission(
      auth,
      lease.workspaceId,
      'lease',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, lease.propertyId);

    const count = await this.prisma.contractDocument.count({
      where: { leaseId },
    });
    const bodyHtml = this.buildBody(lease);
    const signToken = randomBytes(24).toString('hex');

    return this.prisma.contractDocument.create({
      data: {
        workspaceId: lease.workspaceId,
        leaseId,
        version: count + 1,
        bodyHtml,
        status: 'pending_signature',
        signToken,
        signerName: lease.tenant.fullName,
        signerEmail: lease.tenant.email,
      },
    });
  }

  async listByLease(auth: AuthUser, leaseId: string) {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: { workspaceId: true, propertyId: true },
    });
    if (!lease) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      lease.workspaceId,
      'lease',
      'view',
    );
    this.workspaces.assertPropertyInScope(membership, lease.propertyId);
    return this.prisma.contractDocument.findMany({
      where: { leaseId },
      orderBy: { version: 'desc' },
    });
  }

  async getPublicByToken(token: string) {
    const doc = await this.prisma.contractDocument.findUnique({
      where: { signToken: token },
      include: {
        lease: {
          include: {
            tenant: { select: { fullName: true } },
            property: { select: { name: true } },
            room: { select: { name: true } },
          },
        },
      },
    });
    if (!doc) throw new NotFoundException('Contract not found');
    return {
      id: doc.id,
      status: doc.status,
      bodyHtml: doc.bodyHtml,
      signerName: doc.signerName,
      leaseNumber: doc.lease.leaseNumber,
      propertyName: doc.lease.property.name,
      roomName: doc.lease.room.name,
      signedAt: doc.signedAt,
    };
  }

  async signByToken(
    token: string,
    input: { signerName: string; signatureData: string },
  ) {
    const signerName = input.signerName.trim();
    if (!signerName) throw new BadRequestException('Signer name is required');
    if (
      !input.signatureData.startsWith('data:image/png;base64,') &&
      !input.signatureData.startsWith('data:text/plain;charset=utf-8,')
    ) {
      throw new BadRequestException('Invalid signature format');
    }
    const doc = await this.prisma.contractDocument.findUnique({
      where: { signToken: token },
    });
    if (!doc) throw new NotFoundException();
    if (doc.status === 'signed') {
      throw new BadRequestException('Already signed');
    }
    if (doc.status === 'void') {
      throw new BadRequestException('Contract is void');
    }
    return this.prisma.contractDocument.update({
      where: { id: doc.id },
      data: {
        status: 'signed',
        signedAt: new Date(),
        signerName,
        signatureData: input.signatureData,
      },
    });
  }

  async void(auth: AuthUser, id: string, reason?: string) {
    const doc = await this.prisma.contractDocument.findUnique({
      where: { id },
      include: { lease: { select: { propertyId: true } } },
    });
    if (!doc) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      doc.workspaceId,
      'lease',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, doc.lease.propertyId);
    if (doc.status === 'void') throw new BadRequestException('Already void');
    return this.prisma.contractDocument.update({
      where: { id },
      data: {
        status: 'void',
        voidedAt: new Date(),
        voidReason: reason ?? 'voided',
        signToken: null,
      },
    });
  }

  async ownerCountersign(
    auth: AuthUser,
    id: string,
    input: { ownerName: string },
  ) {
    const doc = await this.prisma.contractDocument.findUnique({
      where: { id },
      include: { lease: { select: { propertyId: true } } },
    });
    if (!doc) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      doc.workspaceId,
      'lease',
      'update',
    );
    this.workspaces.assertPropertyInScope(membership, doc.lease.propertyId);
    if (doc.status === 'void') throw new BadRequestException('Contract void');
    return this.prisma.contractDocument.update({
      where: { id },
      data: {
        ownerName: input.ownerName,
        ownerSignedAt: new Date(),
        status: doc.status === 'signed' ? 'fully_signed' : doc.status,
      },
    });
  }

  async pdfBase64(auth: AuthUser, id: string) {
    const doc = await this.prisma.contractDocument.findUnique({
      where: { id },
      include: { lease: true },
    });
    if (!doc) throw new NotFoundException();
    const { membership } = await this.workspaces.assertPermission(
      auth,
      doc.workspaceId,
      'lease',
      'view',
    );
    this.workspaces.assertPropertyInScope(membership, doc.lease.propertyId);
    return this.buildPdf(doc);
  }

  /** Portal tenant can download own contract PDF */
  async pdfForTenant(auth: AuthUser, id: string, tenantId: string) {
    const doc = await this.prisma.contractDocument.findUnique({
      where: { id },
      include: {
        lease: true,
      },
    });
    if (!doc) throw new NotFoundException();
    if (doc.lease.tenantId !== tenantId) {
      throw new NotFoundException('Contract not found');
    }
    // ensure portal access via tenant link
    const user = await this.prisma.user.findUnique({
      where: { externalUserId: auth.externalUserId },
    });
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (
      !user ||
      !tenant ||
      (tenant.portalUserId !== user.id &&
        !(user.email && tenant.email === user.email))
    ) {
      throw new NotFoundException('Contract not found');
    }
    return this.buildPdf(doc);
  }

  private async buildPdf(doc: {
    version: number;
    bodyHtml: string;
    signedAt: Date | null;
    signerName: string | null;
    lease: { leaseNumber: string };
  }) {
    const text = doc.bodyHtml
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n+/g, '\n')
      .trim();
    const pdf = await textToPdfBase64(
      `Kontrak ${doc.lease.leaseNumber} v${doc.version}`,
      text +
        (doc.signedAt
          ? `\n\nDitandatangani: ${doc.signerName} @ ${doc.signedAt.toISOString()}`
          : '\n\n(Belum ditandatangani)'),
    );
    return {
      pdfBase64: pdf,
      fileName: `contract-${doc.lease.leaseNumber}-v${doc.version}.pdf`,
    };
  }
}
