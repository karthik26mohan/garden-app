import { Component, inject, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PlantIdCandidate, PlantIdService } from '../plant-id.service';
import { PhotoService } from '../photo.service';

/** Payload emitted when the user confirms a candidate. */
export interface IdentificationResult {
  candidate: PlantIdCandidate;
  /** The resized JPEG that was sent to Pl@ntNet — ready for Storage upload. */
  photo: Blob;
}

type IdentifyState = 'idle' | 'identifying' | 'results' | 'error';

/**
 * Photo-identification widget for the add-plant form.
 *
 * Owns the capture → resize → Pl@ntNet → candidate-picking flow and
 * emits the user's choice; the PARENT (garden-detail) persists species,
 * plant, and photo. Keeping persistence out of here means this
 * component needs no Supabase access and stays trivially testable.
 *
 * Browser-only by construction: it renders inside garden-detail's
 * isPlatformBrowser-guarded content and reacts only to user events.
 */
@Component({
  selector: 'app-identify-plant',
  imports: [DecimalPipe],
  templateUrl: './identify-plant.html',
  styleUrl: './identify-plant.scss',
})
export class IdentifyPlant {
  private plantId = inject(PlantIdService);
  private photoService = inject(PhotoService);

  /** Fires when the user picks a candidate. Parent persists everything. */
  readonly confirmed = output<IdentificationResult>();

  readonly state = signal<IdentifyState>('idle');
  readonly candidates = signal<PlantIdCandidate[]>([]);
  readonly errorMessage = signal<string | null>(null);

  /** The resized photo from the most recent identification run. */
  private photo: Blob | null = null;

  /** True when the top candidate is below 10% confidence. */
  get lowConfidence(): boolean {
    const top = this.candidates()[0];
    return !!top && top.score < 0.1;
  }

  /** Template hook for the hidden file input's (change) event. */
  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (file) void this.onFileSelected(file);
  }

  /** Resize the chosen image and run identification. */
  async onFileSelected(file: File): Promise<void> {
    this.state.set('identifying');
    this.errorMessage.set(null);

    try {
      this.photo = await this.photoService.resizeImage(file);
      this.candidates.set(await this.plantId.identify(this.photo));
      this.state.set('results');
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Identification failed.');
      this.state.set('error');
    }
  }

  onPick(candidate: PlantIdCandidate): void {
    if (!this.photo) return;
    this.confirmed.emit({ candidate, photo: this.photo });
    this.onDismiss();
  }

  /** "None of these" / close — back to idle; the typed-name form is the fallback. */
  onDismiss(): void {
    this.state.set('idle');
    this.candidates.set([]);
    this.errorMessage.set(null);
    this.photo = null;
  }
}
