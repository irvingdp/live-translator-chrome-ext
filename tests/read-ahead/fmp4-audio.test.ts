import { describe, expect, it } from 'vitest';

import { isInitSegment, parseFragments, parseInitSegment } from '../../src/read-ahead/fmp4-audio';
import { aacInit, fragment } from './fmp4-fixtures';

describe('fMP4 audio', () => {
  it("reads an init segment's audio track: AAC-LC 48 kHz stereo, its config and timescale", () => {
    const init = parseInitSegment(aacInit());
    expect(init).toMatchObject({
      kind: 'audio',
      track: { channels: 2, codec: 'mp4a.40.2', sampleRate: 48_000, timescale: 48_000, trackId: 2 },
    });
    expect(init.kind === 'audio' && [...init.track.description!]).toEqual([0x11, 0x90]);
    expect(isInitSegment(aacInit())).toBe(true);
    expect(isInitSegment(fragment(2, 0, [4]))).toBe(false);
  });

  it('decodes HE-AAC as its AAC-LC core, which also reads AAC-LC that a player labelled HE-AAC', () => {
    const lc = (asc: number[]) => {
      const init = parseInitSegment(aacInit({ asc }));
      if (init.kind !== 'audio') throw new Error('no track');
      return { channels: init.track.channels, codec: init.track.codec, description: [...init.track.description!], sampleRate: init.track.sampleRate };
    };
    // hls.js on one site: HE-AAC claimed at 48 kHz core and 48 kHz extension,
    // while the frames are plain AAC-LC at 48 kHz (1024 samples each).
    expect(lc([0x29, 0x91, 0x88, 0x00])).toEqual({ channels: 2, codec: 'mp4a.40.2', description: [0x11, 0x90], sampleRate: 48_000 });
    // Real HE-AAC: 24 kHz core, 48 kHz with SBR. The core is enough for 16 kHz.
    expect(lc([0x2b, 0x11, 0x88])).toEqual({ channels: 2, codec: 'mp4a.40.2', description: [0x13, 0x10], sampleRate: 24_000 });
    // HE-AAC v2 (parametric stereo): a mono core.
    expect(lc([0xeb, 0x09, 0x88])).toEqual({ channels: 1, codec: 'mp4a.40.2', description: [0x13, 0x08], sampleRate: 24_000 });
  });

  it('says when the audio is encrypted (DRM), or in a codec it does not read', () => {
    expect(parseInitSegment(aacInit({ entry: 'enca' }))).toEqual({ kind: 'encrypted' });
    expect(parseInitSegment(aacInit({ entry: 'ac-3' }))).toEqual({ codec: 'ac-3', kind: 'none' });
  });

  it('times each frame of a fragment from tfdt and trun, skipping other tracks', () => {
    const init = parseInitSegment(aacInit());
    if (init.kind !== 'audio') throw new Error('no track');
    const start = Math.round(179.99 * 48_000);
    const bytes = new Uint8Array([...fragment(1, 0, [9, 9]), ...fragment(2, start, [3, 5])]);
    expect(parseFragments(bytes, init.track).map((frame) => [+frame.timestamp.toFixed(4), [...frame.data]])).toEqual([
      [179.99, [1, 1, 1]],
      [+((start + 1024) / 48_000).toFixed(4), [2, 2, 2, 2, 2]],
    ]);
  });

  it('ignores what it cannot read rather than throwing', () => {
    const init = parseInitSegment(aacInit());
    if (init.kind !== 'audio') throw new Error('no track');
    expect(parseInitSegment(new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]))).toEqual({ kind: 'none' });
    expect(parseFragments(new Uint8Array([0, 0, 0, 3]), init.track)).toEqual([]);
  });
});
