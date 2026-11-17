// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CAPTION_MESSAGE_SOURCE,
  installCaptionTap,
  spokenLanguageOf,
  type CaptionTapToContentMessage,
} from '../../src/read-ahead/youtube-caption-tap';

const json3 = (texts: Array<[number, string]>) => JSON.stringify({
  events: texts.map(([start, text]) => ({ dDurationMs: 2000, segs: [{ utf8: text }], tStartMs: start })),
});

const TRACK_BODIES: Record<string, string> = {
  en: json3([[0, 'Hello there.'], [3000, 'Bye.']]),
  'zh-TW': json3([[0, '你好。'], [3000, '再見。']]),
};

// A stand-in for YouTube's player: choosing a track downloads it by XHR, the
// way the real one does (with a token this test never sees or makes).
function fakePlayer(videoId: string, current: Record<string, unknown> | undefined) {
  const player = document.createElement('div') as HTMLDivElement & Record<string, unknown>;
  player.id = 'movie_player';
  let track = current;
  const download = (language: string) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${language}&fmt=json3&pot=x`);
    Object.defineProperty(xhr, 'responseText', { value: TRACK_BODIES[language] ?? '' });
    xhr.dispatchEvent(new Event('load'));
  };
  player.getPlayerResponse = () => ({
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: 'en', vssId: '.en' },
          { kind: 'asr', languageCode: 'en', vssId: 'a.en' },
          { languageCode: 'zh-TW', vssId: '.zh-TW' },
        ],
      },
    },
    videoDetails: { videoId },
  });
  player.getOption = () => track;
  player.loadModule = vi.fn();
  player.setOption = vi.fn((_module: string, option: string, value: Record<string, unknown>) => {
    if (option === 'reload') {
      if (track?.languageCode) setTimeout(() => download(String(track!.languageCode)));
      return;
    }
    track = value;
    if (value.languageCode) setTimeout(() => download(String(value.languageCode)));
  });
  document.body.append(player);
  return player;
}

function ask(videoId: string, targetLanguage: string): Promise<CaptionTapToContentMessage> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.source !== CAPTION_MESSAGE_SOURCE || event.data.type !== 'tracks') return;
      window.removeEventListener('message', onMessage);
      resolve(event.data as CaptionTapToContentMessage);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({
      requestId: 'r1', source: CAPTION_MESSAGE_SOURCE, targetLanguage, type: 'request', videoId,
    }, '*');
  });
}

installCaptionTap(window);

afterEach(() => document.getElementById('movie_player')?.remove());

describe('installCaptionTap', () => {
  // jsdom's postMessage sets no source window; the tap checks it.
  vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => {
    window.dispatchEvent(new MessageEvent('message', { data: message, source: window }));
  });

  it("reads the uploader tracks the player downloads, then puts the viewer's choice back", async () => {
    const viewerTrack = { languageCode: 'en', vss_id: 'a.en', kind: 'asr' };
    const player = fakePlayer('vid1', viewerTrack);

    const reply = await ask('vid1', 'zh-Hant');

    expect(reply.original).toEqual({
      language: 'en',
      lines: [{ end: 2, start: 0, text: 'Hello there.' }, { end: 5, start: 3, text: 'Bye.' }],
    });
    expect(reply.target?.lines.map((line) => line.text)).toEqual(['你好。', '再見。']);
    expect(reply.sameLanguage).toBe(false);
    // The spoken language came from YouTube's generated track; the uploader's
    // track was chosen, and the viewer's generated track restored.
    expect(player.setOption).toHaveBeenCalledWith('captions', 'track', { languageCode: 'en', vss_id: '.en' });
    expect(vi.mocked(player.setOption as () => void).mock.calls.at(-1)).toEqual(['captions', 'track', viewerTrack]);
  });

  it('reloads a track already showing, and turns captions back off when they were off', async () => {
    const player = fakePlayer('vid2', { languageCode: 'en', vss_id: '.en' });
    const reply = await ask('vid2', 'en');
    expect(reply).toMatchObject({ original: { language: 'en' }, sameLanguage: true });
    expect(player.setOption).toHaveBeenCalledWith('captions', 'reload', true);

    document.getElementById('movie_player')?.remove();
    const off = fakePlayer('vid3', undefined);
    await ask('vid3', 'en');
    expect(vi.mocked(off.setOption as () => void).mock.calls.at(-1)).toEqual(['captions', 'track', {}]);
  });

  it('answers with nothing when the player shows another video or has no usable track', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      fakePlayer('other', undefined);
      const reply = ask('vid4', 'zh-Hant');
      await vi.advanceTimersByTimeAsync(3000);
      expect((await reply).original).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('spokenLanguageOf', () => {
  it("takes the default audio track's language, not the first of a dubbed video's recognition tracks", () => {
    expect(spokenLanguageOf({
      audioTracks: [{ audioTrackId: 'fr-FR.10' }, { audioTrackId: 'en-US.4' }],
      captionTracks: [{ kind: 'asr', languageCode: 'ja' }, { kind: 'asr', languageCode: 'en' }],
      defaultAudioTrackIndex: 1,
    })).toBe('en-US');
  });

  it('uses the one recognition track of an undubbed video, and gives up with several', () => {
    expect(spokenLanguageOf({ captionTracks: [{ languageCode: 'zh-TW' }, { kind: 'asr', languageCode: 'en' }] }))
      .toBe('en');
    expect(spokenLanguageOf({
      captionTracks: [{ kind: 'asr', languageCode: 'ja' }, { kind: 'asr', languageCode: 'en' }],
    })).toBeUndefined();
  });
});
