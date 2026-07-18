import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, RoomStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getBySlug(slug: string) {
    const property = await this.prisma.property.findFirst({
      where: { publicSlug: slug, publicPublished: true, status: 'ACTIVE' },
      include: {
        roomTypes: true,
        rooms: {
          where: { status: { in: ['AVAILABLE', 'RESERVED'] } },
          select: {
            id: true,
            name: true,
            status: true,
            rentAmount: true,
            capacity: true,
            depositAmount: true,
          },
        },
      },
    });
    if (!property) throw new NotFoundException('Property not found');

    const available = property.rooms.filter((r) => r.status === 'AVAILABLE');
    const minRent = available.reduce((min, r) => {
      const v = Number(r.rentAmount);
      return min === 0 || v < min ? v : min;
    }, Number(property.startingPrice ?? 0));

    return {
      id: property.id,
      workspaceId: property.workspaceId,
      slug: property.publicSlug,
      name: property.name,
      description: property.description,
      addressLine: property.addressLine,
      city: property.city,
      province: property.province,
      whatsapp: property.publicWhatsapp ?? property.contactPhone,
      brandColor: property.brandColor,
      startingPrice: property.startingPrice ?? minRent,
      roomTypes: property.roomTypes,
      availabilitySummary: {
        available: available.length,
        reserved: property.rooms.filter((r) => r.status === 'RESERVED').length,
      },
      rooms: available.map((r) => ({
        id: r.id,
        name: r.name,
        rentAmount: r.rentAmount,
        depositAmount: r.depositAmount,
        capacity: r.capacity,
      })),
      whatsappLink: property.publicWhatsapp
        ? `https://wa.me/${property.publicWhatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Halo, saya tertarik dengan ${property.name}`)}`
        : null,
      bookingEnabled: true,
    };
  }

  async publish(
    propertyId: string,
    input: {
      slug: string;
      whatsapp?: string;
      startingPrice?: number;
      brandColor?: string;
      published?: boolean;
    },
  ) {
    return this.prisma.property.update({
      where: { id: propertyId },
      data: {
        publicSlug: input.slug,
        publicWhatsapp: input.whatsapp,
        startingPrice: input.startingPrice,
        brandColor: input.brandColor,
        publicPublished: input.published ?? true,
      },
    });
  }

  /**
   * Public booking: create prospect + hold + booking-fee invoice.
   * Optional Midtrans snap if fee > 0 and server key configured.
   */
  async createPublicBooking(input: {
    slug: string;
    roomId: string;
    fullName: string;
    phone: string;
    email?: string;
    holdDays?: number;
    feeAmount?: number;
    notes?: string;
  }) {
    const property = await this.prisma.property.findFirst({
      where: { publicSlug: input.slug, publicPublished: true },
    });
    if (!property) throw new NotFoundException('Property not found');

    const room = await this.prisma.room.findFirst({
      where: {
        id: input.roomId,
        propertyId: property.id,
        status: RoomStatus.AVAILABLE,
      },
    });
    if (!room) throw new BadRequestException('Room not available');

    const holdUntil = new Date();
    holdUntil.setDate(holdUntil.getDate() + (input.holdDays ?? 3));
    const fee =
      input.feeAmount !== undefined
        ? input.feeAmount
        : Math.min(Number(room.depositAmount) || 500000, 500000);

    const result = await this.prisma.$transaction(async (tx) => {
      const prospect = await tx.prospect.create({
        data: {
          workspaceId: property.workspaceId,
          propertyId: property.id,
          fullName: input.fullName,
          phone: input.phone,
          email: input.email,
          status: 'RESERVED',
          source: 'public_page',
          notes: input.notes,
        },
      });

      await tx.room.update({
        where: { id: room.id },
        data: { status: RoomStatus.RESERVED },
      });

      const booking = await tx.booking.create({
        data: {
          workspaceId: property.workspaceId,
          propertyId: property.id,
          roomId: room.id,
          prospectId: prospect.id,
          holdUntil,
          feeAmount: fee,
          status: BookingStatus.HOLD,
          notes: input.notes,
        },
      });

      let invoiceId: string | null = null;
      if (fee > 0) {
        const year = new Date().getFullYear();
        const count = await tx.invoice.count({
          where: { workspaceId: property.workspaceId },
        });
        const invoiceNumber = `INV-${year}-PB${String(count + 1).padStart(5, '0')}`;
        const tenant = await tx.tenant.create({
          data: {
            workspaceId: property.workspaceId,
            fullName: input.fullName,
            phone: input.phone,
            email: input.email,
            status: 'PROSPECT',
          },
        });
        const invoice = await tx.invoice.create({
          data: {
            workspaceId: property.workspaceId,
            propertyId: property.id,
            tenantId: tenant.id,
            invoiceNumber,
            type: 'BOOKING',
            status: 'OPEN',
            issueDate: new Date(),
            dueDate: holdUntil,
            subtotal: fee,
            total: fee,
            issuedAt: new Date(),
            notes: `Public booking ${booking.id}`,
            items: {
              create: [
                {
                  description: `Booking fee ${room.name}`,
                  quantity: 1,
                  unitPrice: fee,
                  amount: fee,
                },
              ],
            },
          },
        });
        invoiceId = invoice.id;
        await tx.booking.update({
          where: { id: booking.id },
          data: { feeInvoiceId: invoice.id },
        });
      }

      return { booking, invoiceId, prospectId: prospect.id };
    });

    let payment: {
      orderId?: string;
      token?: string;
      redirectUrl?: string;
      clientKey?: string;
      isProduction?: boolean;
    } | null = null;

    const serverKey = this.config.get<string>('MIDTRANS_SERVER_KEY');
    if (result.invoiceId && fee > 0 && serverKey) {
      payment = await this.createPublicSnap(
        property.workspaceId,
        result.invoiceId,
        fee,
        input.fullName,
        input.email,
        input.phone,
      );
    }

    return {
      bookingId: result.booking.id,
      prospectId: result.prospectId,
      invoiceId: result.invoiceId,
      feeAmount: fee,
      holdUntil: result.booking.holdUntil,
      room: { id: room.id, name: room.name },
      payment,
    };
  }

  private async createPublicSnap(
    workspaceId: string,
    invoiceId: string,
    amount: number,
    fullName: string,
    email?: string,
    phone?: string,
  ) {
    const isProd = this.config.get<boolean>('MIDTRANS_IS_PRODUCTION');
    const base = isProd
      ? 'https://app.midtrans.com'
      : 'https://app.sandbox.midtrans.com';
    const serverKey = this.config.getOrThrow<string>('MIDTRANS_SERVER_KEY');
    const orderId = `PB-${invoiceId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
    const grossAmount = Math.round(amount);

    const res = await fetch(`${base}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        customer_details: {
          first_name: fullName,
          email: email ?? undefined,
          phone: phone ?? undefined,
        },
        item_details: [
          {
            id: invoiceId,
            price: grossAmount,
            quantity: 1,
            name: 'Booking fee',
          },
        ],
      }),
    });
    const json = (await res.json()) as {
      token?: string;
      redirect_url?: string;
      error_messages?: string[];
    };
    if (!res.ok || !json.token) {
      throw new BadRequestException(
        json.error_messages?.join(', ') ?? 'Midtrans snap failed',
      );
    }

    await this.prisma.paymentAttempt.create({
      data: {
        workspaceId,
        invoiceId,
        amount: grossAmount,
        orderId,
        snapToken: json.token,
        redirectUrl: json.redirect_url,
        status: 'pending',
        rawResponse: json as object,
      },
    });

    return {
      orderId,
      token: json.token,
      redirectUrl: json.redirect_url,
      clientKey: this.config.get<string>('MIDTRANS_CLIENT_KEY'),
      isProduction: isProd,
    };
  }
}
