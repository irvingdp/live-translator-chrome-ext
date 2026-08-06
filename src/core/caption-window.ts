export interface CaptionPair {
  id: string;
  original: string;
  translation: string;
}

// Owned by the background controller and sent whole to the content script on
// every change, so the overlay stays a pure renderer. Capacity is one caption
// row, and a row is one original line plus its translation.
export class CaptionWindow {
  private readonly entries = new Map<string, CaptionPair>();
  private readonly order: string[] = [];

  constructor(private capacity = 2) {}

  // A non-finite capacity would make `length > capacity` always false and
  // quietly leave the window unbounded, so it falls back to one row instead.
  setCapacity(capacity: number): void {
    this.capacity = Number.isFinite(capacity)
      ? Math.max(1, Math.round(capacity))
      : 1;
    this.trim();
  }

  upsertOriginal(id: string, original: string): void {
    const existing = this.entries.get(id);
    if (existing) {
      existing.original = original;
      return;
    }
    this.entries.set(id, { id, original, translation: '' });
    this.order.push(id);
    this.trim();
  }

  private trim(): void {
    while (this.order.length > this.capacity) {
      const dropped = this.order.shift();
      if (dropped !== undefined) this.entries.delete(dropped);
    }
  }

  upsertTranslation(id: string, translation: string): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    existing.translation = translation;
  }

  // Returns copies: the caller sends this straight into a chrome.runtime
  // message, and a shared mutable reference would let that payload keep
  // changing after it was sent.
  pairs(): CaptionPair[] {
    return this.order.flatMap((id) => {
      const entry = this.entries.get(id);
      return entry ? [{ ...entry }] : [];
    });
  }

  clear(): void {
    this.order.length = 0;
    this.entries.clear();
  }
}
