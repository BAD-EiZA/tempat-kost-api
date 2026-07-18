import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { Public } from '../common/auth/public.decorator';
import { ContractsService } from './contracts.service';

class GenerateDto {
  @IsString()
  @IsNotEmpty()
  leaseId!: string;
}

class SignDto {
  @IsString()
  @IsNotEmpty()
  signerName!: string;

  @IsString()
  @IsNotEmpty()
  signatureData!: string;
}

@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @UseGuards(ClerkAuthGuard)
  @Post('v1/contracts/generate')
  generate(@CurrentUser() user: AuthUser, @Body() body: GenerateDto) {
    return this.contracts.generate(user, body.leaseId);
  }

  @UseGuards(ClerkAuthGuard)
  @Get('v1/contracts')
  list(@CurrentUser() user: AuthUser, @Query('leaseId') leaseId: string) {
    return this.contracts.listByLease(user, leaseId);
  }

  @UseGuards(ClerkAuthGuard)
  @Get('v1/contracts/:id/pdf')
  pdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contracts.pdfBase64(user, id);
  }

  @UseGuards(ClerkAuthGuard)
  @Post('v1/contracts/:id/void')
  void(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.contracts.void(user, id, body.reason);
  }

  @UseGuards(ClerkAuthGuard)
  @Post('v1/contracts/:id/owner-sign')
  ownerSign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { ownerName: string },
  ) {
    return this.contracts.ownerCountersign(user, id, body);
  }

  @UseGuards(ClerkAuthGuard)
  @Get('v1/portal/contracts/:id/pdf')
  portalPdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
  ) {
    return this.contracts.pdfForTenant(user, id, tenantId);
  }

  @Public()
  @Get('v1/public/sign/:token')
  publicGet(@Param('token') token: string) {
    return this.contracts.getPublicByToken(token);
  }

  @Public()
  @Post('v1/public/sign/:token')
  publicSign(@Param('token') token: string, @Body() body: SignDto) {
    return this.contracts.signByToken(token, body);
  }
}
