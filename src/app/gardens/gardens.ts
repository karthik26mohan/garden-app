import {
  Component,
  computed,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../supabase.service';
import { Garden, GardenService } from './garden.service';
import { PlantService } from './plant.service';
import { Species, SpeciesService } from './species.service';
import { YardMap } from './yard-map/yard-map';
import { SpeciesLegend } from './species-legend/species-legend';

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
  imports: [RouterLink, DatePipe, YardMap, SpeciesLegend],
  templateUrl: './gardens.html',
  styleUrl: './gardens.scss',
})
export class Gardens implements OnInit {
  private supabase = inject(SupabaseService);
  private gardenService = inject(GardenService);
  private plantService = inject(PlantService);
  private speciesService = inject(SpeciesService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);

  // Signals because the app is zoneless — change detection only re-renders
  // when a signal it depends on changes.
  email = signal<string | null>(null);
  gardens = signal<Garden[]>([]);
  loading = signal(true);
  errorMessage = signal<string | null>(null);

  // True while onBackfillHeights is looking up dimensions for one or
  // more species. Disables the button and shows a loading label.
  backfillingHeights = signal(false);

  /**
   * Unique species currently present in any of the user's gardens.
   * Computed from gardens.plants.species; deduplicates by species.id.
   * Re-runs only when the gardens signal actually changes — so drag and
   * add events that mutate the signal cascade through here cheaply.
   */
  visibleSpecies = computed<Species[]>(() => {
    const seen = new Map<string, Species>();
    for (const garden of this.gardens()) {
      for (const plant of garden.plants ?? []) {
        if (plant.species && !seen.has(plant.species.id)) {
          seen.set(plant.species.id, plant.species);
        }
      }
    }
    return Array.from(seen.values());
  });

  /**
   * Species that have enough identity (a scientific name) to look up
   * dimensions for, but no height data yet — these render as neutral
   * gray on the map. Drives the "Fill in missing heights" button's
   * visibility and its work list.
   */
  speciesNeedingHeight = computed<Species[]>(() =>
    this.visibleSpecies().filter(
      (s) => s.scientific_name != null && s.height_ft_min == null && s.height_ft_max == null,
    ),
  );

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

  /**
   * Yard-map emitted a draw-complete (Shift+drag on grid → released →
   * named). Persist the new garden and add it to the local list. Unlike
   * box-change, we don't optimistically add a temp row here — the round
   * trip is short and the user just released their mouse, so a tiny
   * pause before the garden appears is acceptable. Avoids the user_id /
   * temp-id complexity of an optimistic create.
   */
  async onDrawComplete(e: {
    name: string;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
  }): Promise<void> {
    try {
      const created = await this.gardenService.create({
        name: e.name,
        position_x_ft: e.positionX,
        position_y_ft: e.positionY,
        width_ft: e.width,
        height_ft: e.height,
      });
      // Prepend so the newest is at the top of the card list (matches
      // GardenService.list's newest-first order).
      this.gardens.update((list) => [created, ...list]);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to create garden.',
      );
    }
  }

  /**
   * Yard-map emitted a plant drag-end. The plant lives inside one of the
   * gardens in our local signal, so we mutate the nested array — find the
   * garden containing the plant, then map its plants array to replace
   * the moved plant's position. On error, revert the whole snapshot.
   */
  async onPlantPositionChange(e: {
    plantId: string;
    positionX: number;
    positionY: number;
  }): Promise<void> {
    const previous = this.gardens();

    this.gardens.update((list) =>
      list.map((g) => ({
        ...g,
        plants: g.plants?.map((p) =>
          p.id === e.plantId
            ? { ...p, position_x_ft: e.positionX, position_y_ft: e.positionY }
            : p,
        ),
      })),
    );

    try {
      await this.plantService.updatePosition(
        e.plantId,
        e.positionX,
        e.positionY,
      );
    } catch (err) {
      this.gardens.set(previous);
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to save plant position.',
      );
    }
  }

  /**
   * Look up mature height (+ spread) for every visible species that has
   * a scientific name but no height data yet, then splice each result
   * back into the embedded species on every matching plant across every
   * garden — the yard map's colors update reactively because they're
   * derived from `gardens()`. Best-effort per species: a failed lookup
   * just leaves that species unchanged (still gray) without blocking
   * the others.
   */
  async onBackfillHeights(): Promise<void> {
    const targets = this.speciesNeedingHeight();
    if (targets.length === 0) return;

    this.backfillingHeights.set(true);
    try {
      const updated = await Promise.all(
        targets.map((s) => this.speciesService.backfillDimensions(s)),
      );
      const byId = new Map(updated.map((s) => [s.id, s]));

      this.gardens.update((list) =>
        list.map((g) => ({
          ...g,
          plants: g.plants?.map((p) =>
            p.species && byId.has(p.species.id) ? { ...p, species: byId.get(p.species.id) } : p,
          ),
        })),
      );
    } finally {
      this.backfillingHeights.set(false);
    }
  }
}
