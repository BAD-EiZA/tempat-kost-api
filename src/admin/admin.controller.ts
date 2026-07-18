import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../common/auth/public.decorator';
import { AdminService } from './admin.service';

class ExtendDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  days!: number;
}

@Controller('v1/admin')
@Public()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private guard(secret?: string) {
    this.admin.assertAdminSecret(secret);
  }

  @Get('overview')
  overview(@Headers('x-internal-secret') secret?: string) {
    this.guard(secret);
    return this.admin.overview();
  }

  @Get('workspaces')
  workspaces(@Headers('x-internal-secret') secret?: string) {
    this.guard(secret);
    return this.admin.listWorkspaces();
  }

  @Post('extend-trial')
  extend(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: ExtendDto,
  ) {
    this.guard(secret);
    return this.admin.extendTrial(body.workspaceId, body.days);
  }

  @Post('workspaces/:id/suspend')
  suspend(
    @Headers('x-internal-secret') secret: string | undefined,
    @Param('id') id: string,
  ) {
    this.guard(secret);
    return this.admin.suspend(id);
  }
}
