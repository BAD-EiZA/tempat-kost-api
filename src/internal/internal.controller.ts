import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalSecretGuard } from '../common/auth/internal-secret.guard';
import { Public } from '../common/auth/public.decorator';

@Controller('v1/internal')
export class InternalController {
  @Public()
  @UseGuards(InternalSecretGuard)
  @Get('cron/ping')
  cronPing() {
    return {
      ok: true,
      job: 'ping',
      at: new Date().toISOString(),
    };
  }
}
