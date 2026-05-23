import { Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../supabase.service';

/**
 * Handles the redirect after the user clicks the magic-link email.
 * Two URL shapes possible:
 *   1. PKCE:     /auth/callback?code=<ONE-TIME-CODE>&next=<...>
 *   2. Implicit: /auth/callback#access_token=...&refresh_token=...
 *
 * For PKCE we exchange the code for a session. For implicit, the Supabase
 * client auto-processes the URL hash on page load — we just verify a session
 * exists. Either way, we then navigate to ?next or /app/gardens by default.
 *
 * Skipped on the server — both flows need localStorage.
 */
@Component({
  selector: 'app-auth-callback',
  template: `<main class="container"><p>Signing you in…</p></main>`,
})
export class AuthCallback implements OnInit {
  private supabase = inject(SupabaseService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const code = this.route.snapshot.queryParamMap.get('code');
    const next =
      this.route.snapshot.queryParamMap.get('next') ?? '/app/gardens';

    // Flow 1 (PKCE): Supabase returned `?code=...` in the query string.
    // Trade the code for a session token.
    if (code) {
      const { error } = await this.supabase.client.auth.exchangeCodeForSession(
        code,
      );

      if (error) {
        this.router.navigate(['/login'], {
          queryParams: { message: error.message },
        });
        return;
      }
    }

    // Flow 2 (implicit): Supabase returned `#access_token=...` in the URL hash.
    // The Supabase client auto-detects the hash on page load and stores the
    // session itself — we just need to check that it landed.
    const {
      data: { session },
    } = await this.supabase.client.auth.getSession();

    if (session) {
      this.router.navigateByUrl(next);
      return;
    }

    this.router.navigate(['/login'], {
      queryParams: { message: 'Missing or expired link.' },
    });
  }
}
