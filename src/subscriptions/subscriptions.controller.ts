import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { Public } from '../common/auth/public.decorator';
import { SubscriptionsService } from './subscriptions.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

@Controller('v1/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.subscriptions.listPlans();
  }

  @UseGuards(ClerkAuthGuard)
  @Get('current')
  current(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.subscriptions.getForWorkspace(user, query.workspaceId);
  }
}
