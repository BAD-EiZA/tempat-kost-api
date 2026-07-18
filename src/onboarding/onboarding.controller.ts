import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { OnboardingService } from './onboarding.service';

@Controller('v1/onboarding')
@UseGuards(ClerkAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('draft')
  draft(
    @CurrentUser() user: AuthUser,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.onboarding.getOrCreate(user, workspaceId);
  }

  @Post('step')
  step(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      draftId: string;
      step: string;
      answers: Record<string, unknown>;
      workspaceId?: string;
    },
  ) {
    return this.onboarding.saveStep(user, body);
  }

  @Post('suggest')
  suggest(
    @CurrentUser() user: AuthUser,
    @Body() body: { draftId: string },
  ) {
    return this.onboarding.suggest(user, body.draftId);
  }

  @Post('apply')
  apply(
    @CurrentUser() user: AuthUser,
    @Body()
    body: { draftId: string; workspaceId: string; propertyName?: string },
  ) {
    return this.onboarding.apply(user, body);
  }
}
