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
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MaintenanceStatus } from '@prisma/client';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { MaintenanceService } from './maintenance.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class CreateDto {
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
  tenantId?: string;

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

  @IsOptional()
  photoUrls?: string[];

  @IsOptional()
  runAi?: boolean;
}

class StatusDto {
  @IsEnum(MaintenanceStatus)
  status!: MaintenanceStatus;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

@Controller('v1/maintenance')
@UseGuards(ClerkAuthGuard)
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.maintenance.list(user, query.workspaceId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateDto) {
    return this.maintenance.create(user, body);
  }

  @Patch(':id/status')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: StatusDto,
  ) {
    return this.maintenance.updateStatus(
      user,
      id,
      body.status,
      body.assignedTo,
    );
  }
}
