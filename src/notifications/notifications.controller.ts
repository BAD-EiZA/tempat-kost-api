import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { NotificationsService } from './notifications.service';

class ListQueryDto {
  @IsOptional()
  @IsString()
  workspaceId?: string;
}

class PushDto {
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;

  @IsOptional()
  @IsString()
  userAgent?: string;
}

@Controller('v1/notifications')
@UseGuards(ClerkAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.notifications.listForUser(user, query.workspaceId);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser, @Body() body: { workspaceId?: string }) {
    return this.notifications.markAllRead(user, body.workspaceId);
  }

  @Post('push')
  registerPush(@CurrentUser() user: AuthUser, @Body() body: PushDto) {
    return this.notifications.registerPush(user, body);
  }

  @Get('push')
  listPush(@CurrentUser() user: AuthUser) {
    return this.notifications.listPush(user);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }
}
