import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DepositTxnType } from '@prisma/client';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { DepositsService } from './deposits.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class RecordDepositDto {
  @IsString()
  @IsNotEmpty()
  depositAccountId!: string;

  @IsEnum(DepositTxnType)
  type!: DepositTxnType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('v1/deposits')
@UseGuards(ClerkAuthGuard)
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.deposits.list(user, query.workspaceId);
  }

  @Post('transactions')
  record(@CurrentUser() user: AuthUser, @Body() body: RecordDepositDto) {
    return this.deposits.record(user, body);
  }

  @Post('settle')
  settle(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      depositAccountId: string;
      damageAmount?: number;
      damageReason?: string;
      refundAmount?: number;
      requireApproval?: boolean;
    },
  ) {
    return this.deposits.settleCheckout(user, body);
  }
}
