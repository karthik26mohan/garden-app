import {
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../supabase.service';
import { Garden, GardenService } from './garden.service';

/**
 * Garden list page. Lives at /app/gardens.
 *
 * Behind authGuard, so we can assume a signed-in user when this loads in
 * the browser. RLS filters the query to only this user's rows, so the
 * service call has no explicit user_id filter.
 *
 * Skipped on the server — Supabase needs localStorage to know which user
 * is signed in. The page shell prerenders showing the loading state, then
 * the real fetch happens on hydration.
 */
@Component({
  selector: 'app-gardens',
  imports: [RouterLink, DatePipe],
  templateUrl: './gardens.html',
  styleUrl: './gardens.scss',
})
export class Gardens implements OnInit {
  private supabase = inject(SupabaseService);
  private gardenService = inject(GardenService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  // Signals because the app is zoneless — change detection only re-renders
  // when a signal it depends on changes.
  email = signal<string | null>(null);
  gardens = signal<Garden[]>([]);
  loading = signal(true);
  errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      // SSR: render the loading shell, defer the real fetch to hydration.
      return;
    }

    try {
      const [userResult, gardens] = await Promise.all([
        this.supabase.client.auth.getUser(),
        this.gardenService.list(),
      ]);

      this.email.set(userResult.data.user?.email ?? null);
      this.gardens.set(gardens);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to load gardens.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  async signOut(): Promise<void> {
    await this.supabase.client.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
