import { Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Garden, GardenService } from '../garden.service';
import { Plant, PlantService } from '../plant.service';
import { Species, SpeciesService } from '../species.service';
import { PhotoService } from '../photo.service';
import { IdentificationResult, IdentifyPlant } from '../identify-plant/identify-plant';

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
  imports: [RouterLink, DatePipe, FormsModule, IdentifyPlant],
  templateUrl: './garden-detail.html',
  styleUrl: './garden-detail.scss',
})
export class GardenDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private gardenService = inject(GardenService);
  private plantService = inject(PlantService);
  private speciesService = inject(SpeciesService);
  private photoService = inject(PhotoService);
  private platformId = inject(PLATFORM_ID);

  // The :id segment from the URL. snapshot is fine — Angular remounts this
  // component when you navigate to a different garden. Public so the
  // template can build the Edit link with [routerLink].
  readonly id: string | null = this.route.snapshot.paramMap.get('id');

  garden = signal<Garden | null>(null);
  plants = signal<Plant[]>([]);
  // All species owned by the user — feeds the autocomplete <datalist>.
  // Updated optimistically when ensureByName returns a new species.
  allSpecies = signal<Species[]>([]);
  loading = signal(true);
  deleting = signal(false);
  errorMessage = signal<string | null>(null);

  // plant_id → signed thumbnail URL for primary photos. Best-effort:
  // empty when photos don't exist or the signed-URL fetch failed.
  photoUrls = signal<Record<string, string>>({});
  // Non-fatal photo-save failure message, separate from errorMessage so
  // a photo hiccup doesn't read like the plant failed.
  photoWarning = signal<string | null>(null);

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
      // Fetch garden+plants+species AND the species list in parallel.
      // The species list is for the autocomplete dropdown; it's separate
      // from the embedded species on plants (which only includes species
      // for plants in THIS garden, not species used elsewhere).
      const [garden, allSpecies] = await Promise.all([
        this.gardenService.get(this.id),
        this.speciesService.list(),
      ]);
      this.garden.set(garden);
      this.plants.set(garden?.plants ?? []);
      // Thumbnails load after the page renders; failures leave the map empty.
      void this.loadPhotoUrls(garden?.plants?.map((p) => p.id) ?? []);
      this.allSpecies.set(allSpecies);
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to load garden.');
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
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to delete garden.');
    }
  }

  /**
   * Create a plant in this garden. Two-step flow:
   *   1. SpeciesService.ensureByName resolves the typed name into a
   *      species_id (finds existing or creates with next display_number).
   *   2. PlantService.create inserts the plant with that species_id.
   *
   * After insert, we attach the species to the plant for local state
   * (so the UI renders the name immediately) and, if the species was
   * new, append it to allSpecies so the autocomplete dropdown updates.
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
      // Step 1: resolve the typed name to a species (existing or new).
      const species = await this.speciesService.ensureByName(name);

      // Step 2: create the plant with the species_id.
      const created = await this.plantService.create({
        garden_id: this.id,
        species_id: species.id,
        diameter_ft: this.newPlantDiameter(),
        position_x_ft: garden.width_ft / 2,
        position_y_ft: garden.height_ft / 2,
      });

      // Attach the species so the UI can render the name without
      // refetching. The Supabase insert returns the plant row but
      // doesn't auto-embed the relation.
      const plantWithSpecies: Plant = { ...created, species };
      this.plants.update((list) => [...list, plantWithSpecies]);

      // If this is a brand-new species, add it to the autocomplete list
      // so the dropdown picks it up immediately.
      this.allSpecies.update((list) =>
        list.find((s) => s.id === species.id) ? list : [...list, species],
      );

      // Reset form for the next plant.
      this.newPlantName.set('');
      this.newPlantDiameter.set(1);
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to add plant.');
    } finally {
      this.addingPlant.set(false);
    }
  }

  private async loadPhotoUrls(plantIds: string[]): Promise<void> {
    this.photoUrls.set(await this.photoService.getPrimaryPhotoUrls(plantIds));
  }

  /**
   * Persist a confirmed photo identification. Mirrors onAddPlant's
   * two-step species→plant flow, with two additions: the species comes
   * from the identification (Perenual-enriched), and the photo is
   * uploaded afterward. Photo failure is NON-fatal by design (spec
   * section 5): the identified plant is the valuable part.
   */
  async onIdentified(result: IdentificationResult): Promise<void> {
    if (!this.id) return;
    const garden = this.garden();
    if (!garden) return;

    this.addingPlant.set(true);
    this.errorMessage.set(null);
    this.photoWarning.set(null);

    try {
      const species = await this.speciesService.ensureByIdentification(result.candidate);

      const created = await this.plantService.create({
        garden_id: this.id,
        species_id: species.id,
        diameter_ft: this.newPlantDiameter(),
        position_x_ft: garden.width_ft / 2,
        position_y_ft: garden.height_ft / 2,
        plantnet_score: result.candidate.score,
      });

      this.plants.update((list) => [...list, { ...created, species }]);
      this.allSpecies.update((list) =>
        list.find((s) => s.id === species.id) ? list : [...list, species],
      );

      try {
        await this.photoService.uploadPlantPhoto(created.id, result.photo);
        await this.loadPhotoUrls(this.plants().map((p) => p.id));
      } catch {
        this.photoWarning.set('Plant saved, but the photo could not be uploaded.');
      }
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to add plant.');
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
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to remove plant.');
    }
  }
}
