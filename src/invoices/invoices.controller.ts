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
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';

class WorkspaceQueryDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}

class FromLeaseDto {
  @IsString()
  @IsNotEmpty()
  leaseId!: string;
}

@Controller('v1/invoices')
@UseGuards(ClerkAuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: WorkspaceQueryDto) {
    return this.invoices.list(user, query.workspaceId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateInvoiceDto) {
    return this.invoices.create(user, body);
  }

  @Post('from-lease')
  fromLease(@CurrentUser() user: AuthUser, @Body() body: FromLeaseDto) {
    return this.invoices.createFromLease(user, body.leaseId);
  }

  @Post(':id/issue')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.issue(user, id);
  }

  @Post(':id/void')
  void(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.void(user, id);
  }

  @Post(':id/adjust')
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { description: string; amount: number },
  ) {
    return this.invoices.addAdjustment(user, id, body);
  }

  @Post(':id/late-fee')
  lateFee(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { percent?: number },
  ) {
    return this.invoices.applyLateFee(user, id, body?.percent);
  }

  @Post(':id/mark-overdue')
  overdue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.markOverdue(user, id);
  }
}
