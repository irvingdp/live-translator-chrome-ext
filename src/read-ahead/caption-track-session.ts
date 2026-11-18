// Read-ahead from a caption track (ADR 0007): the sentences are all known up
// front, so there is no audio to read and nothing to recognize. What is left
// of read-ahead is the translation (unless the target-language track already
// gave it) a batch at a time up to MAX_LEAD_SECONDS ahead, the cue timing, and
// the hold when the viewer reaches a sentence still being translated.
import type { CaptionSentence } from './caption-track';
import {
  MAX_LEAD_SECONDS,
  readAheadFailure,
  type DisplayedCue,
  type MainPlayer,
  type ReadAheadFailure,
  type ReadAheadStatus,
} from './read-ahead-session';

// One translation request covers the sentences starting within this long of
// its first one, and at most this many of them.
const BATCH_SECONDS = 15;
const MAX_BATCH_SENTENCES = 20;
const MAX_IN_FLIGHT = 2;
const CUE_LINGER_SECONDS = 1;
const HOLD_MARGIN_SECONDS = 0.15;

export interface CaptionTrackSessionDependencies {
  main: MainPlayer;
  sentences: CaptionSentence[];
  // The target-language track's lines, paired to `sentences`; or, with
  // `sameLanguage`, nothing to translate at all.
  translations?: string[];
  sameLanguage: boolean;
  showCue(cue: DisplayedCue | undefined): void;
  showStatus(status: ReadAheadStatus): void;
  // The page's translator, for a caption track with no target-language track.
  translate(texts: string[]): Promise<string[]>;
}

interface Entry extends CaptionSentence {
  failure?: ReadAheadFailure;
  id: string;
  state: 'failed' | 'idle' | 'pending' | 'ready';
  translation: string;
}

export class CaptionTrackSession {
  private readonly entries: Entry[];
  private holding = false;
  private resumeAfterHold = false;
  private expectedPauses = 0;
  private expectedPlays = 0;
  private inFlight = 0;
  private disposed = false;
  private shownCueId?: string;
  private shownStatus: ReadAheadStatus;

  constructor(private readonly dependencies: CaptionTrackSessionDependencies) {
    const given = dependencies.translations;
    const ready = dependencies.sameLanguage || Boolean(given);
    this.entries = [...dependencies.sentences]
      .sort((a, b) => a.start - b.start)
      .map((sentence, index) => ({
        ...sentence,
        id: `caption-track-${index}`,
        state: ready ? 'ready' : 'idle',
        translation: dependencies.sameLanguage ? '' : given?.[index] ?? '',
      }));
  }

  dispose(): void {
    this.disposed = true;
    if (this.holding && this.resumeAfterHold) this.dependencies.main.play();
    this.holding = false;
  }

  onMainPause(): void {
    if (this.expectedPauses > 0) {
      this.expectedPauses -= 1;
      return;
    }
    // A viewer pause, even during a hold, means "stay paused".
    this.resumeAfterHold = false;
    this.tick();
  }

  onMainPlay(): void {
    if (this.expectedPlays > 0) {
      this.expectedPlays -= 1;
      return;
    }
    this.resumeAfterHold = true;
    this.tick();
  }

  // Every sentence is known, so a seek needs nothing but the next tick, and
  // sentences that failed where the viewer is going are translated again (a
  // seek is the viewer asking again; playing on never retries one).
  onMainSeeking(): void {
    if (this.disposed) return;
    const time = this.dependencies.main.currentTime();
    for (const entry of this.entries) {
      if (entry.state === 'failed' && entry.end > time && entry.start - time < MAX_LEAD_SECONDS) {
        entry.state = 'idle';
        delete entry.failure;
      }
    }
    this.tick();
  }

  tick(): void {
    if (this.disposed) return;
    const { main } = this.dependencies;
    if (main.adPlaying()) {
      this.render(undefined, undefined);
      return;
    }
    const time = main.currentTime();
    this.issueBatches(time);
    this.updateHold(time);
    const current = this.entryAt(time);
    this.render(
      this.cueAt(time),
      this.holding
        ? 'translating'
        : current?.state === 'failed' ? current.failure ?? 'failed' : undefined,
    );
  }

  private issueBatches(time: number): void {
    while (this.inFlight < MAX_IN_FLIGHT) {
      const first = this.entries.find((entry) =>
        entry.end > time && entry.start - time < MAX_LEAD_SECONDS && entry.state === 'idle');
      if (!first) return;
      const from = this.entries.indexOf(first);
      const batch: Entry[] = [];
      for (let index = from; index < this.entries.length; index += 1) {
        const entry = this.entries[index]!;
        if (entry.state !== 'idle' || entry.start - first.start >= BATCH_SECONDS) break;
        if (batch.length === MAX_BATCH_SENTENCES) break;
        batch.push(entry);
      }
      for (const entry of batch) entry.state = 'pending';
      void this.translateBatch(batch);
    }
  }

  private async translateBatch(batch: Entry[]): Promise<void> {
    this.inFlight += 1;
    // One attempt only, like a chunk: a failed batch shows "翻譯失敗" with
    // the original line rather than holding the viewer again.
    let translations: string[] | undefined;
    let failure: ReadAheadFailure | undefined;
    try {
      translations = await this.dependencies.translate(batch.map((entry) => entry.original));
    } catch (error) {
      const reason = error instanceof Error ? error.message : undefined;
      failure = readAheadFailure(reason);
    }
    this.inFlight -= 1;
    if (this.disposed) return;
    batch.forEach((entry, index) => {
      if (translations) {
        entry.state = 'ready';
        entry.translation = translations[index] ?? '';
      } else {
        entry.state = 'failed';
        if (failure) entry.failure = failure;
      }
    });
    this.tick();
  }

  private updateHold(time: number): void {
    const { main } = this.dependencies;
    const upcoming = this.entryAt(time + HOLD_MARGIN_SECONDS);
    const ready = !upcoming || upcoming.state === 'ready' || upcoming.state === 'failed';
    if (!this.holding) {
      if (ready || main.paused()) return;
      this.holding = true;
      this.resumeAfterHold = true;
      this.pauseMain();
      return;
    }
    if (!ready) {
      // The viewer pressed play during the hold: keep holding, but resume
      // once the translation arrives.
      if (!main.paused()) this.pauseMain();
      return;
    }
    this.holding = false;
    if (this.resumeAfterHold && main.paused()) {
      this.expectedPlays += 1;
      main.play();
    }
  }

  private pauseMain(): void {
    this.expectedPauses += 1;
    this.dependencies.main.pause();
  }

  // The sentence being spoken at `time`.
  private entryAt(time: number): Entry | undefined {
    return this.entries.find((entry) => entry.start <= time && time < entry.end);
  }

  private cueAt(time: number): Entry | undefined {
    let found: Entry | undefined;
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]!;
      if (entry.start > time) break;
      const next = this.entries[index + 1];
      const end = Math.min(entry.end + CUE_LINGER_SECONDS, next ? next.start : Infinity);
      if (time < end && (entry.state === 'ready' || entry.state === 'failed')) found = entry;
    }
    return found;
  }

  private render(entry: Entry | undefined, status: ReadAheadStatus): void {
    if (entry?.id !== this.shownCueId) {
      this.shownCueId = entry?.id;
      this.dependencies.showCue(entry && {
        id: entry.id,
        original: entry.original,
        translation: entry.translation,
      });
    }
    if (status !== this.shownStatus) {
      this.shownStatus = status;
      this.dependencies.showStatus(status);
    }
  }
}
