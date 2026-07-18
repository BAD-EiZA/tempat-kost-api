import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const expectedCron = this.config.getOrThrow<string>('CRON_SECRET');
    const expectedInternal = this.config.getOrThrow<string>(
      'INTERNAL_API_SECRET',
    );

    const headerSecret =
      req.headers['x-cron-secret'] ?? req.headers['x-internal-secret'];
    // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET env set
    const auth = req.headers.authorization;
    const bearer =
      typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice(7)
        : undefined;

    const secret = headerSecret ?? bearer;
    if (secret === expectedCron || secret === expectedInternal) {
      return true;
    }
    throw new UnauthorizedException('Invalid internal secret');
  }
}
