import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UtilityBillingMethod, UtilityPayerType } from '@prisma/client';

export class CreateUtilityPolicyDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsOptional()
  @IsString()
  utilityType?: string;

  @IsEnum(UtilityPayerType)
  payerType!: UtilityPayerType;

  @IsEnum(UtilityBillingMethod)
  billingMethod!: UtilityBillingMethod;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  ratePerUnit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fixedMonthlyFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  ownerUnitAllowance?: number;
}
