import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { ReportsService } from './reports.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class ExportQueryDto extends WorkspaceQueryDto {
  @IsIn(['invoices', 'payments', 'tenants', 'expenses'])
  kind!: 'invoices' | 'payments' | 'tenants' | 'expenses';
}

@Controller('v1/reports')
@UseGuards(ClerkAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.reports.overview(user, query.workspaceId);
  }

  @Get('aging')
  aging(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.reports.aging(user, query.workspaceId);
  }

  @Get('pnl')
  pnl(
    @CurrentUser() user: AuthUser,
    @Query() query: WorkspaceQueryDto & { from?: string; to?: string },
  ) {
    return this.reports.pnl(user, query.workspaceId, query.from, query.to);
  }

  @Get('occupancy')
  occupancy(
    @CurrentUser() user: AuthUser,
    @Query() query: WorkspaceQueryDto,
  ) {
    return this.reports.occupancyTrend(user, query.workspaceId);
  }

  @Get('export')
  export(@CurrentUser() user: AuthUser, @Query() query: ExportQueryDto) {
    return this.reports.exportCsv(user, query.workspaceId, query.kind);
  }
}
