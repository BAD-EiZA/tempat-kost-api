import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../common/auth/clerk-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { AuthUser } from '../common/auth/auth.types';
import { AuthService } from './auth.service';

@Controller('v1/auth')
@UseGuards(ClerkAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return this.authService.getOrCreateMe(user);
  }
}
