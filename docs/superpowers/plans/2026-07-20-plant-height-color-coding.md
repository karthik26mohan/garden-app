# Plant Height Color-Coding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color each plant circle on the yard map by its species' mature height band, with a distinct shade per species within a band, computed deterministically with no schema changes.

**Architecture:** A pure utility function (`getPlantColor`) maps a `Species` to `{ fill, stroke, textColor }` via a height-band lookup + a `display_number`-driven shade cycle. `yard-map` and `species-legend` both call it at render time via `[style.*]` bindings. `gardens.ts` gets a manual "Fill in missing heights" button that calls a new `SpeciesService.backfillDimensions` method (reusing the existing `PlantDimensionService`) for species with a known scientific name but no height data.

**Tech Stack:** Angular 21 (zoneless, signals), Vitest + jsdom for tests, Supabase JS client.

## Global Constraints

- Bucket by `species.height_ft_max`, falling back to `species.height_ft_min` when max is null. Both null → `unknown` band.
- Height bands: `> 8ft` tall/brown, `5–8ft` medium-tall/green, `3–5ft` medium/blue, `1–3ft` short/yellow, `≤1ft` ground/gray, unknown/neutral-gray. Boundary values belong to the **lower** (shorter) band — e.g. exactly `8` is medium-tall, not tall.
- Shade within a band is a deterministic function of `species.display_number` — same number always renders the same shade, no stored/cached color value.
- No DB migration. No color column on `species`. Colors are always computed at render time.
- Spec: `docs/superpowers/specs/2026-07-20-plant-height-color-coding-design.md`.

**Correction from the spec:** the spec names `garden-detail.ts`/`.html` as the home for the "Fill in missing heights" button. That's wrong — the yard map, species legend, and the `visibleSpecies` computed all live on the `Gardens` list page (`src/app/gardens/gardens.ts`/`.html`), not the per-garden detail page. The button belongs there instead; every other part of the spec is implemented as written.

---

### Task 1: `getPlantColor` height-band + shade utility

**Files:**
- Create: `src/app/gardens/plant-color.util.ts`
- Test: `src/app/gardens/plant-color.util.spec.ts`

**Interfaces:**
- Produces: `heightBand(heightFt: number | null): HeightBand` where `HeightBand = 'tall' | 'medium-tall' | 'medium' | 'short' | 'ground' | 'unknown'`.
- Produces: `getPlantColor(species: Species | null | undefined): PlantColor` where `PlantColor = { fill: string; stroke: string; textColor: string }`. Every later task (`yard-map`, `species-legend`) consumes this exact signature and return shape.

- [ ] **Step 1: Write the failing tests**

Create `src/app/gardens/plant-color.util.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPlantColor, heightBand } from './plant-color.util';
import { Species } from './species.service';

function species(overrides: Partial<Species>): Species {
  return {
    id: 'sp-1',
    user_id: 'user-1',
    common_name: 'Test plant',
    scientific_name: null,
    display_number: 1,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    external_source: null,
    external_id: null,
    height_ft_min: null,
    height_ft_max: null,
    external_data: null,
    spread_ft_min: null,
    spread_ft_max: null,
    dimensions_source: null,
    ...overrides,
  };
}

describe('heightBand', () => {
  it('returns unknown for null height', () => {
    expect(heightBand(null)).toBe('unknown');
  });

  it('buckets values above 8 as tall', () => {
    expect(heightBand(8.5)).toBe('tall');
    expect(heightBand(20)).toBe('tall');
  });

  it('treats exactly 8 as medium-tall, not tall (boundary goes to the lower band)', () => {
    expect(heightBand(8)).toBe('medium-tall');
  });

  it('buckets 5 to 8 as medium-tall', () => {
    expect(heightBand(6)).toBe('medium-tall');
  });

  it('treats exactly 5 as medium, not medium-tall', () => {
    expect(heightBand(5)).toBe('medium');
  });

  it('buckets 3 to 5 as medium', () => {
    expect(heightBand(4)).toBe('medium');
  });

  it('treats exactly 3 as short, not medium', () => {
    expect(heightBand(3)).toBe('short');
  });

  it('buckets 1 to 3 as short', () => {
    expect(heightBand(2)).toBe('short');
  });

  it('treats exactly 1 and below as ground', () => {
    expect(heightBand(1)).toBe('ground');
    expect(heightBand(0.5)).toBe('ground');
  });
});

describe('getPlantColor', () => {
  it('returns the unknown-band color for a species with no height data', () => {
    const color = getPlantColor(species({ height_ft_min: null, height_ft_max: null }));
    expect(color.fill).toBe('hsl(0, 0%, 30%)');
  });

  it('returns the unknown-band color when species is null', () => {
    expect(getPlantColor(null).fill).toBe('hsl(0, 0%, 30%)');
  });

  it('falls back to height_ft_min when height_ft_max is null', () => {
    const color = getPlantColor(
      species({ height_ft_min: 10, height_ft_max: null, display_number: 0 }),
    );
    expect(color.fill).toBe('hsl(25, 45%, 30%)'); // tall band, shade step 0
  });

  it('prefers height_ft_max over height_ft_min when both are present', () => {
    const color = getPlantColor(
      species({ height_ft_min: 10, height_ft_max: 2, display_number: 0 }),
    );
    expect(color.fill).toBe('hsl(48, 65%, 30%)'); // short band (max=2), not tall
  });

  it('cycles shade by display_number within the same band', () => {
    const base = { height_ft_min: 6, height_ft_max: 6 }; // medium-tall
    expect(getPlantColor(species({ ...base, display_number: 0 })).fill).toBe(
      'hsl(100, 45%, 30%)',
    );
    expect(getPlantColor(species({ ...base, display_number: 1 })).fill).toBe(
      'hsl(100, 45%, 40%)',
    );
    expect(getPlantColor(species({ ...base, display_number: 4 })).fill).toBe(
      'hsl(100, 45%, 70%)',
    );
  });

  it('wraps the shade cycle after 5 species (display_number 5 matches 0)', () => {
    const base = { height_ft_min: 6, height_ft_max: 6 };
    expect(getPlantColor(species({ ...base, display_number: 5 })).fill).toBe(
      getPlantColor(species({ ...base, display_number: 0 })).fill,
    );
  });

  it('uses white text on darker shades and dark text on lighter shades', () => {
    const base = { height_ft_min: 6, height_ft_max: 6 };
    expect(getPlantColor(species({ ...base, display_number: 0 })).textColor).toBe('#ffffff'); // L=30
    expect(getPlantColor(species({ ...base, display_number: 2 })).textColor).toBe('#ffffff'); // L=50
    expect(getPlantColor(species({ ...base, display_number: 3 })).textColor).toBe('#1c1917'); // L=60
  });

  it('gives every shade a stroke darker than its fill, clamped at a 10% floor', () => {
    const color = getPlantColor(
      species({ height_ft_min: 6, height_ft_max: 6, display_number: 0 }),
    );
    expect(color.fill).toBe('hsl(100, 45%, 30%)');
    expect(color.stroke).toBe('hsl(100, 45%, 10%)');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false plant-color.util`
Expected: FAIL — `Cannot find module './plant-color.util'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/app/gardens/plant-color.util.ts`:

```ts
import { Species } from './species.service';

export type HeightBand = 'tall' | 'medium-tall' | 'medium' | 'short' | 'ground' | 'unknown';

export interface PlantColor {
  fill: string;
  stroke: string;
  textColor: string;
}

interface BandStyle {
  hue: number;
  saturation: number;
}

const BAND_STYLE: Record<HeightBand, BandStyle> = {
  tall: { hue: 25, saturation: 45 }, // brown
  'medium-tall': { hue: 100, saturation: 45 }, // green
  medium: { hue: 210, saturation: 55 }, // blue
  short: { hue: 48, saturation: 65 }, // yellow
  ground: { hue: 210, saturation: 15 }, // slate gray, cool-tinted
  unknown: { hue: 0, saturation: 0 }, // neutral gray
};

// Lightness steps a species' display_number cycles through within its
// band's hue, so neighboring species never render as the same color even
// when they land in the same height band.
const SHADE_LIGHTNESS_STEPS = [30, 40, 50, 60, 70];

/**
 * Boundaries are inclusive on the LOWER band: a value exactly on a
 * boundary (e.g. 8) belongs to the shorter band ("medium-tall"), not the
 * taller one ("tall").
 */
export function heightBand(heightFt: number | null): HeightBand {
  if (heightFt == null) return 'unknown';
  if (heightFt > 8) return 'tall';
  if (heightFt > 5) return 'medium-tall';
  if (heightFt > 3) return 'medium';
  if (heightFt > 1) return 'short';
  return 'ground';
}

function resolveHeightFt(species: Species | null | undefined): number | null {
  return species?.height_ft_max ?? species?.height_ft_min ?? null;
}

/**
 * Deterministic per-plant color: hue/saturation come from the species'
 * height band, lightness cycles by species.display_number. Purely
 * computed — no stored color, so it can never drift out of sync with
 * height data.
 */
export function getPlantColor(species: Species | null | undefined): PlantColor {
  const band = heightBand(resolveHeightFt(species));
  const { hue, saturation } = BAND_STYLE[band];
  const shadeIndex = (species?.display_number ?? 0) % SHADE_LIGHTNESS_STEPS.length;
  const lightness = SHADE_LIGHTNESS_STEPS[shadeIndex];
  const strokeLightness = Math.max(lightness - 20, 10);

  return {
    fill: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    stroke: `hsl(${hue}, ${saturation}%, ${strokeLightness}%)`,
    textColor: lightness <= 50 ? '#ffffff' : '#1c1917',
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false plant-color.util`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/gardens/plant-color.util.ts src/app/gardens/plant-color.util.spec.ts
git commit -m "feat: add height-band + shade color utility for plants"
```

---

### Task 2: `SpeciesService.backfillDimensions`

**Files:**
- Modify: `src/app/gardens/species.service.ts:285-286` (insert new method just before the closing `}` of the class)
- Test: `src/app/gardens/species.service.spec.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `PlantDimensionService.lookup(scientificName: string, commonName?: string): Promise<PlantDimensions>` (already injected in this service as `this.dimensions`, existing signature — see `src/app/gardens/plant-dimension.service.ts:37`).
- Produces: `SpeciesService.backfillDimensions(species: Species): Promise<Species>` — Task 5 (`gardens.ts`) calls this for every species missing height data.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/gardens/species.service.spec.ts` (new top-level `describe`, after the existing one):

```ts
describe('SpeciesService.backfillDimensions', () => {
  let service: SpeciesService;

  const NO_HEIGHT: Species = {
    id: 'sp-2',
    user_id: 'user-1',
    common_name: 'Oak sapling',
    scientific_name: 'Quercus rubra',
    display_number: 4,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    external_source: 'plantnet',
    external_id: null,
    height_ft_min: null,
    height_ft_max: null,
    external_data: null,
    spread_ft_min: null,
    spread_ft_max: null,
    dimensions_source: null,
  };

  const updateSingleMock = vi.fn();
  const eqMock = vi.fn(() => ({ select: vi.fn(() => ({ single: updateSingleMock })) }));
  const updateMock = vi.fn(() => ({ eq: eqMock }));
  const dimensionMock = { lookup: vi.fn() };

  const supabaseMock = {
    client: {
      from: vi.fn(() => ({ update: updateMock })),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PerenualService, useValue: { searchByScientificName: vi.fn() } },
        { provide: PlantDimensionService, useValue: dimensionMock },
      ],
    });
    service = TestBed.inject(SpeciesService);
  });

  it('looks up dimensions and persists them when found', async () => {
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 20,
      heightFtMax: 60,
      spreadFtMin: 15,
      spreadFtMax: 40,
    });
    const updated = { ...NO_HEIGHT, height_ft_min: 20, height_ft_max: 60 };
    updateSingleMock.mockResolvedValue({ data: updated, error: null });

    const result = await service.backfillDimensions(NO_HEIGHT);

    expect(dimensionMock.lookup).toHaveBeenCalledWith('Quercus rubra', 'Oak sapling');
    expect(updateMock).toHaveBeenCalledWith({
      height_ft_min: 20,
      height_ft_max: 60,
      spread_ft_min: 15,
      spread_ft_max: 40,
      dimensions_source: 'llm',
    });
    expect(eqMock).toHaveBeenCalledWith('id', 'sp-2');
    expect(result).toEqual(updated);
  });

  it('returns the species unchanged when the lookup finds nothing', async () => {
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });

    const result = await service.backfillDimensions(NO_HEIGHT);

    expect(updateMock).not.toHaveBeenCalled();
    expect(result).toEqual(NO_HEIGHT);
  });

  it('returns the species unchanged without calling the lookup when it has no scientific name', async () => {
    const unidentified = { ...NO_HEIGHT, scientific_name: null };

    const result = await service.backfillDimensions(unidentified);

    expect(dimensionMock.lookup).not.toHaveBeenCalled();
    expect(result).toEqual(unidentified);
  });

  it('returns the species unchanged when the update fails', async () => {
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 20,
      heightFtMax: 60,
      spreadFtMin: null,
      spreadFtMax: null,
    });
    updateSingleMock.mockResolvedValue({ data: null, error: new Error('boom') });

    const result = await service.backfillDimensions(NO_HEIGHT);

    expect(result).toEqual(NO_HEIGHT);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false species.service`
Expected: FAIL — `service.backfillDimensions is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/app/gardens/species.service.ts`, insert this method right before the final `}` that closes the `SpeciesService` class (currently line 286, directly after `ensureByIdentification`'s closing `}` on line 285):

```ts
  /**
   * Best-effort height/spread backfill for a species that's missing
   * dimensions — used by the "Fill in missing heights" action on the
   * yard map, which needs height data to color-code plants. Mirrors the
   * dimension-merge logic in ensureByIdentification, but for an existing
   * row instead of a brand-new one.
   *
   * Never throws: returns the species unchanged if it has no
   * scientific_name to look up, the lookup finds nothing, or the update
   * fails.
   */
  async backfillDimensions(species: Species): Promise<Species> {
    if (!species.scientific_name) return species;

    const dims = await this.dimensions.lookup(
      species.scientific_name,
      species.common_name,
    );
    const hasAnyDimension =
      dims.heightFtMin != null ||
      dims.heightFtMax != null ||
      dims.spreadFtMin != null ||
      dims.spreadFtMax != null;
    if (!hasAnyDimension) return species;

    const { data, error } = await this.supabase.client
      .from('species')
      .update({
        ...(dims.heightFtMin != null && { height_ft_min: dims.heightFtMin }),
        ...(dims.heightFtMax != null && { height_ft_max: dims.heightFtMax }),
        ...(dims.spreadFtMin != null && { spread_ft_min: dims.spreadFtMin }),
        ...(dims.spreadFtMax != null && { spread_ft_max: dims.spreadFtMax }),
        dimensions_source: 'llm',
      })
      .eq('id', species.id)
      .select()
      .single();
    if (error) return species;
    return data as Species;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false species.service`
Expected: PASS, all cases green (both the existing `ensureByIdentification` suite and the new `backfillDimensions` suite).

- [ ] **Step 5: Commit**

```bash
git add src/app/gardens/species.service.ts src/app/gardens/species.service.spec.ts
git commit -m "feat: add SpeciesService.backfillDimensions for manual height lookup"
```

---

### Task 3: Wire plant colors into the yard map

**Files:**
- Modify: `src/app/gardens/yard-map/yard-map.ts:1-13` (imports), add a `getPlantColor` field
- Modify: `src/app/gardens/yard-map/yard-map.html:181-212`
- Modify: `src/app/gardens/yard-map/yard-map.scss:102-125`
- Test: `src/app/gardens/yard-map/yard-map.spec.ts` (new file)

**Interfaces:**
- Consumes: `getPlantColor(species: Species | null | undefined): PlantColor` from Task 1 (`../plant-color.util`).

- [ ] **Step 1: Write the failing tests**

Create `src/app/gardens/yard-map/yard-map.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { YardMap } from './yard-map';
import { Garden } from '../garden.service';
import { Plant } from '../plant.service';
import { Species } from '../species.service';

function species(overrides: Partial<Species>): Species {
  return {
    id: 'sp-1',
    user_id: 'user-1',
    common_name: 'Test plant',
    scientific_name: null,
    display_number: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    external_source: null,
    external_id: null,
    height_ft_min: null,
    height_ft_max: null,
    external_data: null,
    spread_ft_min: null,
    spread_ft_max: null,
    dimensions_source: null,
    ...overrides,
  };
}

function plant(id: string, overrides: Partial<Plant>): Plant {
  return {
    id,
    garden_id: 'g-1',
    added_by_user_id: 'user-1',
    common_name: null,
    scientific_name: null,
    inaturalist_taxon_id: null,
    plantnet_score: null,
    notes: null,
    planted_at: null,
    position_x_ft: 5,
    position_y_ft: 5,
    diameter_ft: 2,
    species_id: null,
    identified_at: '2026-06-01T00:00:00Z',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function garden(plants: Plant[]): Garden {
  return {
    id: 'g-1',
    user_id: 'user-1',
    name: 'Front yard',
    description: null,
    position_x_ft: 0,
    position_y_ft: 0,
    width_ft: 20,
    height_ft: 20,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    plants,
  };
}

describe('YardMap plant coloring', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [YardMap] }).compileComponents();
  });

  function create(gardens: Garden[]) {
    const fixture = TestBed.createComponent(YardMap);
    fixture.componentRef.setInput('gardens', gardens);
    fixture.detectChanges();
    return fixture;
  }

  it("colors a plant circle by its species' height band", () => {
    const tall = species({ height_ft_max: 12, display_number: 0 });
    const fixture = create([garden([plant('p-1', { species_id: 'sp-1', species: tall })])]);

    const circle = fixture.nativeElement.querySelector(
      '.yard-map__plant',
    ) as SVGCircleElement;
    expect(circle.style.fill).toBe('hsl(25, 45%, 30%)');
  });

  it('renders the neutral unknown color for a plant with no species', () => {
    const fixture = create([garden([plant('p-1', {})])]);

    const circle = fixture.nativeElement.querySelector(
      '.yard-map__plant',
    ) as SVGCircleElement;
    expect(circle.style.fill).toBe('hsl(0, 0%, 30%)');
  });

  it('gives two species in the same height band different shades', () => {
    const a = species({ id: 'sp-a', height_ft_max: 6, display_number: 0 });
    const b = species({ id: 'sp-b', height_ft_max: 6, display_number: 1 });
    const fixture = create([
      garden([
        plant('p-1', { species_id: 'sp-a', species: a }),
        plant('p-2', { species_id: 'sp-b', species: b, position_x_ft: 10 }),
      ]),
    ]);

    const circles = fixture.nativeElement.querySelectorAll('.yard-map__plant');
    expect((circles[0] as SVGCircleElement).style.fill).not.toBe(
      (circles[1] as SVGCircleElement).style.fill,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false yard-map`
Expected: FAIL — the circle's `style.fill` is empty (no binding wired up yet).

- [ ] **Step 3: Write the implementation**

In `src/app/gardens/yard-map/yard-map.ts`, add the import alongside the existing ones (after line 13):

```ts
import { Garden } from '../garden.service';
import { Plant } from '../plant.service';
import { getPlantColor } from '../plant-color.util';
```

Then add this field right after the `gardens` input (after line 65, `gardens = input.required<Garden[]>();`):

```ts
  // Exposed for the template — @for blocks call methods/fields on `this`,
  // not bare imported functions, so this is how getPlantColor becomes
  // callable from yard-map.html.
  protected getPlantColor = getPlantColor;
```

In `src/app/gardens/yard-map/yard-map.html`, replace lines 181-212 with:

```html
        @for (plant of (garden.plants ?? []); track plant.id) {
          @let isDraggingPlant = draggingPlantId() === plant.id;
          @let plantX = isDraggingPlant ? dragPlantX() : plant.position_x_ft;
          @let plantY = isDraggingPlant ? dragPlantY() : plant.position_y_ft;
          @let plantColor = getPlantColor(plant.species);
          <circle
            [attr.cx]="plantX"
            [attr.cy]="plantY"
            [attr.r]="plant.diameter_ft / 2"
            [style.fill]="plantColor.fill"
            [style.stroke]="plantColor.stroke"
            class="yard-map__plant"
            [class.yard-map__plant--dragging]="isDraggingPlant"
            (pointerdown)="onPlantPointerDown($event, plant)"
            (pointermove)="onPlantPointerMove($event)"
            (pointerup)="onPlantPointerUp($event)"
            (pointercancel)="onPlantPointerUp($event)"
          />
          <!--
            Species display_number inside the circle. Font size scales
            with the plant's diameter so the number stays proportional
            at any zoom level. Falls back to "?" for legacy plants that
            don't yet have a species_id assigned. Text color comes from
            getPlantColor so it stays readable against every shade.
          -->
          <text
            [attr.x]="plantX"
            [attr.y]="plantY"
            text-anchor="middle"
            dominant-baseline="middle"
            [attr.font-size]="plant.diameter_ft * 0.5"
            [style.fill]="plantColor.textColor"
            class="yard-map__plant-number"
          >
            {{ plant.species?.display_number ?? '?' }}
          </text>
        }
```

In `src/app/gardens/yard-map/yard-map.scss`, replace the `&__plant` and `&__plant-number` rules (lines 102-125) with:

```scss
  &__plant {
    // fill/stroke color now come from getPlantColor via inline style
    // ([style.fill]/[style.stroke] in yard-map.html) — only opacity and
    // stroke-width stay here as drag-state modifiers.
    fill-opacity: 0.45;
    stroke-width: 0.05;
    cursor: grab;

    &:active {
      cursor: grabbing;
    }

    &--dragging {
      fill-opacity: 0.7;
      stroke-width: 0.1;
    }
  }

  &__plant-number {
    // fill color comes from getPlantColor via inline style, so the
    // number stays readable against every shade.
    // pointer-events: none so clicks pass through to the circle for drag.
    font-weight: 700;
    pointer-events: none;
    user-select: none;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false yard-map`
Expected: PASS, all three cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/gardens/yard-map/yard-map.ts src/app/gardens/yard-map/yard-map.html src/app/gardens/yard-map/yard-map.scss src/app/gardens/yard-map/yard-map.spec.ts
git commit -m "feat: color yard-map plant circles by height band + species shade"
```

---

### Task 4: Add color swatches to the species legend

**Files:**
- Modify: `src/app/gardens/species-legend/species-legend.ts`
- Modify: `src/app/gardens/species-legend/species-legend.html:21-33`
- Modify: `src/app/gardens/species-legend/species-legend.scss`
- Test: `src/app/gardens/species-legend/species-legend.spec.ts` (new file)

**Interfaces:**
- Consumes: `getPlantColor(species: Species | null | undefined): PlantColor` from Task 1 (`../plant-color.util`).

- [ ] **Step 1: Write the failing test**

Create `src/app/gardens/species-legend/species-legend.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SpeciesLegend } from './species-legend';
import { Species } from '../species.service';

function species(overrides: Partial<Species>): Species {
  return {
    id: 'sp-1',
    user_id: 'user-1',
    common_name: 'Test plant',
    scientific_name: null,
    display_number: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    external_source: null,
    external_id: null,
    height_ft_min: null,
    height_ft_max: null,
    external_data: null,
    spread_ft_min: null,
    spread_ft_max: null,
    dimensions_source: null,
    ...overrides,
  };
}

describe('SpeciesLegend swatches', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SpeciesLegend] }).compileComponents();
  });

  it("renders a swatch colored by the species' height band", () => {
    const fixture = TestBed.createComponent(SpeciesLegend);
    fixture.componentRef.setInput('species', [species({ height_ft_max: 12 })]);
    fixture.detectChanges();

    const swatch = fixture.nativeElement.querySelector(
      '.species-legend__swatch',
    ) as HTMLElement;
    expect(swatch.style.background).toBe('hsl(25, 45%, 30%)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false species-legend`
Expected: FAIL — `.species-legend__swatch` doesn't exist in the DOM yet.

- [ ] **Step 3: Write the implementation**

In `src/app/gardens/species-legend/species-legend.ts`, add the import (after line 2) and a protected field (after line 23, `species = input.required<Species[]>();`):

```ts
import { Component, computed, input, signal } from '@angular/core';
import { Species } from '../species.service';
import { getPlantColor } from '../plant-color.util';
```

```ts
  species = input.required<Species[]>();

  // Exposed for the template's swatch binding.
  protected plantColor = getPlantColor;
```

In `src/app/gardens/species-legend/species-legend.html`, replace lines 21-33 with:

```html
    <ul class="species-legend__list">
      @for (s of sortedSpecies(); track s.id) {
        <li class="species-legend__item">
          <span class="species-legend__swatch" [style.background]="plantColor(s).fill"></span>
          <span class="species-legend__number">{{ s.display_number }}</span>
          <span class="species-legend__name">{{ s.common_name }}</span>
          @if (s.scientific_name) {
            <span class="species-legend__scientific">
              {{ s.scientific_name }}
            </span>
          }
        </li>
      }
    </ul>
```

In `src/app/gardens/species-legend/species-legend.scss`, replace the `&__item`, `&__number`, `&__name`, `&__scientific` rules with (adds a swatch column, shifts the others right by one column):

```scss
  &__item {
    // Three columns: swatch + number badge + flexible content.
    // scientific_name (if present) wraps to a second row in column 3.
    display: grid;
    grid-template-columns: 0.6rem 1.75rem 1fr;
    column-gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border);

    &:last-child {
      border-bottom: none;
    }
  }

  &__swatch {
    grid-column: 1;
    grid-row: 1 / span 2;
    align-self: center;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
  }

  &__number {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    text-align: center;
    padding: 0.15rem 0;
    font-size: 0.75rem;
    font-weight: 700;
    color: #5c3a1f;
    background: #f5e8d8;
    border-radius: 4px;
  }

  &__name {
    grid-column: 3;
    grid-row: 1;
    font-size: 0.9rem;
    color: var(--text);
  }

  &__scientific {
    grid-column: 3;
    grid-row: 2;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-style: italic;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false species-legend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/gardens/species-legend/species-legend.ts src/app/gardens/species-legend/species-legend.html src/app/gardens/species-legend/species-legend.scss src/app/gardens/species-legend/species-legend.spec.ts
git commit -m "feat: add height-band color swatches to the species legend"
```

---

### Task 5: "Fill in missing heights" button on the Gardens page

**Files:**
- Modify: `src/app/gardens/gardens.ts`
- Modify: `src/app/gardens/gardens.html:29` (insert after `<app-species-legend>`)
- Modify: `src/app/gardens/gardens.scss`
- Test: `src/app/gardens/gardens.spec.ts` (new file)

**Interfaces:**
- Consumes: `SpeciesService.backfillDimensions(species: Species): Promise<Species>` from Task 2.

- [ ] **Step 1: Write the failing tests**

Create `src/app/gardens/gardens.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Gardens } from './gardens';
import { SupabaseService } from '../supabase.service';
import { GardenService, Garden } from './garden.service';
import { PlantService } from './plant.service';
import { SpeciesService, Species } from './species.service';

function species(overrides: Partial<Species>): Species {
  return {
    id: 'sp-1',
    user_id: 'user-1',
    common_name: 'Oak sapling',
    scientific_name: 'Quercus rubra',
    display_number: 1,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    external_source: 'plantnet',
    external_id: null,
    height_ft_min: null,
    height_ft_max: null,
    external_data: null,
    spread_ft_min: null,
    spread_ft_max: null,
    dimensions_source: null,
    ...overrides,
  };
}

function gardenWithSpecies(plantSpecies: Species): Garden {
  return {
    id: 'g-1',
    user_id: 'user-1',
    name: 'Front yard',
    description: null,
    position_x_ft: 0,
    position_y_ft: 0,
    width_ft: 20,
    height_ft: 20,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    plants: [
      {
        id: 'p-1',
        garden_id: 'g-1',
        added_by_user_id: 'user-1',
        common_name: null,
        scientific_name: null,
        inaturalist_taxon_id: null,
        plantnet_score: null,
        notes: null,
        planted_at: null,
        position_x_ft: 5,
        position_y_ft: 5,
        diameter_ft: 2,
        species_id: plantSpecies.id,
        species: plantSpecies,
        identified_at: '2026-06-01T00:00:00Z',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      },
    ],
  };
}

describe('Gardens.speciesNeedingHeight / onBackfillHeights', () => {
  let component: Gardens;

  const backfillMock = vi.fn();
  const supabaseMock = {
    client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } },
  };
  const gardenServiceMock = { list: vi.fn() };
  const plantServiceMock = {};
  const speciesServiceMock = { backfillDimensions: backfillMock };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: GardenService, useValue: gardenServiceMock },
        { provide: PlantService, useValue: plantServiceMock },
        { provide: SpeciesService, useValue: speciesServiceMock },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    });
    component = TestBed.inject(Gardens);
  });

  it('lists species with a scientific name but no height data', () => {
    const noHeight = species({ id: 'sp-1', height_ft_min: null, height_ft_max: null });
    const hasHeight = species({ id: 'sp-2', height_ft_max: 6 });
    const unidentified = species({ id: 'sp-3', scientific_name: null });
    component.gardens.set([
      gardenWithSpecies(noHeight),
      gardenWithSpecies(hasHeight),
      gardenWithSpecies(unidentified),
    ]);

    expect(component.speciesNeedingHeight().map((s) => s.id)).toEqual(['sp-1']);
  });

  it('backfills dimensions and updates the embedded species on affected plants', async () => {
    const noHeight = species({ id: 'sp-1', height_ft_min: null, height_ft_max: null });
    component.gardens.set([gardenWithSpecies(noHeight)]);
    const updated = { ...noHeight, height_ft_max: 40 };
    backfillMock.mockResolvedValue(updated);

    await component.onBackfillHeights();

    expect(backfillMock).toHaveBeenCalledWith(noHeight);
    expect(component.gardens()[0].plants![0].species).toEqual(updated);
    expect(component.speciesNeedingHeight()).toEqual([]);
  });

  it('does nothing when no species need a height lookup', async () => {
    const hasHeight = species({ id: 'sp-2', height_ft_max: 6 });
    component.gardens.set([gardenWithSpecies(hasHeight)]);

    await component.onBackfillHeights();

    expect(backfillMock).not.toHaveBeenCalled();
  });

  it('sets backfillingHeights while the lookup is in flight', async () => {
    const noHeight = species({ id: 'sp-1', height_ft_min: null, height_ft_max: null });
    component.gardens.set([gardenWithSpecies(noHeight)]);
    let resolveBackfill!: (value: Species) => void;
    backfillMock.mockReturnValue(
      new Promise<Species>((resolve) => {
        resolveBackfill = resolve;
      }),
    );

    const pending = component.onBackfillHeights();
    expect(component.backfillingHeights()).toBe(true);

    resolveBackfill({ ...noHeight, height_ft_max: 40 });
    await pending;

    expect(component.backfillingHeights()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false gardens.spec`
Expected: FAIL — `component.speciesNeedingHeight is not a function` / `onBackfillHeights is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/app/gardens/gardens.ts`, update the imports (lines 12-16) to add `SpeciesService`:

```ts
import { Garden, GardenService } from './garden.service';
import { PlantService } from './plant.service';
import { Species, SpeciesService } from './species.service';
import { YardMap } from './yard-map/yard-map';
import { SpeciesLegend } from './species-legend/species-legend';
```

Add the injected service (after line 38, `private plantService = inject(PlantService);`):

```ts
  private speciesService = inject(SpeciesService);
```

Add a `backfillingHeights` signal (after line 47, `errorMessage = signal<string | null>(null);`):

```ts
  // True while onBackfillHeights is looking up dimensions for one or
  // more species. Disables the button and shows a loading label.
  backfillingHeights = signal(false);
```

Add a `speciesNeedingHeight` computed right after `visibleSpecies` (after line 65, the closing `});` of `visibleSpecies`):

```ts
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
```

Add the handler method at the end of the class, right before the final closing `}` (after `onPlantPositionChange`'s closing `}`, currently the last method in the file):

```ts
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
```

In `src/app/gardens/gardens.html`, insert this right after the `<app-species-legend>` line (after line 29):

```html
  <app-species-legend [species]="visibleSpecies()" />

  @if (speciesNeedingHeight().length > 0) {
    <button
      type="button"
      class="btn btn--secondary gardens__backfill-btn"
      [disabled]="backfillingHeights()"
      (click)="onBackfillHeights()"
    >
      {{ backfillingHeights() ? 'Looking up heights…' : 'Fill in missing heights' }}
    </button>
  }
```

In `src/app/gardens/gardens.scss`, add a spacing rule (matches the `0 0 2rem` bottom margin used by `.yard-map`/`.species-legend` blocks):

```scss
  &__backfill-btn {
    display: block;
    margin: 0 0 2rem;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false gardens.spec`
Expected: PASS, all four cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/gardens/gardens.ts src/app/gardens/gardens.html src/app/gardens/gardens.scss src/app/gardens/gardens.spec.ts
git commit -m "feat: add manual height-backfill button to the gardens page"
```

---

### Task 6: Full-suite check + formatting pass

**Files:** none new — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm test -- --watch=false`
Expected: PASS — every spec file, including the five new/modified ones from Tasks 1-5, plus all pre-existing specs (unaffected).

- [ ] **Step 2: Run Prettier on every touched file**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npx prettier --write \
  src/app/gardens/plant-color.util.ts \
  src/app/gardens/plant-color.util.spec.ts \
  src/app/gardens/species.service.ts \
  src/app/gardens/species.service.spec.ts \
  src/app/gardens/yard-map/yard-map.ts \
  src/app/gardens/yard-map/yard-map.html \
  src/app/gardens/yard-map/yard-map.scss \
  src/app/gardens/yard-map/yard-map.spec.ts \
  src/app/gardens/species-legend/species-legend.ts \
  src/app/gardens/species-legend/species-legend.html \
  src/app/gardens/species-legend/species-legend.scss \
  src/app/gardens/species-legend/species-legend.spec.ts \
  src/app/gardens/gardens.ts \
  src/app/gardens/gardens.html \
  src/app/gardens/gardens.scss \
  src/app/gardens/gardens.spec.ts
```
Expected: exits 0; any reformatted files show as modified in `git status`.

- [ ] **Step 3: Commit any formatting changes (skip if nothing changed)**

```bash
git add -u
git commit -m "style: prettier pass on plant height color-coding changes"
```
