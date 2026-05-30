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
import { YardMap } from './yard-map/yard-map';

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
  imports: [RouterLink, DatePipe, YardMap],
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

  /**
   * Yard-map emitted a box-change (drag-end or resize-end). Optimistically
   * update our local gardens signal so the rect doesn't visually snap back
   * while the DB write is in flight, then persist via the service. If the
   * network call fails, revert and surface the error.
   */
  async onBoxChange(e: {
    gardenId: string;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
  }): Promise<void> {
    const previous = this.gardens();

    this.gardens.update((list) =>
      list.map((g) =>
        g.id === e.gardenId
          ? {
              ...g,
              position_x_ft: e.positionX,
              position_y_ft: e.positionY,
              width_ft: e.width,
              height_ft: e.height,
            }
          : g,
      ),
    );

    try {
      await this.gardenService.updateBox(
        e.gardenId,
        e.positionX,
        e.positionY,
        e.width,
        e.height,
      );
    } catch (err) {
      // Revert the optimistic update.
      this.gardens.set(previous);
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to save garden.',
      );
    }
  }
}
