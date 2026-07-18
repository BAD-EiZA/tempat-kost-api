import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { Public } from '../common/auth/public.decorator';
import { MidtransService } from './midtrans.service';

class CreateSnapDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  invoiceId!: string;
}

@Controller()
export class MidtransController {
  constructor(private readonly midtrans: MidtransService) {}

  @UseGuards(ClerkAuthGuard)
  @Post('v1/payments/midtrans/attempts')
  createAttempt(@CurrentUser() user: AuthUser, @Body() body: CreateSnapDto) {
    return this.midtrans.createSnapAttempt(user, body);
  }

  @Public()
  @Post('v1/webhooks/midtrans')
  webhook(@Body() body: Record<string, unknown>) {
    return this.midtrans.handleWebhook(body);
  }
}
