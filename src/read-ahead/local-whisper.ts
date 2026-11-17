// Local Whisper (GLOSSARY.md, issue #15): read-ahead recognition on the
// viewer's own computer, in the offscreen document, with transformers.js on
// WebGPU. The models are downloaded once from Hugging Face (only after the
// viewer confirms the size) and kept in the extension's Cache Storage. This
// module holds what both sides agree on: the models, where they are cached,
// and how transformers.js's word timestamps become read-ahead sentences.
import type { ChunkSentence } from './gemini-chunk-translation';
import { sentencesFromWords, type GroqWord } from './groq-transcription';

export const LOCAL_WHISPER_MODEL_IDS = ['turbo', 'small'] as const;
export type LocalWhisperModel = (typeof LOCAL_WHISPER_MODEL_IDS)[number];

export interface LocalWhisperSpec {
  // Precision per part; measured on 2026-11-17 (ADR 0004).
  dtype: { decoder_model_merged: string; encoder_model: string };
  // Megabytes downloaded, shown before the viewer agrees to it.
  downloadMB: number;
  // The model's files as transformers.js caches them.
  files: string[];
  // A Hugging Face repository with word-timestamp (cross-attention) exports.
  repository: string;
}

export const LOCAL_WHISPER_SPECS: Record<LocalWhisperModel, LocalWhisperSpec> = {
  small: {
    dtype: { decoder_model_merged: 'q4f16', encoder_model: 'fp16' },
    downloadMB: 325,
    files: ['onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4f16.onnx'],
    repository: 'onnx-community/whisper-small_timestamped',
  },
  turbo: {
    dtype: { decoder_model_merged: 'q4f16', encoder_model: 'q4f16' },
    downloadMB: 566,
    files: ['onnx/encoder_model_q4f16.onnx', 'onnx/decoder_model_merged_q4f16.onnx'],
    repository: 'onnx-community/whisper-large-v3-turbo_timestamped',
  },
};

// transformers.js keeps downloaded files in this Cache Storage cache, keyed by
// their Hugging Face URL.
export const LOCAL_WHISPER_CACHE = 'transformers-cache';

// chrome.storage.session key of the download in progress, for the popup.
export const LOCAL_WHISPER_DOWNLOAD_KEY = 'localWhisperDownload';

// A download not heard of for this long has stopped (the offscreen document
// was closed, or the browser restarted).
export const DOWNLOAD_STALL_MS = 120_000;

export function downloadInProgress(
  download: { state: string; updatedAt?: number } | undefined,
  now: number,
): boolean {
  return download?.state === 'downloading' && now - (download.updatedAt ?? 0) < DOWNLOAD_STALL_MS;
}

// Whether every weight file of `model` is among the cached request URLs.
export function isModelCached(model: LocalWhisperModel, cachedUrls: string[]): boolean {
  const { files, repository } = LOCAL_WHISPER_SPECS[model];
  return files.every((file) =>
    cachedUrls.some((url) => url.includes(`/${repository}/`) && url.endsWith(`/${file}`)));
}

// The cached URLs that belong to `model`, for deleting it.
export function modelCacheUrls(model: LocalWhisperModel, cachedUrls: string[]): string[] {
  const { repository } = LOCAL_WHISPER_SPECS[model];
  return cachedUrls.filter((url) => url.includes(`/${repository}/`));
}

// One word of transformers.js's output with return_timestamps: 'word'.
export interface TimestampedChunk {
  text: string;
  timestamp: [number, number | null];
}

// Words as the Whisper shaping (groq-transcription) takes them. A word with no
// end (the last one, sometimes) ends where it starts.
export function wordsFromChunks(chunks: TimestampedChunk[]): GroqWord[] {
  return chunks
    .filter((chunk) => typeof chunk.text === 'string' && chunk.text.trim() !== '')
    .map((chunk) => {
      const [start, end] = chunk.timestamp;
      return { end: end ?? start, start, word: chunk.text.trim() };
    });
}

export function sentencesFromChunks(chunks: TimestampedChunk[]): ChunkSentence[] {
  return sentencesFromWords(wordsFromChunks(chunks));
}

// What Whisper takes as the spoken language: the ISO 639-1 part of the
// extension's code ('zh-Hant' → 'zh'), or nothing to let it detect.
export function localWhisperLanguage(sourceLanguage: string | undefined): string | undefined {
  return sourceLanguage ? sourceLanguage.split('-')[0]!.toLowerCase() : undefined;
}
