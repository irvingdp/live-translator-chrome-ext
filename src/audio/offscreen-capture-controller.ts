import type { TranscriptEvent } from '../core/transcript-stabilizer';
import { DeepgramSession } from '../providers/deepgram-session';
import { GeminiLiveSession } from '../providers/gemini-live-session';
import { Pcm16Chunker } from './pcm16-chunker';

const TRANSCRIPTION_SAMPLE_RATE = 16_000;

export interface AudioPipeline {
  readonly sampleRate: number;
  close(): Promise<void>;
  onEnded?(listener: () => void): () => void;
}

// A partial row update straight from the provider. Gemini's source and target
// streams arrive independently, so either field may fill an existing row.
export interface CaptionPairUpdate {
  id: string;
  original?: string;
  translation?: string;
}

export type CaptureEvent =
  | { kind: 'pairs'; updates: CaptionPairUpdate[] }
  | { event: TranscriptEvent; kind: 'transcript' };

export interface CaptureSession {
  readonly audioChunkMs: number;
  close(): void;
  connect(): Promise<void>;
  onDisconnect(listener: (code?: string) => void): () => void;
  onEvent(listener: (event: CaptureEvent) => void): () => void;
  sendAudio(audio: ArrayBuffer): boolean;
  updateMaxLineWidth?(maxLineWidth: number): void;
}

export type CaptureStartRequest = {
  sessionId: string;
  streamId: string;
} & (
  | { apiKey: string; language: string; provider: 'deepgram' }
  | {
      apiKey: string;
      maxLineWidth: number;
      provider: 'gemini';
      targetLanguage: string;
    }
);

export interface OffscreenCaptureDependencies {
  createPipeline(
    streamId: string,
    onSamples: (samples: Float32Array) => void,
  ): Promise<AudioPipeline>;
  createSession(request: CaptureStartRequest): CaptureSession;
  emitDisconnect(sessionId: string, code?: string): void;
  emitEvent(sessionId: string, event: CaptureEvent): void;
}

export class OffscreenCaptureController {
  private static readonly maxBufferedChunks = 25;
  private active?: ActiveCapture;
  private generation = 0;

  constructor(private readonly dependencies: OffscreenCaptureDependencies) {}

  async start(request: CaptureStartRequest): Promise<void> {
    const operation = ++this.generation;
    if (this.active) {
      const previous = this.active;
      this.active = undefined;
      await this.release(previous);
    }

    const session = this.dependencies.createSession(request);
    const capture: ActiveCapture = {
      connected: false,
      pendingAudio: [],
      pendingSamples: [],
      removeDisconnectListener: () => undefined,
      removeEventListener: () => undefined,
      session,
      sessionId: request.sessionId,
    };
    capture.removeEventListener = session.onEvent((event) =>
      this.dependencies.emitEvent(request.sessionId, event),
    );
    capture.removeDisconnectListener = session.onDisconnect((code) => {
      this.terminateUnexpected(capture, request.sessionId, code);
    });
    this.active = capture;

    try {
      const pipeline = await this.dependencies.createPipeline(
        request.streamId,
        (samples) => {
          if (!capture.chunker) {
            capture.pendingSamples.push(samples.slice());
            if (capture.pendingSamples.length > 50) capture.pendingSamples.shift();
            return;
          }
          this.forwardSamples(capture, samples);
        },
      );
      if (operation !== this.generation || this.active !== capture) {
        await pipeline.close();
        return;
      }
      capture.pipeline = pipeline;
      if (pipeline.sampleRate !== TRANSCRIPTION_SAMPLE_RATE) {
        throw new Error(
          `Unexpected audio sample rate: ${pipeline.sampleRate}`,
        );
      }
      capture.chunker = new Pcm16Chunker(
        pipeline.sampleRate,
        session.audioChunkMs,
      );
      for (const samples of capture.pendingSamples) {
        this.forwardSamples(capture, samples);
      }
      capture.pendingSamples.length = 0;
      capture.removePipelineEndedListener = pipeline.onEnded?.(() => {
        this.terminateUnexpected(capture, request.sessionId);
      });
      await session.connect();
      if (operation !== this.generation || this.active !== capture) return;
      capture.connected = true;
      for (const chunk of capture.pendingAudio) session.sendAudio(chunk);
      capture.pendingAudio.length = 0;
    } catch (error) {
      if (this.active === capture) this.active = undefined;
      await this.release(capture).catch(() => undefined);
      throw error;
    }
  }

  async stop(sessionId: string): Promise<void> {
    if (this.active && this.active.sessionId !== sessionId) return;
    this.generation += 1;
    const capture = this.active;
    this.active = undefined;
    if (capture) await this.release(capture);
  }

  updateMaxLineWidth(sessionId: string, maxLineWidth: number): void {
    if (!this.active || this.active.sessionId !== sessionId) return;
    this.active.session.updateMaxLineWidth?.(maxLineWidth);
  }

  private async release(capture: ActiveCapture): Promise<void> {
    const finalChunk = capture.chunker?.flush();
    if (finalChunk) capture.session.sendAudio(finalChunk);
    capture.removeEventListener();
    capture.removeDisconnectListener();
    capture.removePipelineEndedListener?.();
    try {
      await capture.pipeline?.close();
    } finally {
      capture.session.close();
    }
  }

  private forwardSamples(capture: ActiveCapture, samples: Float32Array): void {
    for (const chunk of capture.chunker?.push(samples) ?? []) {
      if (capture.connected) {
        capture.session.sendAudio(chunk);
      } else {
        capture.pendingAudio.push(chunk);
        if (
          capture.pendingAudio.length >
          OffscreenCaptureController.maxBufferedChunks
        ) {
          capture.pendingAudio.shift();
        }
      }
    }
  }

  private terminateUnexpected(
    capture: ActiveCapture,
    sessionId: string,
    code?: string,
  ): void {
    if (this.active !== capture) return;
    this.generation += 1;
    this.active = undefined;
    void this.release(capture)
      .catch(() => undefined)
      .finally(() => this.dependencies.emitDisconnect(sessionId, code));
  }
}

interface ActiveCapture {
  chunker?: Pcm16Chunker;
  connected: boolean;
  pendingAudio: ArrayBuffer[];
  pendingSamples: Float32Array[];
  pipeline?: AudioPipeline;
  removeDisconnectListener: () => void;
  removeEventListener: () => void;
  removePipelineEndedListener?: () => void;
  session: CaptureSession;
  sessionId: string;
}

export function createCaptureSession(
  request: CaptureStartRequest,
): CaptureSession {
  if (request.provider === 'gemini') {
    return new GeminiLiveSession({
      apiKey: request.apiKey,
      maxLineWidth: request.maxLineWidth,
      targetLanguage: request.targetLanguage,
    });
  }
  return new DeepgramSession({
    apiKey: request.apiKey,
    language: request.language,
  });
}
