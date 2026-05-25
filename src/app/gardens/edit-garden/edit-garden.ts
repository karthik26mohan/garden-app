import {
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { GardenService } from '../garden.service';

/**
 * "Edit garden" form. Lives at /app/gardens/:id/edit.
 *
 * Two-phase: first fetch the existing garden (async, may fail or be blocked
 * by RLS), then let the user edit. The template renders the right branch
 * for loading / not-found / form-ready states.
 *
 * Behind authGuard. RLS on update means we don't need to verify ownership
 * client-side — Postgres rejects the write if the row belongs to someone
 * else, and GardenService.update surfaces that as "Garden not found."
 *
 * Duplicated from new-garden by design — when we eventually have a third
 * use of this form, we'll extract a shared <GardenForm> with @Input for
 * initial values and @Output for submit (the rule-of-three refactor).
 */
@Component({
  selector: 'app-edit-garden',
  imports: [FormsModule, RouterLink],
  templateUrl: './edit-garden.html',
  styleUrl: './edit-garden.scss',
})
export class EditGarden implements OnInit {
  private gardenService = inject(GardenService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  // Public so the template can use it in [routerLink] expressions for
  // the back/cancel links.
  readonly id: string | null = this.route.snapshot.paramMap.get('id');

  // Phase-1 state: are we still loading the existing garden?
  loading = signal(true);
  notFound = signal(false);

  // Phase-2 state: form fields + save status.
  name = signal('');
  description = signal('');
  status = signal<'idle' | 'saving' | 'error'>('idle');
  errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    if (!this.id) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }

    try {
      const garden = await this.gardenService.get(this.id);
      if (!garden) {
        this.notFound.set(true);
      } else {
        // Pre-fill the form with current values.
        this.name.set(garden.name);
        this.description.set(garden.description ?? '');
      }
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to load garden.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  async submit(): Promise<void> {
    if (!this.id) return; // shouldn't happen — guarded by template too

    const trimmedName = this.name().trim();
    if (!trimmedName) {
      this.errorMessage.set('Name is required.');
      this.status.set('error');
      return;
    }

    this.status.set('saving');
    this.errorMessage.set(null);

    try {
      await this.gardenService.update(this.id, {
        name: trimmedName,
        description: this.description().trim() || undefined,
      });
      // Navigate back to the detail page so the user sees the updated row.
      this.router.navigateByUrl(`/app/gardens/${this.id}`);
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to save garden.',
      );
    }
  }
}
