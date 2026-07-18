import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { CreateLeaseDto } from './dto/create-lease.dto';
import { LeasesService } from './leases.service';

class ListLeasesQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;
}

class CheckinDto {
  @IsOptional()
  @IsBoolean()
  identityVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  contractSigned?: boolean;

  @IsOptional()
  @IsBoolean()
  depositRecorded?: boolean;

  @IsOptional()
  @IsBoolean()
  initialPaymentOk?: boolean;

  @IsOptional()
  @IsString()
  roomConditionNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  meterInitial?: number;

  @IsOptional()
  @IsBoolean()
  keysHanded?: boolean;

  @IsOptional()
  @IsBoolean()
  rulesAccepted?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

class CheckoutDto {
  @IsOptional()
  @IsDateString()
  exitDate?: string;

  @IsOptional()
  @IsString()
  inspectionNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  meterFinal?: number;

  @IsOptional()
  @IsBoolean()
  keysReturned?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  damageCost?: number;

  @IsOptional()
  @IsString()
  depositSettlement?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('v1/leases')
@UseGuards(ClerkAuthGuard)
export class LeasesController {
  constructor(private readonly leases: LeasesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListLeasesQueryDto) {
    return this.leases.list(user, query.workspaceId, query.propertyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leases.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateLeaseDto) {
    return this.leases.create(user, body);
  }

  @Post(':id/activate')
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CheckinDto,
  ) {
    return this.leases.activate(user, id, body);
  }

  @Post(':id/end')
  end(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CheckoutDto,
  ) {
    return this.leases.end(user, id, body);
  }
}
