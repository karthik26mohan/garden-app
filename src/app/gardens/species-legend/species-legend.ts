import { Component, computed, input, signal } from '@angular/core';
import { Species } from '../species.service';

/**
 * Legend that maps each species's display_number to its name.
 * Pairs with the numbered plant circles in the yard map — user sees "3"
 * in a circle, looks at the legend, learns it's "Hibiscus".
 *
 * Takes a flat list of species (the parent computes which species are
 * currently visible across all gardens; see Gardens.visibleSpecies).
 * Sort is a local UI concern handled here — the parent always passes
 * unsorted-by-default; the user toggles between by-number and by-name.
 *
 * See DECISIONS.md Entry #13 for the species architecture.
 */
@Component({
  selector: 'app-species-legend',
  imports: [],
  templateUrl: './species-legend.html',
  styleUrl: './species-legend.scss',
})
export class SpeciesLegend {
  species = input.required<Species[]>();

  // Sort state. 'number' = ascending display_number (matches insertion
  // order since numbers are assigned sequentially). 'name' = alphabetical
  // by common_name.
  protected sortMode = signal<'number' | 'name'>('number');

  /**
   * Derived sorted list. Computed so it only re-runs when species() or
   * sortMode() change, not on every change-detection cycle.
   */
  protected sortedSpecies = computed(() => {
    const list = [...this.species()];
    if (this.sortMode() === 'number') {
      return list.sort((a, b) => a.display_number - b.display_number);
    }
    return list.sort((a, b) => a.common_name.localeCompare(b.common_name));
  });

  protected toggleSort(): void {
    this.sortMode.update((m) => (m === 'number' ? 'name' : 'number'));
  }
}
