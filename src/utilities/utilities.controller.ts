import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { CreateUtilityPolicyDto } from './dto/create-utility-policy.dto';
import { UtilitiesService } from './utilities.service';

class ListPoliciesQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;
}

class CalculateDto {
  @IsString()
  @IsNotEmpty()
  payerType!: string;

  @IsString()
  @IsNotEmpty()
  billingMethod!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  consumption!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ratePerUnit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fixedMonthlyFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ownerUnitAllowance?: number;
}

@Controller('v1/utilities')
@UseGuards(ClerkAuthGuard)
export class UtilitiesController {
  constructor(private readonly utilities: UtilitiesService) {}

  @Get('policies')
  listPolicies(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPoliciesQueryDto,
  ) {
    return this.utilities.listPolicies(
      user,
      query.workspaceId,
      query.propertyId,
    );
  }

  @Post('policies')
  createPolicy(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateUtilityPolicyDto,
  ) {
    return this.utilities.createPolicy(user, body);
  }

  @Post('calculate')
  calculate(@Body() body: CalculateDto) {
    const result = this.utilities.calculateCharge(body);
    return {
      tenantCharge: result.tenantCharge.toFixed(2),
      ownerCost: result.ownerCost.toFixed(2),
      billableUnits: result.billableUnits.toFixed(4),
    };
  }

  @Post('bills/from-reading')
  fromReading(
    @CurrentUser() user: AuthUser,
    @Body() body: { readingId: string; leaseId?: string },
  ) {
    return this.utilities.generateBillFromReading(user, body);
  }
}
