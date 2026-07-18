import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { Public } from '../common/auth/public.decorator';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { PublicService } from './public.service';

class PublishDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  @IsString()
  @IsNotEmpty()
  slug!: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  startingPrice?: number;

  @IsOptional()
  @IsString()
  brandColor?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

@Controller()
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly workspaces: WorkspacesService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('v1/public/properties/:slug')
  bySlug(@Param('slug') slug: string) {
    return this.publicService.getBySlug(slug);
  }

  @Public()
  @Post('v1/public/properties/:slug/book')
  book(
    @Param('slug') slug: string,
    @Body()
    body: {
      roomId: string;
      fullName: string;
      phone: string;
      email?: string;
      holdDays?: number;
      feeAmount?: number;
      notes?: string;
    },
  ) {
    return this.publicService.createPublicBooking({ slug, ...body });
  }

  @UseGuards(ClerkAuthGuard)
  @Post('v1/properties/publish')
  async publish(@CurrentUser() user: AuthUser, @Body() body: PublishDto) {
    const property = await this.prisma.property.findUnique({
      where: { id: body.propertyId },
    });
    if (!property) return { error: 'not found' };
    await this.workspaces.assertMember(user, property.workspaceId);
    return this.publicService.publish(body.propertyId, body);
  }
}
