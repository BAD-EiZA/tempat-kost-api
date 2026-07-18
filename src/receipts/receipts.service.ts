import { Injectable, NotFoundException } from '@nestjs/common';
import { textToPdfBase64 } from '../common/pdf/pdf.util';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        tenant: true,
        allocations: {
          include: { invoice: true },
        },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'CONFIRMED') return null;

    const existing = await this.prisma.receipt.findUnique({
      where: { paymentId },
    });
    if (existing) return existing;

    const year = new Date().getFullYear();
    const count = await this.prisma.receipt.count({
      where: { workspaceId: payment.workspaceId },
    });
    const receiptNumber = `RCP-${year}-${String(count + 1).padStart(5, '0')}`;
    const lines = payment.allocations
      .map(
        (a) =>
          `- ${a.invoice.invoiceNumber}: Rp ${Number(a.amount).toLocaleString('id-ID')}`,
      )
      .join('\n');
    const bodyText = [
      `Kuitansi ${receiptNumber}`,
      `Pembayaran: ${payment.paymentNumber}`,
      `Penyewa: ${payment.tenant?.fullName ?? '-'}`,
      `Metode: ${payment.method}`,
      `Nominal: Rp ${Number(payment.amount).toLocaleString('id-ID')}`,
      `Tanggal: ${payment.paidAt?.toISOString().slice(0, 10) ?? '-'}`,
      `Alokasi:`,
      lines || '- (tanpa alokasi invoice)',
      '',
      'Terima kasih.',
    ].join('\n');

    let pdfBase64: string | undefined;
    try {
      pdfBase64 = await textToPdfBase64(`Kuitansi ${receiptNumber}`, bodyText);
    } catch {
      pdfBase64 = undefined;
    }

    return this.prisma.receipt.create({
      data: {
        workspaceId: payment.workspaceId,
        paymentId: payment.id,
        receiptNumber,
        bodyText,
        pdfBase64,
      },
    });
  }

  async getByPayment(paymentId: string) {
    return this.prisma.receipt.findUnique({ where: { paymentId } });
  }

  /** Simple HTML printable receipt (browser → PDF). */
  async getHtml(paymentId: string) {
    let receipt = await this.getByPayment(paymentId);
    if (!receipt) {
      receipt = await this.createForPayment(paymentId);
    }
    if (!receipt) throw new NotFoundException('Receipt not found');
    const escaped = receipt.bodyText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/><title>${receipt.receiptNumber}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#18181b}
pre{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:14px;line-height:1.5}
h1{font-size:18px;margin-bottom:8px}
.meta{color:#71717a;font-size:12px;margin-bottom:24px}
@media print{body{margin:0}}
</style></head><body>
<h1>Kuitansi ${receipt.receiptNumber}</h1>
<p class="meta">Tempat Kost · ${receipt.createdAt.toISOString().slice(0, 10)}</p>
<pre>${escaped}</pre>
<script>window.onload=()=>{if(location.search.includes('print=1'))window.print()}</script>
</body></html>`;
    return { receiptNumber: receipt.receiptNumber, html };
  }

  async getPdf(paymentId: string) {
    let receipt = await this.getByPayment(paymentId);
    if (!receipt) {
      receipt = await this.createForPayment(paymentId);
    }
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (!receipt.pdfBase64) {
      const pdfBase64 = await textToPdfBase64(
        `Kuitansi ${receipt.receiptNumber}`,
        receipt.bodyText,
      );
      receipt = await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: { pdfBase64 },
      });
    }
    return {
      receiptNumber: receipt.receiptNumber,
      pdfBase64: receipt.pdfBase64,
      fileName: `${receipt.receiptNumber}.pdf`,
    };
  }
}
