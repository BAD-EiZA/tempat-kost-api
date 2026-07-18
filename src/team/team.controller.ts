import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { RolesService } from './roles.service';
import { TeamService } from './team.service';

class WsQuery {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class InviteDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  roleKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  propertyIds?: string[];
}

class AcceptDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

class AccessDto {
  @IsString()
  @IsNotEmpty()
  memberId!: string;

  @IsArray()
  @IsString({ each: true })
  propertyIds!: string[];
}

class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  permissions!: Array<{ resource: string; action: string }>;
}

class SetPermDto {
  @IsArray()
  permissions!: Array<{ resource: string; action: string }>;
}

@Controller('v1/team')
@UseGuards(ClerkAuthGuard)
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly roles: RolesService,
  ) {}

  @Get('members')
  members(@CurrentUser() user: AuthUser, @Query() q: WsQuery) {
    return this.team.listMembers(user, q.workspaceId);
  }

  @Get('roles')
  listRoles(@CurrentUser() user: AuthUser, @Query() q: WsQuery) {
    return this.roles.list(user, q.workspaceId);
  }

  @Get('roles/catalog')
  catalog() {
    return this.roles.catalog();
  }

  @Post('roles')
  createRole(@CurrentUser() user: AuthUser, @Body() body: CreateRoleDto) {
    return this.roles.createCustom(user, body);
  }

  @Put('roles/:id/permissions')
  setPerms(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SetPermDto,
  ) {
    return this.roles.setPermissions(user, id, body.permissions);
  }

  @Get('invitations')
  invitations(@CurrentUser() user: AuthUser, @Query() q: WsQuery) {
    return this.team.listInvitations(user, q.workspaceId);
  }

  @Post('invitations')
  invite(@CurrentUser() user: AuthUser, @Body() body: InviteDto) {
    return this.team.invite(user, {
      workspaceId: body.workspaceId,
      email: body.email,
      roleKey: body.roleKey ?? 'manager',
      propertyIds: body.propertyIds,
    });
  }

  @Post('invitations/accept')
  accept(@CurrentUser() user: AuthUser, @Body() body: AcceptDto) {
    return this.team.acceptByToken(user, body.token);
  }

  @Post('property-access')
  access(@CurrentUser() user: AuthUser, @Body() body: AccessDto) {
    return this.team.setPropertyAccess(user, body);
  }
}
