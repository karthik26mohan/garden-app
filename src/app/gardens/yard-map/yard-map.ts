import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Garden } from '../garden.service';

/**
 * Top-down editor view of the user's yard. Each garden renders as a
 * draggable rectangle at its stored position/size. 1 SVG unit = 1 foot,
 * so the stored coordinates flow straight into the SVG without any scale
 * math at the data layer.
 *
 * Coordinate convention (matches DECISIONS.md Entry #11):
 *   Origin = top-left of canvas
 *   X axis = increases rightward (east)
 *   Y axis = increases downward (south)
 *
 * Zoom & pan via viewBox manipulation:
 *   The viewBox attribute defines the rectangle of SVG coordinate space
 *   that's currently visible. Shrinking viewWidth/viewHeight zooms in
 *   (less area shown, so each foot is bigger on screen). Shifting
 *   viewX/viewY pans without zooming. All four are signals so the SVG
 *   re-renders on change.
 *
 *   Auto-fit-to-content runs once the first time gardens arrive (guarded
 *   by a flag so dragging — which mutates the parent's gardens signal —
 *   doesn't trigger constant re-fits).
 *
 * Drag interaction:
 *   - pointerdown on a rect starts a drag (captures the pointer so fast
 *     drags don't break when the cursor leaves the rect)
 *   - pointermove updates local drag state in SVG units; we don't write
 *     to the DB on every move — that'd be hundreds of round trips
 *   - pointerup ends the drag and emits a `positionChange` event for the
 *     parent to persist
 *
 *   The drag scale factor is computed from the CURRENT visible view
 *   width, not a fixed canvas size — so dragging stays cursor-accurate
 *   even when the view is zoomed.
 *
 * Snap-to-grid: positions are rounded to whole feet during pointermove,
 * so the stored values stay clean integers and align with the visual grid.
 *
 * SSR is fine — pointer events only fire in the browser, so the handlers
 * never run during server prerender. No isPlatformBrowser guard needed.
 */
@Component({
  selector: 'app-yard-map',
  imports: [],
  templateUrl: './yard-map.html',
  styleUrl: './yard-map.scss',
})
export class YardMap {
  gardens = input.required<Garden[]>();

  positionChange = output<{
    gardenId: string;
    positionX: number;
    positionY: number;
  }>();

  // View state — what region of the SVG is visible right now (in feet).
  // Defaults are a generic 50×50 view starting at the origin; auto-fit
  // overrides on first non-empty gardens input.
  protected viewX = signal(0);
  protected viewY = signal(0);
  protected viewWidth = signal(50);
  protected viewHeight = signal(50);

  // Computed string passed to the SVG's [attr.viewBox] binding.
  protected viewBox = computed(
    () =>
      `${this.viewX()} ${this.viewY()} ${this.viewWidth()} ${this.viewHeight()}`,
  );

  // viewChild reference to the <svg> element — needed for getBoundingClientRect.
  private svgRef = viewChild<ElementRef<SVGSVGElement>>('svgEl');

  // Drag state. Exposed as signals so the template can re-render the
  // dragged rect at its temporary position during the drag.
  protected draggingId = signal<string | null>(null);
  protected dragX = signal(0);
  protected dragY = signal(0);

  // Drag bookkeeping — not signals because the template doesn't read them.
  private dragStartPointerX = 0;
  private dragStartPointerY = 0;
  private dragStartGardenX = 0;
  private dragStartGardenY = 0;
  // SVG units per screen pixel, captured at drag start.
  private dragScale = 1;

  constructor() {
    // Auto-fit the view to the gardens ONCE on first non-empty load.
    // Guarded so drag-triggered parent updates (which re-set this.gardens
    // optimistically) don't cause the view to jump around mid-edit.
    let hasFitted = false;
    effect(() => {
      const list = this.gardens();
      if (!hasFitted && list.length > 0) {
        hasFitted = true;
        this.fitToGardens(list);
      }
    });
  }

  /**
   * Sets viewBox to fit all gardens with a padding margin. Enforces a
   * minimum view size so a single small garden doesn't zoom in so far
   * that there's no surrounding context.
   */
  private fitToGardens(gardens: Garden[]): void {
    const padding = 5; // feet of breathing room around the bounding box
    const minViewSize = 30; // smallest view extent (feet), so a tiny
    // garden still shows ~30ft of surroundings

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const g of gardens) {
      if (g.position_x_ft < minX) minX = g.position_x_ft;
      if (g.position_y_ft < minY) minY = g.position_y_ft;
      if (g.position_x_ft + g.width_ft > maxX)
        maxX = g.position_x_ft + g.width_ft;
      if (g.position_y_ft + g.height_ft > maxY)
        maxY = g.position_y_ft + g.height_ft;
    }

    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const width = Math.max(maxX - minX, minViewSize);
    const height = Math.max(maxY - minY, minViewSize);

    this.viewX.set(minX);
    this.viewY.set(minY);
    this.viewWidth.set(width);
    this.viewHeight.set(height);
  }

  onPointerDown(event: PointerEvent, garden: Garden): void {
    const svg = this.svgRef()?.nativeElement;
    if (!svg) return;

    // setPointerCapture routes all subsequent events for this pointer to
    // the captured element until pointerup. Makes fast drags feel solid.
    (event.target as Element).setPointerCapture(event.pointerId);

    // Scale: SVG units per pixel. Use the CURRENT visible width, not a
    // fixed canvas width — that way dragging stays cursor-accurate even
    // when the view is zoomed in or out.
    const rect = svg.getBoundingClientRect();
    this.dragScale = this.viewWidth() / rect.width;

    this.dragStartPointerX = event.clientX;
    this.dragStartPointerY = event.clientY;
    this.dragStartGardenX = garden.position_x_ft;
    this.dragStartGardenY = garden.position_y_ft;

    this.draggingId.set(garden.id);
    this.dragX.set(garden.position_x_ft);
    this.dragY.set(garden.position_y_ft);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.draggingId()) return;

    const deltaPxX = event.clientX - this.dragStartPointerX;
    const deltaPxY = event.clientY - this.dragStartPointerY;

    const deltaSvgX = deltaPxX * this.dragScale;
    const deltaSvgY = deltaPxY * this.dragScale;

    // Snap to 1ft grid.
    const newX = Math.round(this.dragStartGardenX + deltaSvgX);
    const newY = Math.round(this.dragStartGardenY + deltaSvgY);

    this.dragX.set(newX);
    this.dragY.set(newY);
  }

  onPointerUp(_event: PointerEvent): void {
    const id = this.draggingId();
    if (!id) return;

    const finalX = this.dragX();
    const finalY = this.dragY();

    this.draggingId.set(null);

    // Only emit if the position actually changed.
    if (finalX !== this.dragStartGardenX || finalY !== this.dragStartGardenY) {
      this.positionChange.emit({
        gardenId: id,
        positionX: finalX,
        positionY: finalY,
      });
    }
  }
}
