import { describe, expect, it } from 'vitest';

import {
  isModelCached,
  localWhisperLanguage,
  modelCacheUrls,
  sentencesFromChunks,
  wordsFromChunks,
} from '../../src/read-ahead/local-whisper';

const HF = 'https://huggingface.co/onnx-community';

describe('Local Whisper models', () => {
  const cached = [
    `${HF}/whisper-large-v3-turbo_timestamped/resolve/main/config.json`,
    `${HF}/whisper-large-v3-turbo_timestamped/resolve/main/onnx/encoder_model_q4f16.onnx`,
    `${HF}/whisper-large-v3-turbo_timestamped/resolve/main/onnx/decoder_model_merged_q4f16.onnx`,
    `${HF}/whisper-small_timestamped/resolve/main/onnx/encoder_model_fp16.onnx`,
  ];

  it('counts a model downloaded only when all its weights are cached', () => {
    expect(isModelCached('turbo', cached)).toBe(true);
    // small's decoder is missing: a download that stopped half way.
    expect(isModelCached('small', cached)).toBe(false);
  });

  it("deletes only that model's files", () => {
    expect(modelCacheUrls('small', cached)).toEqual([cached[3]]);
    expect(modelCacheUrls('turbo', cached)).toHaveLength(3);
  });
});

describe('sentencesFromChunks', () => {
  it("shapes transformers.js's word timestamps like Groq's", () => {
    const chunks = [
      { text: ' When', timestamp: [0.5, 0.8] as [number, number] },
      { text: ' I', timestamp: [0.8, 0.9] as [number, number] },
      { text: ' was', timestamp: [0.9, 1.1] as [number, number] },
      { text: ' 27.', timestamp: [1.1, 1.6] as [number, number] },
      { text: ' ', timestamp: [1.6, 1.7] as [number, number] },
      { text: ' I', timestamp: [2, null] as [number, number | null] },
    ];
    expect(wordsFromChunks(chunks).at(-1)).toEqual({ end: 2, start: 2, word: 'I' });
    expect(sentencesFromChunks(chunks).map((sentence) => [sentence.original, sentence.start, sentence.cut]))
      .toEqual([['When I was 27.', 0.5, false], ['I', 2, true]]);
  });

  it("gives Whisper the language's ISO 639-1 code, or nothing to detect it", () => {
    expect(localWhisperLanguage('zh-Hant')).toBe('zh');
    expect(localWhisperLanguage('en')).toBe('en');
    expect(localWhisperLanguage(undefined)).toBeUndefined();
  });
});
