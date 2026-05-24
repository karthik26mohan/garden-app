import {
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Garden, GardenService } from '../garden.service';

/**
 * Garden detail page. Lives at /app/gardens/:id.
 *
 * Behind authGuard. Fetches the single garden by id. If RLS hides it (the
 * id belongs to another user) or it genuinely doesn't exist, we render a
 * "not found" message — indistinguishable from the caller's side, which is
 * the intended privacy property.
 *
 * Inline template for now because the content is small. We'll split into
 * .html/.scss if it grows beyond comfortable inline size.
 */
@Component({
  selector: 'app-garden-detail',
  imports: [RouterLink, DatePipe],
  template: `
    <main class="container">
      <nav class="garden-detail__breadcrumb">
        <a routerLink="/app/gardens">← Back to gardens</a>
      </nav>

      @if (loading()) {
        <p>Loading…</p>
      } @else if (errorMessage()) {
        <p class="garden-detail__error">{{ errorMessage() }}</p>
      } @else if (!garden()) {
        <h1>Garden not found</h1>
        <p>
          Either it doesn't exist or it belongs to a different account.
          <a routerLink="/app/gardens">Back to your gardens</a>.
        </p>
      } @else {
        <h1>{{ garden()!.name }}</h1>
        @if (garden()!.description) {
          <p>{{ garden()!.description }}</p>
        }
        <p class="garden-detail__meta">
          Created {{ garden()!.created_at | date: 'mediumDate' }}
        </p>
      }
    </main>
  `,
  styles: `
    .garden-detail__breadcrumb {
      margin-bottom: 1rem;

      a {
        font-size: 0.875rem;
        color: var(--text-muted);
        text-decoration: none;

        &:hover { color: var(--accent); }
      }
    }
    .garden-detail__error {
      color: var(--danger);
    }
    .garden-detail__meta {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
  `,
})
export class GardenDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private gardenService = inject(GardenService);
  private platformId = inject(PLATFORM_ID);

  // The :id segment from the URL. snapshot is fine — Angular remounts this
  // component when you navigate to a different garden.
  private id = this.route.snapshot.paramMap.get('id');

  garden = signal<Garden | null>(null);
  loading = signal(true);
  errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    if (!this.id) {
      this.errorMessage.set('No garden id in URL.');
      this.loading.set(false);
      return;
    }

    try {
      const garden = await this.gardenService.get(this.id);
      this.garden.set(garden);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to load garden.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
