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
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { OpsService } from './ops.service';

class WsQ {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

@Controller('v1/ops')
@UseGuards(ClerkAuthGuard)
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('packages')
  packages(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listPackages(u, q.workspaceId);
  }

  @Post('packages')
  createPackage(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      recipient: string;
      courier?: string;
      photoUrl?: string;
      notes?: string;
    },
  ) {
    return this.ops.createPackage(u, body);
  }

  @Post('packages/:id/pickup')
  pickup(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ops.pickupPackage(u, id);
  }

  @Get('guests')
  guests(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listGuests(u, q.workspaceId);
  }

  @Post('guests')
  createGuest(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      guestName: string;
      roomLabel?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    return this.ops.createGuest(u, body);
  }

  @Post('guests/:id/checkout')
  guestOut(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ops.checkoutGuest(u, id);
  }

  @Get('announcements')
  announcements(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listAnnouncements(u, q.workspaceId);
  }

  @Post('announcements')
  createAnn(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      title: string;
      body: string;
      publish?: boolean;
    },
  ) {
    return this.ops.createAnnouncement(u, body);
  }

  @Post('announcements/:id/publish')
  pubAnn(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ops.publishAnnouncement(u, id);
  }

  @Get('surveys')
  surveys(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listSurveys(u, q.workspaceId);
  }

  @Post('surveys')
  createSurvey(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      prospectId?: string;
      propertyId?: string;
      scheduledAt: string;
      staffNote?: string;
    },
  ) {
    return this.ops.createSurvey(u, body);
  }

  @Get('inspection-templates')
  templates(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listTemplates(u, q.workspaceId);
  }

  @Post('inspection-templates')
  createTemplate(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      name: string;
      kind?: string;
      items: Array<{ label: string; requiredPhoto?: boolean }>;
    },
  ) {
    return this.ops.createTemplate(u, body);
  }

  @Get('inspections')
  inspections(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listInspections(u, q.workspaceId);
  }

  @Post('inspections')
  createInspection(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      templateId?: string;
      propertyId?: string;
      roomId?: string;
      leaseId?: string;
      kind?: string;
      result?: object;
      notes?: string;
      complete?: boolean;
    },
  ) {
    return this.ops.createInspection(u, body);
  }

  @Get('approvals')
  approvals(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listApprovals(u, q.workspaceId);
  }

  @Post('approvals')
  requestApproval(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      kind: string;
      entityType: string;
      entityId: string;
      payload?: object;
      note?: string;
    },
  ) {
    return this.ops.requestApproval(u, body);
  }

  @Post('approvals/:id/decide')
  decide(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: 'approved' | 'rejected'; note?: string },
  ) {
    return this.ops.decideApproval(u, id, body.status, body.note);
  }

  @Get('feature-flags')
  flags(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listFlags(u, q.workspaceId);
  }

  @Post('feature-flags')
  setFlag(
    @CurrentUser() u: AuthUser,
    @Body() body: { workspaceId: string; key: string; enabled: boolean },
  ) {
    return this.ops.setFlag(u, body);
  }

  @Get('recurring-expenses')
  recurring(@CurrentUser() u: AuthUser, @Query() q: WsQ) {
    return this.ops.listRecurring(u, q.workspaceId);
  }

  @Post('recurring-expenses')
  createRecurring(
    @CurrentUser() u: AuthUser,
    @Body()
    body: {
      workspaceId: string;
      category: string;
      amount: number;
      frequency?: string;
      nextDate: string;
      vendor?: string;
      description?: string;
      propertyId?: string;
    },
  ) {
    return this.ops.createRecurring(u, body);
  }
}
