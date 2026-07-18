import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { MidtransService } from '../midtrans/midtrans.service';
import { PortalService } from './portal.service';

class TenantQueryDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;
}

class CreateMaintenanceDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  urgency?: string;
}

class PayInvoiceDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  invoiceId!: string;
}

@Controller('v1/portal')
@UseGuards(ClerkAuthGuard)
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly midtrans: MidtransService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.portal.me(user);
  }

  @Get('home')
  home(@CurrentUser() user: AuthUser, @Query() query: TenantQueryDto) {
    return this.portal.home(user, query.tenantId);
  }

  @Get('invoices')
  invoices(@CurrentUser() user: AuthUser, @Query() query: TenantQueryDto) {
    return this.portal.invoices(user, query.tenantId);
  }

  @Get('invoices/:invoiceId')
  invoice(
    @CurrentUser() user: AuthUser,
    @Query() query: TenantQueryDto,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.portal.getInvoice(user, query.tenantId, invoiceId);
  }

  @Get('contracts')
  contracts(@CurrentUser() user: AuthUser, @Query() query: TenantQueryDto) {
    return this.portal.contractsWithSignLinks(user, query.tenantId);
  }

  @Get('payment-attempts')
  attempts(@CurrentUser() user: AuthUser, @Query() query: TenantQueryDto) {
    return this.portal.paymentAttempts(user, query.tenantId);
  }

  @Get('announcements')
  announcements(
    @CurrentUser() user: AuthUser,
    @Query() query: TenantQueryDto,
  ) {
    return this.portal.announcements(user, query.tenantId);
  }

  @Get('utilities')
  utilities(@CurrentUser() user: AuthUser, @Query() query: TenantQueryDto) {
    return this.portal.utilities(user, query.tenantId);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: AuthUser, @Query() query: TenantQueryDto) {
    return this.portal.getProfile(user, query.tenantId);
  }

  @Patch('profile')
  profile(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      tenantId: string;
      preferredName?: string;
      phone?: string;
      email?: string;
      emergencyName?: string;
      emergencyPhone?: string;
    },
  ) {
    return this.portal.updateProfile(user, body.tenantId, body);
  }

  @Post('pay')
  async pay(@CurrentUser() user: AuthUser, @Body() body: PayInvoiceDto) {
    const inv = await this.portal.getInvoice(
      user,
      body.tenantId,
      body.invoiceId,
    );
    return this.midtrans.createSnapAttempt(user, {
      workspaceId: inv.workspaceId,
      invoiceId: inv.id,
      skipMemberCheck: true,
    });
  }

  @Post('proof')
  proof(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      tenantId: string;
      invoiceId: string;
      proofUrl: string;
      amount?: number;
      manualReference?: string;
      notes?: string;
    },
  ) {
    return this.portal.uploadProof(user, body);
  }

  @Post('maintenance')
  maintenance(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateMaintenanceDto,
  ) {
    return this.portal.createMaintenance(user, body);
  }
}
