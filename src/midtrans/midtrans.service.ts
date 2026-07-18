import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class MidtransService {
  private readonly logger = new Logger(MidtransService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: AuditService,
  ) {}

  private baseUrl() {
    const prod = this.config.get<boolean>('MIDTRANS_IS_PRODUCTION');
    return prod
      ? 'https://app.midtrans.com'
      : 'https://app.sandbox.midtrans.com';
  }

  private serverKey() {
    return this.config.get<string>('MIDTRANS_SERVER_KEY') ?? '';
  }

  private authHeader() {
    const key = this.serverKey();
    return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
  }

  async createSnapAttempt(
    auth: AuthUser,
    input: {
      workspaceId: string;
      invoiceId: string;
      /** skip workspace membership (portal tenant pay) */
      skipMemberCheck?: boolean;
    },
  ) {
    if (!this.serverKey()) {
      throw new BadRequestException('MIDTRANS_SERVER_KEY not configured');
    }

    const staffContext = !input.skipMemberCheck
      ? await this.workspaces.assertPermission(
          auth,
          input.workspaceId,
          'payment',
          'create',
        )
      : null;
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: input.invoiceId, workspaceId: input.workspaceId },
      include: { tenant: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (staffContext) {
      this.workspaces.assertPropertyInScope(
        staffContext.membership,
        invoice.propertyId,
      );
    }
    if (
      invoice.status === InvoiceStatus.DRAFT ||
      invoice.status === InvoiceStatus.VOID ||
      invoice.status === InvoiceStatus.PAID
    ) {
      throw new BadRequestException('Invoice not payable');
    }

    const outstanding = new Prisma.Decimal(invoice.total).sub(
      invoice.amountPaid,
    );
    if (outstanding.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Nothing outstanding');
    }

    const orderId = `TK-${invoice.invoiceNumber}-${randomUUID().slice(0, 8)}`;
    const grossAmount = Number(outstanding.toFixed(0));

    const body = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      customer_details: {
        first_name: invoice.tenant?.fullName ?? 'Penyewa',
        email: invoice.tenant?.email ?? undefined,
        phone: invoice.tenant?.phone ?? undefined,
      },
      item_details: [
        {
          id: invoice.id,
          price: grossAmount,
          quantity: 1,
          name: invoice.invoiceNumber.slice(0, 50),
        },
      ],
    };

    const res = await fetch(`${this.baseUrl()}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: this.authHeader(),
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      token?: string;
      redirect_url?: string;
      error_messages?: string[];
      status_message?: string;
    };

    if (!res.ok || !json.token) {
      this.logger.warn(`Midtrans snap failed: ${JSON.stringify(json)}`);
      throw new BadRequestException(
        json.error_messages?.join(', ') ??
          json.status_message ??
          'Midtrans snap failed',
      );
    }

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        workspaceId: input.workspaceId,
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        amount: outstanding,
        orderId,
        snapToken: json.token,
        redirectUrl: json.redirect_url,
        status: 'pending',
        rawResponse: json as object,
      },
    });

    return {
      attemptId: attempt.id,
      orderId,
      token: json.token,
      redirectUrl: json.redirect_url,
      clientKey: this.config.get<string>('MIDTRANS_CLIENT_KEY'),
      isProduction: this.config.get<boolean>('MIDTRANS_IS_PRODUCTION'),
    };
  }

  verifySignature(payload: {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
  }) {
    const key = this.serverKey();
    const raw = `${payload.order_id}${payload.status_code}${payload.gross_amount}${key}`;
    const expected = createHash('sha512').update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(payload.signature_key);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async handleWebhook(body: Record<string, unknown>) {
    const orderId = String(body.order_id ?? '');
    const statusCode = String(body.status_code ?? '');
    const grossAmount = String(body.gross_amount ?? '');
    const signatureKey = String(body.signature_key ?? '');
    const transactionStatus = String(body.transaction_status ?? '');
    const fraudStatus = String(body.fraud_status ?? '');
    const transactionId = body.transaction_id
      ? String(body.transaction_id)
      : undefined;

    const signatureValid = this.verifySignature({
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
    });

    await this.prisma.webhookEvent
      .create({
        data: {
          provider: 'midtrans',
          eventType: transactionStatus || 'unknown',
          externalId: transactionId
            ? `${orderId}:${transactionId}:${transactionStatus}`
            : `${orderId}:${transactionStatus}:${statusCode}`,
          signatureValid,
          payload: body as object,
          status: signatureValid ? 'RECEIVED' : 'FAILED',
        },
      })
      .catch(() => {
        // idempotent: unique external id may already exist
      });

    if (!signatureValid) {
      throw new BadRequestException('Invalid Midtrans signature');
    }

    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { orderId },
    });
    if (!attempt) {
      this.logger.warn(`Unknown order_id ${orderId}`);
      return { ok: true, ignored: true };
    }

    if (!new Prisma.Decimal(grossAmount).equals(attempt.amount)) {
      throw new BadRequestException('Midtrans amount mismatch');
    }

    const success =
      transactionStatus === 'settlement' ||
      (transactionStatus === 'capture' && fraudStatus === 'accept');

    const pending =
      transactionStatus === 'pending' || transactionStatus === 'authorize';

    const fail =
      transactionStatus === 'deny' ||
      transactionStatus === 'cancel' ||
      transactionStatus === 'expire' ||
      transactionStatus === 'failure';

    if (pending) {
      await this.prisma.paymentAttempt.updateMany({
        where: {
          id: attempt.id,
          paymentId: null,
          status: { not: 'settlement' },
        },
        data: {
          status: 'pending',
          gatewayTransactionId: transactionId,
          rawResponse: body as object,
        },
      });
      return { ok: true, status: 'pending' };
    }

    if (fail) {
      const failed = await this.prisma.paymentAttempt.updateMany({
        where: {
          id: attempt.id,
          paymentId: null,
          status: { not: 'settlement' },
        },
        data: {
          status: 'failed',
          gatewayTransactionId: transactionId,
          rawResponse: body as object,
        },
      });
      if (failed.count === 0) return { ok: true, status: 'already_processed' };
      // reopen invoice if still pending verification from this attempt only
      if (attempt.invoiceId) {
        const inv = await this.prisma.invoice.findUnique({
          where: { id: attempt.invoiceId },
        });
        if (inv?.status === InvoiceStatus.PENDING_VERIFICATION) {
          const otherOk = await this.prisma.paymentAttempt.count({
            where: {
              invoiceId: attempt.invoiceId,
              status: 'settlement',
              id: { not: attempt.id },
            },
          });
          if (!otherOk) {
            await this.prisma.invoice.update({
              where: { id: inv.id },
              data: {
                status:
                  Number(inv.amountPaid) > 0
                    ? InvoiceStatus.PARTIALLY_PAID
                    : InvoiceStatus.OPEN,
              },
            });
          }
        }
      }
      return { ok: true, status: 'failed' };
    }

    if (!success) {
      return { ok: true, status: transactionStatus };
    }

    if (attempt.status === 'settlement' && attempt.paymentId) {
      return { ok: true, status: 'already_processed' };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentAttempt.updateMany({
        where: {
          id: attempt.id,
          paymentId: null,
          status: { not: 'settlement' },
        },
        data: {
          status: 'processing',
          gatewayTransactionId: transactionId,
          rawResponse: body as object,
        },
      });
      if (claimed.count === 0) return null;

      const year = new Date().getFullYear();
      const paymentNumber = `PAY-${year}-MT-${attempt.id.slice(-10)}`;

      const payment = await tx.payment.create({
        data: {
          workspaceId: attempt.workspaceId,
          tenantId: attempt.tenantId,
          paymentNumber,
          method: 'MIDTRANS',
          status: PaymentStatus.CONFIRMED,
          amount: attempt.amount,
          paidAt: new Date(),
          confirmedAt: new Date(),
          manualReference: transactionId,
        },
      });

      if (attempt.invoiceId) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: attempt.invoiceId,
            amount: attempt.amount,
          },
        });
        const inv = await tx.invoice.findUnique({
          where: { id: attempt.invoiceId },
        });
        if (inv) {
          const amountPaid = new Prisma.Decimal(inv.amountPaid).add(
            attempt.amount,
          );
          const status = amountPaid.greaterThanOrEqualTo(inv.total)
            ? InvoiceStatus.PAID
            : InvoiceStatus.PARTIALLY_PAID;
          const changed = await tx.invoice.updateMany({
            where: { id: inv.id, amountPaid: inv.amountPaid },
            data: { amountPaid, status },
          });
          if (changed.count !== 1) {
            throw new BadRequestException('Invoice balance changed; retry');
          }
        }
      }

      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'settlement',
          paymentId: payment.id,
          gatewayTransactionId: transactionId,
          rawResponse: body as object,
        },
      });

      return payment;
    });

    if (!result) return { ok: true, status: 'already_processed' };

    await this.audit.log({
      workspaceId: attempt.workspaceId,
      action: 'payment.midtrans_confirmed',
      entityType: 'payment',
      entityId: result.id,
      metadata: { orderId, transactionId },
    });

    return { ok: true, status: 'settlement', paymentId: result.id };
  }
}
