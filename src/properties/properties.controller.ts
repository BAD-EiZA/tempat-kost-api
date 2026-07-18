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
import { IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertiesService } from './properties.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

@Controller('v1/properties')
@UseGuards(ClerkAuthGuard)
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.properties.list(user, query.workspaceId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.properties.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreatePropertyDto) {
    return this.properties.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdatePropertyDto,
  ) {
    return this.properties.update(user, id, body);
  }

  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.properties.archive(user, id);
  }
}
