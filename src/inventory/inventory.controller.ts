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
import { InventoryService } from './inventory.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class CreateDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  condition?: string;
}

@Controller('v1/inventory')
@UseGuards(ClerkAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.inventory.list(user, query.workspaceId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateDto) {
    return this.inventory.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      category?: string;
      condition?: string;
      status?: string;
      propertyId?: string | null;
      roomId?: string | null;
      notes?: string;
    },
  ) {
    return this.inventory.update(user, id, body);
  }

  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inventory.archive(user, id);
  }
}
