import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { InsightsService } from './insights.service';

class SummaryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;
}

class ForecastDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;
}

class HistoryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}

class RentDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  roomId!: string;
}

@Controller('v1/insights')
@UseGuards(ClerkAuthGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Post('financial-summary')
  summary(@CurrentUser() user: AuthUser, @Body() body: SummaryDto) {
    return this.insights.financialSummary(
      user,
      body.workspaceId,
      body.propertyId,
    );
  }

  @Post('cash-flow-forecast')
  forecast(@CurrentUser() user: AuthUser, @Body() body: ForecastDto) {
    return this.insights.cashFlowForecast(
      user,
      body.workspaceId,
      body.propertyId,
    );
  }

  @Post('cash-history')
  history(@CurrentUser() user: AuthUser, @Body() body: HistoryDto) {
    return this.insights.cashHistory(
      user,
      body.workspaceId,
      body.months ?? 6,
      body.propertyId,
    );
  }

  @Post('rent-recommendation')
  rent(@CurrentUser() user: AuthUser, @Body() body: RentDto) {
    return this.insights.rentRecommendation(user, body);
  }
}
