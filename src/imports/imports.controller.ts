import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { ImportsService } from './imports.service';

class PreviewDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsIn(['rooms', 'tenants', 'leases', 'payments', 'expenses'])
  kind!: 'rooms' | 'tenants' | 'leases' | 'payments' | 'expenses';

  @IsArray()
  @IsString({ each: true })
  headers!: string[];

  @IsArray()
  rows!: string[][];
}

class CommitDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsObject()
  mapping!: Record<string, string | null>;

  @IsArray()
  @IsString({ each: true })
  headers!: string[];

  @IsArray()
  rows!: string[][];
}

@Controller('v1/imports')
@UseGuards(ClerkAuthGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @Body() body: PreviewDto) {
    return this.imports.mapAndPreview(user, body);
  }

  @Post('commit')
  commit(@CurrentUser() user: AuthUser, @Body() body: CommitDto) {
    return this.imports.commit(user, body);
  }
}
