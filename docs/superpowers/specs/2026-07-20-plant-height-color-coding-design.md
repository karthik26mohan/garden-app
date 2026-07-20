# Plant height color-coding — design

**Date:** 2026-07-20
**Status:** approved (brainstorming), pending implementation plan

## Problem

Every plant circle on the yard map (`src/app/gardens/yard-map/yard-map.html:181-212`)
renders with one fixed fill — `rgba(101, 163, 13, 0.45)` / stroke `#4d7c0f`
(`yard-map.scss:102-116`) — regardless of species. The only per-plant signal is the
`display_number` printed inside the circle, cross-referenced against the
`species-legend` component. There's no way to tell a plant's mature height at a
glance, even though `species.height_ft_min`/`height_ft_max` has existed since the
LLM-dimensions work (`species.service.ts:35-36`) specifically to enable this —
DECISIONS.md Entry #16 calls out "a height for color-coding" as the original intent,
but the color half was never built.

## Goal

Color each plant circle by its species' mature height band, with a distinct shade
per species within a band, so:
- glancing at the map tells you roughly how tall each plant gets
- two circles with different `display_number`s never look identical
- the same species always renders the same color, every time

## Height bands

Bucketed by `species.height_ft_max` (falls back to `height_ft_min` when max is null
but min isn't):

| Band | Range | Hue |
|---|---|---|
| Tall | `> 8 ft` | brown |
| Medium-tall | `5–8 ft` | green |
| Medium | `3–5 ft` | blue |
| Short | `1–3 ft` | yellow |
| Ground-level | `≤ 1 ft` | gray (saturated) |
| Unknown | both `height_ft_min` and `height_ft_max` are null | gray (desaturated/neutral) |

The "ground-level" and "unknown" grays must be visually distinguishable (different
saturation, not different hue) so an unresolved species doesn't read as a real
≤1ft band.

## Shade-per-species formula

New pure utility, `src/app/gardens/plant-color.util.ts`:

```ts
export function getPlantColor(species: Species | undefined | null): string
```

- Each band has a fixed hue + saturation.
- Lightness cycles through 5 fixed steps, selected by `species.display_number % 5`.
  Same `display_number` → same step, every render, with no stored color value.
- `species` undefined/null (legacy plant with no `species_id`) renders the same
  neutral "unknown" gray as a species with no height data.
- Returns a CSS color string (hex or `hsl(...)`) used directly as the circle's
  `fill`; stroke stays a fixed darker variant of the same hue per band (mirrors
  today's fill/stroke relationship in `yard-map.scss:102-116`).

This is computed at render time only — no migration, no color column on `species`,
no caching. If the shade formula changes later, every plant just re-renders with
the new mapping.

## Component changes

**`yard-map.ts` / `.html` / `.scss`**
Replace the fixed `.yard-map__plant` fill/stroke with a per-plant computed value
from `getPlantColor(plant.species)`, bound via `[style.fill]` /
`[style.stroke]` on the `<circle>` at `yard-map.html:185-195`. The
`--dragging` state modifier keeps working (opacity/stroke-width tweaks layer on
top of whatever the base color is).

**`species-legend`**
Add a small color swatch (filled circle or square) next to each entry, using the
same `getPlantColor(species)` call, so the legend serves as the height/color key.

**`garden-detail.ts` / `.html`**
Add a "Fill in missing heights" button, visible only when `allSpecies()` contains
at least one species with a non-null `scientific_name` but null height (species
with no `scientific_name` yet — never identified — are skipped; there's nothing to
look up). Clicking it:
- iterates matching species, calling a new `SpeciesService.backfillDimensions(species)`
  method (calls `PlantDimensionService.lookup` with the existing scientific/common
  name, then persists `height_ft_min/max`, `spread_ft_min/max`, `dimensions_source`
  the same way `ensureByIdentification` does at `species.service.ts:265-269`)
- updates `allSpecies()` and the embedded `species` on any affected plants in
  `plants()` as each lookup resolves, so map colors flip from gray to their real
  band without a full reload
- disables itself and shows a spinner while in flight
- on a per-species lookup failure, leaves that species gray and continues with
  the rest (matches the existing best-effort/never-throw pattern in
  `PlantDimensionService.lookup`)

## Edge cases

- Species with a resolved height but somehow no `display_number` — not possible
  today (`display_number` is assigned atomically on species creation in both
  `ensureByName` and `ensureByIdentification`) — not handled specially.
- A plant with `species_id: null` (legacy plants predating species) — same
  neutral gray as "unknown height."
- Height resolves to exactly a band boundary (e.g. `height_ft_max === 8`) —
  boundaries are inclusive on the lower band (`8` → "Medium-tall," not "Tall"),
  consistent with the `>`/`≤` table above.

## Testing

- Unit tests for `getPlantColor`: one case per band (including the brown/green/
  blue/yellow/gray-ground/gray-unknown split), plus shade-cycling coverage for
  `display_number` 0–9 to confirm the `% 5` wrap repeats shades correctly at 5
  and 6.
- No new e2e/UI test infra — matches the existing Vitest/jsdom unit-test style
  used elsewhere in `app/gardens`.

## Explicitly out of scope

- No color customization/settings UI — bands and hues are fixed constants.
- No stored/cached color column on `species` — always computed at render.
- No automatic background lookup on map load — height backfill is manual
  (the "Fill in missing heights" button), not triggered implicitly by rendering.
