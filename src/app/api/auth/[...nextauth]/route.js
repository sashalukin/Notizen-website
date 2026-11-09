import { handlers } from '@/lib/auth';
import { withCleverPortalRecovery } from '@/lib/clever-portal-recovery.mjs';

export const GET = withCleverPortalRecovery(handlers.GET);
export const POST = handlers.POST;
