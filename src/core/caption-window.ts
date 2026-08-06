export interface CaptionPair {
  id: string;
  original: string;
  translation: string;
}

const maxPairs = 2;

// Owned by the background controller and sent whole to the content script on
// every change, so the overlay stays a pure renderer of at most two pairs.
export class CaptionWindow {
  private readonly entries = new Map<string, CaptionPair>();
  private readonly order: string[] = [];

  upsertOriginal(id: string, original: string): void {
    const existing = this.entries.get(id);
    if (existing) {
      existing.original = original;
      return;
    }
    this.entries.set(id, { id, original, translation: '' });
    this.order.push(id);
    while (this.order.length > maxPairs) {
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
