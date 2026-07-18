import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { AiService } from './ai.service';

class WorkspaceBody {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class ExpenseCatDto extends WorkspaceBody {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;
}

class CommDraftDto extends WorkspaceBody {
  @IsString()
  @IsNotEmpty()
  purpose!: string;

  @IsString()
  @IsNotEmpty()
  audience!: string;

  @IsObject()
  context!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  tone!: string;

  @IsString()
  @IsNotEmpty()
  channel!: string;
}

class TriageDto extends WorkspaceBody {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsString()
  categoryHint?: string;
}

class ProofDto extends WorkspaceBody {
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  base64?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expectedAmount?: number;

  @IsOptional()
  @IsString()
  manualReference?: string;
}

class SearchDto extends WorkspaceBody {
  @IsString()
  @IsNotEmpty()
  query!: string;

  @IsArray()
  @IsString({ each: true })
  allowedEntities!: string[];
}

@Controller('v1/ai')
@UseGuards(ClerkAuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('expense-categorization')
  expense(@CurrentUser() user: AuthUser, @Body() body: ExpenseCatDto) {
    return this.ai.categorizeExpense(user, body);
  }

  @Post('communication-draft')
  comm(@CurrentUser() user: AuthUser, @Body() body: CommDraftDto) {
    return this.ai.draftCommunication(user, body);
  }

  @Post('maintenance-triage')
  triage(@CurrentUser() user: AuthUser, @Body() body: TriageDto) {
    return this.ai.triageMaintenance(user, body);
  }

  @Post('payment-proof-extraction')
  proof(@CurrentUser() user: AuthUser, @Body() body: ProofDto) {
    return this.ai.extractPaymentProof(user, body);
  }

  @Post('smart-search')
  search(@CurrentUser() user: AuthUser, @Body() body: SearchDto) {
    return this.ai.smartSearch(user, body);
  }

  @Post('identity-extraction')
  identity(@CurrentUser() user: AuthUser, @Body() body: ProofDto) {
    return this.ai.extractIdentity(user, body);
  }

  @Post('damage-analysis')
  damage(
    @CurrentUser() user: AuthUser,
    @Body()
    body: WorkspaceBody & { imageUrls: string[]; description?: string },
  ) {
    return this.ai.analyzeDamage(user, body);
  }

  @Post('repair-estimate')
  repair(
    @CurrentUser() user: AuthUser,
    @Body()
    body: WorkspaceBody & { description: string; imageUrls?: string[] },
  ) {
    return this.ai.estimateRepair(user, body);
  }

  @Get('jobs/:id')
  async job(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const job = await this.ai.getJob(user, id);
    if (!job) throw new NotFoundException();
    return job;
  }

  @Post('jobs/:id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.confirm(user, id);
  }

  @Post('jobs/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ai.reject(user, id);
  }
}
