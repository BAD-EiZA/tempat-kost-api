import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { WorkspacesService } from './workspaces.service';

class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;
}

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  invoicePrefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  defaultDueDay?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lateFeePercent?: number;

  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  bankName?: string;
}

@Controller('v1/workspaces')
@UseGuards(ClerkAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.listForUser(user);
  }

  @Get(':workspaceId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspaces.get(user, workspaceId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateWorkspaceDto) {
    return this.workspaces.create(user, body.name, body.slug);
  }

  @Patch(':workspaceId/settings')
  settings(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() body: UpdateSettingsDto,
  ) {
    return this.workspaces.updateSettings(user, workspaceId, body);
  }
}
