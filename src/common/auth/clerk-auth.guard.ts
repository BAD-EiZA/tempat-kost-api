/** Re-export for gradual rename; prefer JwtAuthGuard. */
export {
  JwtAuthGuard,
  JwtAuthGuard as ClerkAuthGuard,
  type AuthenticatedRequest,
} from './jwt-auth.guard';
