import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
import { StructureService } from './structure.service';

@Controller('v1/structure')
@UseGuards(ClerkAuthGuard)
export class StructureController {
  constructor(private readonly structure: StructureService) {}

  @Get('buildings')
  buildings(
    @CurrentUser() user: AuthUser,
    @Query('propertyId') propertyId: string,
  ) {
    return this.structure.listBuildings(user, propertyId);
  }

  @Post('buildings')
  createBuilding(
    @CurrentUser() user: AuthUser,
    @Body() body: { propertyId: string; name: string; code?: string },
  ) {
    return this.structure.createBuilding(user, body);
  }

  @Post('floors')
  createFloor(
    @CurrentUser() user: AuthUser,
    @Body() body: { buildingId: string; name: string; level?: number },
  ) {
    return this.structure.createFloor(user, body);
  }

  @Get('room-types')
  roomTypes(
    @CurrentUser() user: AuthUser,
    @Query('workspaceId') workspaceId: string,
    @Query('propertyId') propertyId?: string,
  ) {
    return this.structure.listRoomTypes(user, workspaceId, propertyId);
  }

  @Post('room-types')
  createRoomType(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      propertyId?: string;
      name: string;
      baseRent?: number;
      defaultDeposit?: number;
      capacity?: number;
      description?: string;
    },
  ) {
    return this.structure.createRoomType(user, body);
  }
}
