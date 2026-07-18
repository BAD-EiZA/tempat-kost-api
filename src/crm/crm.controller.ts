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
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProspectStatus } from '@prisma/client';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { CrmService } from './crm.service';

class WsQuery {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class CreateProspectDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budget?: number;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class StatusDto {
  @IsEnum(ProspectStatus)
  status!: ProspectStatus;

  @IsOptional()
  @IsString()
  lostReason?: string;
}

class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  prospectId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  holdDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  feeAmount?: number;
}

@Controller('v1/crm')
@UseGuards(ClerkAuthGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('prospects')
  prospects(@CurrentUser() user: AuthUser, @Query() q: WsQuery) {
    return this.crm.listProspects(user, q.workspaceId);
  }

  @Post('prospects')
  createProspect(@CurrentUser() user: AuthUser, @Body() body: CreateProspectDto) {
    return this.crm.createProspect(user, body);
  }

  @Patch('prospects/:id/status')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: StatusDto,
  ) {
    return this.crm.updateProspectStatus(
      user,
      id,
      body.status,
      body.lostReason,
    );
  }

  @Get('funnel')
  funnel(@CurrentUser() user: AuthUser, @Query() q: WsQuery) {
    return this.crm.funnel(user, q.workspaceId);
  }

  @Post('prospects/:id/convert')
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.crm.convertProspect(user, id);
  }

  @Get('bookings')
  bookings(@CurrentUser() user: AuthUser, @Query() q: WsQuery) {
    return this.crm.listBookings(user, q.workspaceId);
  }

  @Post('bookings')
  createBooking(@CurrentUser() user: AuthUser, @Body() body: CreateBookingDto) {
    return this.crm.createBooking(user, body);
  }

  @Post('bookings/:id/fee-invoice')
  feeInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.crm.createBookingFeeInvoice(user, id);
  }

  @Post('bookings/:id/mark-paid')
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.crm.markBookingPaid(user, id);
  }
}
