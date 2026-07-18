import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Request } from 'express';
import type { AuthUser } from './auth.types';

export type AuthenticatedRequest = Request & { authUser?: AuthUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly config: ConfigService) {}

  private getJwks() {
    if (!this.jwks) {
      const issuer = this.config
        .getOrThrow<string>('KINDE_ISSUER_URL')
        .replace(/\/$/, '');
      this.jwks = createRemoteJWKSet(
        new URL(`${issuer}/.well-known/jwks.json`),
      );
    }
    return this.jwks;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Empty bearer token');
    }

    try {
      const issuer = this.config
        .getOrThrow<string>('KINDE_ISSUER_URL')
        .replace(/\/$/, '');
      const audience = this.config.get<string>('KINDE_AUDIENCE');

      const { payload } = await jwtVerify(token, this.getJwks(), {
        issuer,
        ...(audience ? { audience } : {}),
      });

      if (!payload.sub) {
        throw new UnauthorizedException('Token missing sub');
      }

      const email =
        typeof payload.email === 'string'
          ? payload.email
          : typeof payload['https://kinde.com/email'] === 'string'
            ? (payload['https://kinde.com/email'] as string)
            : undefined;

      req.authUser = {
        externalUserId: payload.sub,
        sessionId:
          typeof payload.sid === 'string' ? payload.sid : undefined,
        email,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
