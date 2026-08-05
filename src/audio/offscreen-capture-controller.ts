import type { TranscriptEvent } from '../core/transcript-stabilizer';
import {
  DeepgramSession,
  type DeepgramSessionConfig,
} from '../providers/deepgram-session';
import { Pcm16Chunker } from './pcm16-chunker';

export interface AudioPipeline {
  readonly sampleRate: number;
  close(): Promise<void>;
}

export interface TranscriptionSession {
  close(): void;
  connect(): Promise<void>;
  onTranscript(listener: (event: TranscriptEvent) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  sendAudio(audio: ArrayBuffer): boolean;
}

export interface CaptureStartRequest extends DeepgramSessionConfig {
  streamId: string;
}

export interface OffscreenCaptureDependencies {
  createPipeline(
    streamId: string,
    onSamples: (samples: Float32Array) => void,
  ): Promise<AudioPipeline>;
  createSession(config: DeepgramSessionConfig): TranscriptionSession;
  emitDisconnect(): void;
  emitTranscript(event: TranscriptEvent): void;
}

export class OffscreenCaptureController {
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
      removeDisconnectListener: () => undefined,
      removeTranscriptListener: () => undefined,
      session,
    };
    capture.removeTranscriptListener = session.onTranscript((event) =>
      this.dependencies.emitTranscript(event),
    );
    capture.removeDisconnectListener = session.onDisconnect(() => {
      if (this.active !== capture) return;
      this.generation += 1;
      this.active = undefined;
      void this.release(capture)
        .catch(() => undefined)
        .finally(() => this.dependencies.emitDisconnect());
    });
    this.active = capture;

    try {
      await session.connect();
      if (operation !== this.generation || this.active !== capture) return;

      const pipeline = await this.dependencies.createPipeline(
        request.streamId,
        (samples) => {
          for (const chunk of capture.chunker?.push(samples) ?? []) {
            session.sendAudio(chunk);
          }
        },
      );
      if (operation !== this.generation || this.active !== capture) {
        await pipeline.close();
        return;
      }
      capture.pipeline = pipeline;
      capture.chunker = new Pcm16Chunker(pipeline.sampleRate);
    } catch (error) {
      if (this.active === capture) this.active = undefined;
      await this.release(capture).catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
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
    try {
      await capture.pipeline?.close();
    } finally {
      capture.session.close();
    }
  }
}

interface ActiveCapture {
  chunker?: Pcm16Chunker;
  pipeline?: AudioPipeline;
  removeDisconnectListener: () => void;
  removeTranscriptListener: () => void;
  session: TranscriptionSession;
}

export function createDeepgramSession(
  config: DeepgramSessionConfig,
): TranscriptionSession {
  return new DeepgramSession(config);
}
