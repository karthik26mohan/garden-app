import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IdentifyPlant } from './identify-plant';
import { PlantIdError, PlantIdService } from '../plant-id.service';
import { PhotoService } from '../photo.service';

const CANDIDATES = [
  {
    scientificName: 'Lavandula angustifolia',
    commonNames: ['English lavender'],
    score: 0.87,
    thumbnailUrl: 'https://img/1',
  },
  {
    scientificName: 'Lavandula stoechas',
    commonNames: [],
    score: 0.05,
    thumbnailUrl: null,
  },
];

describe('IdentifyPlant', () => {
  const plantIdMock = { identify: vi.fn() };
  const photoMock = { resizeImage: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    photoMock.resizeImage.mockResolvedValue(new Blob(['resized']));
    await TestBed.configureTestingModule({
      imports: [IdentifyPlant],
      providers: [
        { provide: PlantIdService, useValue: plantIdMock },
        { provide: PhotoService, useValue: photoMock },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(IdentifyPlant);
    fixture.detectChanges();
    return fixture;
  }

  it('starts idle, showing only the identify button', () => {
    const fixture = create();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.identify-plant__trigger')).toBeTruthy();
    expect(el.querySelector('.identify-plant__candidates')).toBeFalsy();
  });

  it('shows candidates after a successful identification', async () => {
    plantIdMock.identify.mockResolvedValue(CANDIDATES);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('.identify-plant__candidate');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('English lavender');
    expect(cards[0].textContent).toContain('Lavandula angustifolia');
    expect(cards[0].textContent).toContain('87%');
    expect(photoMock.resizeImage).toHaveBeenCalled();
    expect(plantIdMock.identify).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('shows a low-confidence caveat when the top score is under 10%', async () => {
    plantIdMock.identify.mockResolvedValue([{ ...CANDIDATES[1] }]);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.identify-plant__low-confidence'),
    ).toBeTruthy();
  });

  it('shows a not-identified message when zero candidates come back', async () => {
    plantIdMock.identify.mockResolvedValue([]);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain("couldn't identify");
  });

  it('shows the error message when identification throws', async () => {
    plantIdMock.identify.mockRejectedValue(
      new PlantIdError('Daily identification limit reached', 429),
    );
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Daily identification limit reached',
    );
  });

  it('emits the chosen candidate with the resized photo', async () => {
    plantIdMock.identify.mockResolvedValue(CANDIDATES);
    const fixture = create();
    const emitted = vi.fn();
    fixture.componentInstance.confirmed.subscribe(emitted);

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.componentInstance.onPick(CANDIDATES[0]);

    expect(emitted).toHaveBeenCalledWith({
      candidate: CANDIDATES[0],
      photo: expect.any(Blob),
    });
  });

  it('runs identification from the file input change event', async () => {
    plantIdMock.identify.mockResolvedValue(CANDIDATES);
    const fixture = create();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      '.identify-plant__file-input',
    ) as HTMLInputElement;

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    expect(photoMock.resizeImage).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('resets to idle when the user dismisses the results', async () => {
    plantIdMock.identify.mockResolvedValue(CANDIDATES);
    const fixture = create();

    await fixture.componentInstance.onFileSelected(
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    fixture.componentInstance.onDismiss();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.identify-plant__candidates'),
    ).toBeFalsy();
  });
});
