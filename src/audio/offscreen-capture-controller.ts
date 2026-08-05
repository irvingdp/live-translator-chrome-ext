import type { TranscriptEvent } from '../core/transcript-stabilizer';
import {
  DeepgramSession,
  type DeepgramSessionConfig,
} from '../providers/deepgram-session';
import { Pcm16Chunker } from './pcm16-chunker';

export interface AudioPipeline {
  readonly sampleRate: number;
  close(): Promise<void>;
  onEnded?(listener: () => void): () => void;
}

export interface TranscriptionSession {
  close(): void;
  connect(): Promise<void>;
  onTranscript(listener: (event: TranscriptEvent) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  sendAudio(audio: ArrayBuffer): boolean;
}

export interface CaptureStartRequest extends DeepgramSessionConfig {
  sessionId: string;
  streamId: string;
}

export interface OffscreenCaptureDependencies {
  createPipeline(
    streamId: string,
    onSamples: (samples: Float32Array) => void,
  ): Promise<AudioPipeline>;
  createSession(config: DeepgramSessionConfig): TranscriptionSession;
  emitDisconnect(sessionId: string): void;
  emitTranscript(sessionId: string, event: TranscriptEvent): void;
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

    const session = this.dependencies.createSession({
      apiKey: request.apiKey,
      language: request.language,
    });
    const capture: ActiveCapture = {
      connected: false,
      pendingAudio: [],
      pendingSamples: [],
      removeDisconnectListener: () => undefined,
      removeTranscriptListener: () => undefined,
      session,
      sessionId: request.sessionId,
    };
    capture.removeTranscriptListener = session.onTranscript((event) =>
      this.dependencies.emitTranscript(request.sessionId, event),
    );
    capture.removeDisconnectListener = session.onDisconnect(() => {
      this.terminateUnexpected(capture, request.sessionId);
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
      capture.chunker = new Pcm16Chunker(pipeline.sampleRate);
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

  private async release(capture: ActiveCapture): Promise<void> {
    const finalChunk = capture.chunker?.flush();
    if (finalChunk) capture.session.sendAudio(finalChunk);
    capture.removeTranscriptListener();
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

  private terminateUnexpected(capture: ActiveCapture, sessionId: string): void {
    if (this.active !== capture) return;
    this.generation += 1;
    this.active = undefined;
    void this.release(capture)
      .catch(() => undefined)
      .finally(() => this.dependencies.emitDisconnect(sessionId));
  }
}

interface ActiveCapture {
  chunker?: Pcm16Chunker;
  connected: boolean;
  pendingAudio: ArrayBuffer[];
  pendingSamples: Float32Array[];
  pipeline?: AudioPipeline;
  removeDisconnectListener: () => void;
  removePipelineEndedListener?: () => void;
  removeTranscriptListener: () => void;
  session: TranscriptionSession;
  sessionId: string;
}

export function createDeepgramSession(
  config: DeepgramSessionConfig,
): TranscriptionSession {
  return new DeepgramSession(config);
}
