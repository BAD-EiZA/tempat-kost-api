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
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { MetersService } from './meters.service';

class ListQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;
}

class CreateMeterDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsString()
  meterNumber?: string;
}

class ReadingDto {
  @IsString()
  @IsNotEmpty()
  meterId!: string;

  @IsString()
  @IsNotEmpty()
  periodLabel!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  previousReading!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  currentReading!: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

@Controller('v1')
@UseGuards(ClerkAuthGuard)
export class MetersController {
  constructor(private readonly meters: MetersService) {}

  @Get('meters')
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.meters.listMeters(user, query.workspaceId, query.propertyId);
  }

  @Post('meters')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateMeterDto) {
    return this.meters.createMeter(user, body);
  }

  @Post('meter-readings')
  reading(@CurrentUser() user: AuthUser, @Body() body: ReadingDto) {
    return this.meters.recordReading(user, body);
  }

  @Post('meter-readings/:id/verify')
  verify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meters.verifyReading(user, id);
  }
}
