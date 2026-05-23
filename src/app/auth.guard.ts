import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from './supabase.service';

/**
 * Route guard that requires an authenticated Supabase session.
 *
 * Behavior:
 *   - No session     → redirect to /login?next=<originally-requested-url>
 *                      so the user lands on the right page after sign-in.
 *   - Session exists → allow navigation.
 *
 * SSR note: Supabase stores its session in localStorage, which doesn't exist
 * on the server. If we ran the session check during SSR, every prerendered
 * /app/* page would be a redirect to /login. Instead we let the navigation
 * through on the server (so the page shell prerenders), and the client-side
 * component re-verifies the session on hydration. The guard is a sign-in
 * convenience, not the authorization wall — RLS in Postgres is the wall.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) return true;

  const supabase = inject(SupabaseService);
  const router = inject(Router);

  const {
    data: { session },
  } = await supabase.client.auth.getSession();

  if (session) return true;

  return router.createUrlTree(['/login'], {
    queryParams: { next: state.url },
  });
};
