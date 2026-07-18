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
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import {
  BulkCreateRoomsDto,
  CreateRoomDto,
} from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsService } from './rooms.service';

class ListRoomsQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;
}

@Controller('v1/rooms')
@UseGuards(ClerkAuthGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListRoomsQueryDto) {
    return this.rooms.list(user, query.workspaceId, query.propertyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rooms.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRoomDto) {
    return this.rooms.create(user, body);
  }

  @Post('bulk')
  bulk(@CurrentUser() user: AuthUser, @Body() body: BulkCreateRoomsDto) {
    return this.rooms.bulkCreate(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateRoomDto,
  ) {
    return this.rooms.update(user, id, body);
  }
}
