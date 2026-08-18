import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import type { AdminRequest } from './admin-auth.guard';

// Injects the admin user attached by AdminAuthGuard: `@CurrentAdmin() admin: User`
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    return request.adminUser;
  },
);
