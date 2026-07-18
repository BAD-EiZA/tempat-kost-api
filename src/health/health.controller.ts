import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  async health() {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      service: 'tempat-kost-api',
      db,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get()
  root() {
    return {
      name: 'Tempat Kost API',
      version: 'v1',
      docs: '/docs',
    };
  }
}
