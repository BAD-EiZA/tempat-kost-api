import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Inject } from '@nestjs/common';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { STORAGE_PORT } from '../common/ports/storage.port';
import type { StoragePort } from '../common/ports/storage.port';
import { WorkspacesService } from '../workspaces/workspaces.service';

class SignedUploadDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  folder!: string;

  @IsOptional()
  @IsString()
  publicId?: string;
}

@Controller('v1/files')
@UseGuards(ClerkAuthGuard)
export class FilesController {
  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Post('signed-upload')
  async signedUpload(
    @CurrentUser() user: AuthUser,
    @Body() body: SignedUploadDto,
  ) {
    await this.workspaces.assertMember(user, body.workspaceId);
    return this.storage.createSignedUpload({
      workspaceId: body.workspaceId,
      folder: body.folder,
      publicId: body.publicId,
    });
  }
}
