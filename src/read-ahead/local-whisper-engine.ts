// The offscreen document's Local Whisper (issue #15): transformers.js on
// WebGPU. ONNX Runtime's WebAssembly is shipped with the extension (an
// extension page may not load code from a CDN) and imported directly: the
// extension's CSP does not allow the blob: module transformers.js would make
// of it. Separate from local-whisper.ts so nothing else pulls in the library.
import { env, pipeline } from '@huggingface/transformers';

import { ChunkTranslationError, type ChunkSentence } from './gemini-chunk-translation';
import {
  LOCAL_WHISPER_SPECS,
  localWhisperLanguage,
  sentencesFromChunks,
  type LocalWhisperModel,
  type TimestampedChunk,
} from './local-whisper';

const ORT_FILE = 'ort-wasm-simd-threaded.asyncify';

type Recognizer = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ chunks?: TimestampedChunk[]; text: string }>;

type Pipeline = Recognizer & { dispose?(): Promise<void> };

export interface DownloadProgress {
  loadedMB: number;
  totalMB: number;
}

export class LocalWhisperEngine {
  private loaded?: { model: LocalWhisperModel; ready: Promise<Pipeline> };

  constructor(ortBaseUrl: string) {
    env.allowLocalModels = false;
    env.useWasmCache = false;
    const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } };
    if (onnx.wasm) {
      onnx.wasm.wasmPaths = { mjs: `${ortBaseUrl}${ORT_FILE}.mjs`, wasm: `${ortBaseUrl}${ORT_FILE}.wasm` };
    }
  }

  // Loads `model` onto the GPU (downloading what the cache lacks), reporting
  // the download as it goes. One model is kept at a time.
  load(model: LocalWhisperModel, onProgress?: (progress: DownloadProgress) => void): Promise<Pipeline> {
    if (this.loaded?.model === model) return this.loaded.ready;
    void this.unload();
    const spec = LOCAL_WHISPER_SPECS[model];
    const files = new Map<string, { loaded: number; total: number }>();
    const ready = (pipeline('automatic-speech-recognition', spec.repository, {
      device: 'webgpu',
      dtype: spec.dtype,
      progress_callback: (event: { file?: string; loaded?: number; status?: string; total?: number }) => {
        if (event.status !== 'progress' || !event.file || !event.total) return;
        files.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
        const sum = (key: 'loaded' | 'total') =>
          Math.round([...files.values()].reduce((total, file) => total + file[key], 0) / 1e6);
        onProgress?.({ loadedMB: sum('loaded'), totalMB: sum('total') });
      },
    } as never) as unknown as Promise<Pipeline>);
    const entry = { model, ready };
    this.loaded = entry;
    ready.catch(() => {
      if (this.loaded === entry) this.loaded = undefined;
    });
    return ready;
  }

  async transcribe(
    model: LocalWhisperModel,
    audio: Float32Array,
    sourceLanguage?: string,
  ): Promise<{ sentences: ChunkSentence[] }> {
    let recognize: Pipeline;
    try {
      recognize = await this.load(model);
    } catch {
      throw new ChunkTranslationError('provider_unavailable');
    }
    const language = localWhisperLanguage(sourceLanguage);
    const result = await recognize(audio, {
      return_timestamps: 'word',
      task: 'transcribe',
      ...(language ? { language } : {}),
    });
    return { sentences: sentencesFromChunks(result.chunks ?? []) };
  }

  async unload(): Promise<void> {
    const loaded = this.loaded;
    this.loaded = undefined;
    const recognize = await loaded?.ready.catch(() => undefined);
    await recognize?.dispose?.().catch(() => undefined);
  }
}

// 16 kHz mono PCM16 WAV (encodeWav) → samples in [-1, 1].
export function samplesFromWavBase64(audioBase64: string): Float32Array {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const pcm = new Int16Array(bytes.buffer, 44, Math.floor((bytes.length - 44) / 2));
  return Float32Array.from(pcm, (value) => value / 32768);
}
