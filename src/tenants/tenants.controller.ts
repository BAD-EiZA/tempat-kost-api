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
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantDocumentsService } from './tenant-documents.service';
import { TenantsService } from './tenants.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

@Controller('v1/tenants')
@UseGuards(ClerkAuthGuard)
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly documents: TenantDocumentsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.tenants.list(user, query.workspaceId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tenants.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateTenantDto) {
    return this.tenants.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateTenantDto,
  ) {
    return this.tenants.update(user, id, body);
  }

  @Get(':id/documents')
  listDocs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.list(user, id);
  }

  @Post(':id/documents')
  addDoc(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      kind?: string;
      fileUrl: string;
      fileName?: string;
      runOcr?: boolean;
      base64?: string;
      mimeType?: string;
    },
  ) {
    return this.documents.create(user, { tenantId: id, ...body });
  }

  @Post('documents/:documentId/apply-ocr')
  applyOcr(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Body() body: { fields?: string[] },
  ) {
    return this.documents.applyOcr(user, documentId, body.fields);
  }
}
