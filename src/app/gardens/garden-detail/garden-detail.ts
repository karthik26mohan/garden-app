import {
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Garden, GardenService } from '../garden.service';
import { Plant, PlantService } from '../plant.service';

/**
 * Garden detail page. Lives at /app/gardens/:id.
 *
 * Behind authGuard. Fetches the garden + its plants (eager-loaded via
 * GardenService.get's nested select). If RLS hides it or the garden
 * genuinely doesn't exist, we render a "not found" message —
 * indistinguishable from the caller's side, which is the intended
 * privacy property.
 *
 * Plant management lives on this page (rather than a separate /plants
 * route or as a click-on-garden interaction in the editor) because
 * plants are conceptually nested in gardens. The URL hierarchy
 * /app/gardens/:id mirrors the data hierarchy.
 *
 * Yard map vs detail page sync: the yard map fetches gardens on mount
 * in its parent (Gardens component). Adding/deleting plants here
 * doesn't auto-refresh the yard map — user navigates back and the
 * yard map re-fetches.
 */
@Component({
  selector: 'app-garden-detail',
  imports: [RouterLink, DatePipe, FormsModule],
  templateUrl: './garden-detail.html',
  styleUrl: './garden-detail.scss',
})
export class GardenDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private gardenService = inject(GardenService);
  private plantService = inject(PlantService);
  private platformId = inject(PLATFORM_ID);

  // The :id segment from the URL. snapshot is fine — Angular remounts this
  // component when you navigate to a different garden. Public so the
  // template can build the Edit link with [routerLink].
  readonly id: string | null = this.route.snapshot.paramMap.get('id');

  garden = signal<Garden | null>(null);
  plants = signal<Plant[]>([]);
  loading = signal(true);
  deleting = signal(false);
  errorMessage = signal<string | null>(null);

  // Add-plant form state.
  newPlantName = signal('');
  newPlantDiameter = signal(1);
  addingPlant = signal(false);

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
      // garden.plants is populated by the eager-loading select in get().
      // Default to empty if for some reason it's missing.
      this.plants.set(garden?.plants ?? []);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to load garden.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Delete this garden after a confirm prompt. Browser confirm() is a
   * deliberate MVP choice — accessible, blocking, free — to swap for a
   * custom modal later if we want better styling.
   */
  async onDelete(): Promise<void> {
    if (!this.id) return;

    const name = this.garden()?.name ?? 'this garden';
    const ok = window.confirm(`Delete "${name}"? This cannot be undone.`);
    if (!ok) return;

    this.deleting.set(true);
    try {
      await this.gardenService.delete(this.id);
      this.router.navigateByUrl('/app/gardens');
    } catch (err) {
      this.deleting.set(false);
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to delete garden.',
      );
    }
  }

  /**
   * Create a plant in this garden. Defaults position to the center of
   * the garden so the plant is visible inside the rectangle. Multiple
   * plants stack at center until the user drags them apart in the yard
   * map editor.
   */
  async onAddPlant(): Promise<void> {
    if (!this.id) return;
    const garden = this.garden();
    if (!garden) return;

    const name = this.newPlantName().trim();
    if (!name) return;

    this.addingPlant.set(true);
    this.errorMessage.set(null);

    try {
      const created = await this.plantService.create({
        garden_id: this.id,
        common_name: name,
        diameter_ft: this.newPlantDiameter(),
        position_x_ft: garden.width_ft / 2,
        position_y_ft: garden.height_ft / 2,
      });
      this.plants.update((list) => [...list, created]);
      // Reset form for the next plant.
      this.newPlantName.set('');
      this.newPlantDiameter.set(1);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to add plant.',
      );
    } finally {
      this.addingPlant.set(false);
    }
  }

  /**
   * Remove a plant after a confirm prompt. Same UX shape as delete-garden.
   */
  async onDeletePlant(plant: Plant): Promise<void> {
    const label = plant.common_name ?? 'this plant';
    const ok = window.confirm(`Remove "${label}"?`);
    if (!ok) return;

    try {
      await this.plantService.delete(plant.id);
      this.plants.update((list) => list.filter((p) => p.id !== plant.id));
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to remove plant.',
      );
    }
  }
}
