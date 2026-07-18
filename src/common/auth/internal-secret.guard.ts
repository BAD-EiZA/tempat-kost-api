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
    const secret =
      req.headers['x-cron-secret'] ?? req.headers['x-internal-secret'];
    const expectedCron = this.config.getOrThrow<string>('CRON_SECRET');
    const expectedInternal = this.config.getOrThrow<string>(
      'INTERNAL_API_SECRET',
    );
    if (secret === expectedCron || secret === expectedInternal) {
      return true;
    }
    throw new UnauthorizedException('Invalid internal secret');
  }
}
