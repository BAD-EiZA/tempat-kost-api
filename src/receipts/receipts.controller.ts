import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { ReceiptsService } from './receipts.service';

@Controller('v1/receipts')
@UseGuards(ClerkAuthGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post('from-payment/:paymentId')
  create(@Param('paymentId') paymentId: string) {
    return this.receipts.createForPayment(paymentId);
  }

  @Get('by-payment/:paymentId')
  get(@Param('paymentId') paymentId: string) {
    return this.receipts.getByPayment(paymentId);
  }

  @Get('by-payment/:paymentId/html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async html(
    @Param('paymentId') paymentId: string,
    @Res() res: Response,
  ) {
    const { html } = await this.receipts.getHtml(paymentId);
    res.send(html);
  }

  @Get('by-payment/:paymentId/pdf')
  async pdf(@Param('paymentId') paymentId: string) {
    return this.receipts.getPdf(paymentId);
  }
}
