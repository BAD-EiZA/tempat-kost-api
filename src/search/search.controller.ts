import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { SearchService } from './search.service';

class SmartSearchDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  query!: string;
}

@Controller('v1/search')
@UseGuards(ClerkAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post('smart')
  smart(@CurrentUser() user: AuthUser, @Body() body: SmartSearchDto) {
    return this.search.smartSearch(user, body.workspaceId, body.query);
  }
}
