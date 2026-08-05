import { describe, expect, it } from 'vitest';

import {
  DeepgramMessageParser,
  buildDeepgramUrl,
  deepgramProtocols,
} from '../../src/providers/deepgram';

describe('buildDeepgramUrl', () => {
  it('configures Nova-3 for low-latency PCM interim captions', () => {
    const url = new URL(buildDeepgramUrl('en-US'));

    expect(url.origin + url.pathname).toBe(
      'wss://api.deepgram.com/v1/listen',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      channels: '1',
      encoding: 'linear16',
      endpointing: '200',
      interim_results: 'true',
      language: 'en-US',
      model: 'nova-3',
      punctuate: 'true',
      sample_rate: '16000',
      smart_format: 'true',
      utterance_end_ms: '1000',
      vad_events: 'true',
    });
  });

  it('keeps BYOK credentials out of the URL and uses WebSocket subprotocols', () => {
    expect(buildDeepgramUrl('en-US')).not.toContain('secret');
    expect(deepgramProtocols('secret')).toEqual(['token', 'secret']);
  });
});

describe('DeepgramMessageParser', () => {
  it('turns successive result messages into revisioned transcript events', () => {
    const parser = new DeepgramMessageParser();
    const message = (text: string, isFinal = false) =>
      JSON.stringify({
        channel: { alternatives: [{ transcript: text }] },
        is_final: isFinal,
        request_id: 'request-1',
        start: 1.25,
        type: 'Results',
      });

    expect(parser.parse(message('Good morning'))).toEqual({
      isFinal: false,
      revision: 1,
      segmentId: 'request-1:1.250',
      text: 'Good morning',
    });
    expect(parser.parse(message('Good morning everyone', true))).toEqual({
      isFinal: true,
      revision: 2,
      segmentId: 'request-1:1.250',
      text: 'Good morning everyone',
    });
  });

  it('ignores empty transcripts and non-result protocol messages', () => {
    const parser = new DeepgramMessageParser();

    expect(
      parser.parse(
        JSON.stringify({
          channel: { alternatives: [{ transcript: '' }] },
          start: 0,
          type: 'Results',
        }),
      ),
    ).toBeUndefined();
    expect(parser.parse(JSON.stringify({ type: 'Metadata' }))).toBeUndefined();
  });

  it('ignores malformed JSON instead of crashing the audio session', () => {
    expect(new DeepgramMessageParser().parse('not-json')).toBeUndefined();
  });
});
