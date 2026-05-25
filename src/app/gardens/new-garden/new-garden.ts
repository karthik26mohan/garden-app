import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { GardenService } from '../garden.service';

/**
 * "New garden" form. Lives at /app/gardens/new.
 *
 * Two fields for MVP: name (required) + description (optional). Position
 * and size are intentionally deferred to a separate chunk — new rows get
 * the database defaults (position 0,0, size 10x20 ft) and the user drags
 * them into place in the SVG editor (see DECISIONS.md Entry #11).
 *
 * Behind authGuard, so getUser() in GardenService.create will always succeed
 * once we reach the submit handler.
 */
@Component({
  selector: 'app-new-garden',
  imports: [FormsModule, RouterLink],
  templateUrl: './new-garden.html',
  styleUrl: './new-garden.scss',
})
export class NewGarden {
  private gardenService = inject(GardenService);
  private router = inject(Router);

  // Match the signal-driven form style used in the login page.
  name = signal('');
  description = signal('');
  status = signal<'idle' | 'saving' | 'error'>('idle');
  errorMessage = signal<string | null>(null);

  async submit(): Promise<void> {
    const trimmedName = this.name().trim();
    if (!trimmedName) {
      // The required attribute on the input handles this in the happy path;
      // this guards against form submission via Enter on edge browsers.
      this.errorMessage.set('Name is required.');
      this.status.set('error');
      return;
    }

    this.status.set('saving');
    this.errorMessage.set(null);

    try {
      await this.gardenService.create({
        name: trimmedName,
        description: this.description().trim() || undefined,
        // Position/size deliberately omitted — DB defaults to (0, 0) at
        // size 10x20 ft. User drags into place in the editor afterward.
      });
      this.router.navigateByUrl('/app/gardens');
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to create garden.',
      );
    }
  }
}
