import { describe, expect, it } from 'vitest';

import {
  chooseCaptionTracks,
  languageCodeOf,
  languageMatch,
  linesFromJson3,
  pairTranslations,
  sentencesFromLines,
  type CaptionTrackInfo,
} from '../../src/read-ahead/caption-track';

const uploaded = (language: string): CaptionTrackInfo => ({ generated: false, language });
const generated = (language: string): CaptionTrackInfo => ({ generated: true, language });
const line = (start: number, end: number, text: string) => ({ end, start, text });

describe('chooseCaptionTracks', () => {
  const tracks = [uploaded('zh-TW'), uploaded('en'), generated('en'), uploaded('zh-CN'), uploaded('ja')];

  it('takes the uploader track in the spoken language as the original, and one in the target language', () => {
    expect(chooseCaptionTracks(tracks, { spokenLanguage: 'en', targetLanguage: 'zh-Hant' })).toEqual({
      original: uploaded('en'),
      sameLanguage: false,
      target: uploaded('zh-TW'),
    });
    expect(chooseCaptionTracks(tracks, { spokenLanguage: 'en', targetLanguage: 'zh-Hans' })?.target)
      .toEqual(uploaded('zh-CN'));
  });

  it("takes Taiwan's Traditional Chinese over Hong Kong's, whichever YouTube lists first", () => {
    const listed = [uploaded('zh-HK'), uploaded('zh-TW'), uploaded('en'), uploaded('zh-SG'), uploaded('zh-CN')];
    expect(chooseCaptionTracks(listed, { spokenLanguage: 'en', targetLanguage: 'zh-Hant' })?.target)
      .toEqual(uploaded('zh-TW'));
    expect(chooseCaptionTracks(listed, { spokenLanguage: 'en', targetLanguage: 'zh-Hans' })?.target)
      .toEqual(uploaded('zh-CN'));
    expect(chooseCaptionTracks(listed, { spokenLanguage: 'en', targetLanguage: 'zh-HK' })?.target)
      .toEqual(uploaded('zh-HK'));
    expect(chooseCaptionTracks([uploaded('en'), uploaded('zh-TW')], { spokenLanguage: 'en', targetLanguage: 'zh-HK' })?.target)
      .toEqual(uploaded('zh-TW'));
    // Hong Kong's is still used when it is the only Traditional one.
    expect(chooseCaptionTracks([uploaded('en'), uploaded('zh-HK')], {
      spokenLanguage: 'en',
      targetLanguage: 'zh-Hant',
    })?.target).toEqual(uploaded('zh-HK'));
  });

  it("prefers the viewer's source language over what the site says is spoken", () => {
    expect(chooseCaptionTracks(tracks, { sourceLanguage: 'ja', spokenLanguage: 'en', targetLanguage: 'en' }))
      .toEqual({ original: uploaded('ja'), sameLanguage: false, target: uploaded('en') });
  });

  it('has no original without a spoken language, or with only a generated track in it', () => {
    expect(chooseCaptionTracks(tracks, { targetLanguage: 'zh-Hant' })).toBeUndefined();
    expect(chooseCaptionTracks([generated('en'), uploaded('zh-TW')], {
      spokenLanguage: 'en',
      targetLanguage: 'zh-Hant',
    })).toBeUndefined();
  });

  it('leaves out a target track in the other Chinese script, and marks speech already in the target', () => {
    expect(chooseCaptionTracks([uploaded('en'), uploaded('zh-CN')], {
      spokenLanguage: 'en',
      targetLanguage: 'zh-Hant',
    })).toEqual({ original: uploaded('en'), sameLanguage: false });
    expect(chooseCaptionTracks([uploaded('en-GB')], { spokenLanguage: 'en', targetLanguage: 'en' }))
      .toEqual({ original: uploaded('en-GB'), sameLanguage: true });
  });
});

describe('language codes', () => {
  it('matches regions and old codes, but not the other Chinese script', () => {
    expect(languageMatch('en', 'en')).toBe(4);
    expect(languageMatch('en-GB', 'en')).toBe(1);
    expect(languageMatch('iw', 'he')).toBe(2);
    expect(languageMatch('zh-HK', 'zh-Hant')).toBe(2);
    expect(languageMatch('zh-HK', 'zh-HK')).toBe(4);
    expect(languageMatch('zh-TW', 'zh-Hant')).toBe(3);
    expect(languageMatch('zh-TW', 'zh-Hans')).toBe(0);
    expect(languageMatch('zh', 'zh-Hans')).toBe(1);
  });

  it("names a track's language the way the translators take it", () => {
    expect(languageCodeOf('zh-TW')).toBe('zh-Hant');
    expect(languageCodeOf('zh-CN')).toBe('zh-Hans');
    expect(languageCodeOf('iw')).toBe('he');
    expect(languageCodeOf('en-GB')).toBe('en');
    expect(languageCodeOf('pt-BR')).toBe('pt-BR');
  });
});

describe('linesFromJson3', () => {
  it("reads YouTube's events, joining wrapped lines and skipping empty ones", () => {
    expect(linesFromJson3({
      events: [
        { dDurationMs: 373000, id: 1, tStartMs: 0 },
        { dDurationMs: 3300, segs: [{ utf8: 'I left a very demanding job\nin management consulting' }], tStartMs: 14963 },
        { dDurationMs: 500, segs: [{ utf8: '\n' }], tStartMs: 18000 },
        { dDurationMs: 2067, segs: [{ utf8: 'When I was ' }, { utf8: '27 years old,' }], tStartMs: 12863 },
      ],
    })).toEqual([
      line(12.863, 12.863 + 2.067, 'When I was 27 years old,'),
      line(14.963, 14.963 + 3.3, 'I left a very demanding job in management consulting'),
    ]);
    expect(linesFromJson3('nonsense')).toEqual([]);
  });
});

describe('sentencesFromLines', () => {
  it('joins lines up to a sentence ender', () => {
    expect(sentencesFromLines([
      line(12.9, 14.9, 'When I was 27 years old,'),
      line(15, 18.2, 'I left a very demanding job'),
      line(18.3, 22, 'for teaching.'),
      line(23.3, 25.7, 'I went to teach math.'),
    ])).toEqual([
      { end: 22, original: 'When I was 27 years old, I left a very demanding job for teaching.', start: 12.9 },
      { end: 25.7, original: 'I went to teach math.', start: 23.3 },
    ]);
  });

  it('cuts at 15 s or a long silence without one, and joins Chinese without spaces', () => {
    const long = Array.from({ length: 6 }, (_, index) => line(index * 3, index * 3 + 3, `part ${index}`));
    expect(sentencesFromLines(long).map((sentence) => [sentence.start, sentence.end]))
      .toEqual([[0, 15], [15, 18]]);
    expect(sentencesFromLines([line(0, 2, 'one'), line(5, 6, 'two')]).map((s) => s.original))
      .toEqual(['one', 'two']);
    expect(sentencesFromLines([line(0, 2, '我 27 歲的時候，'), line(2, 4, '辭去了工作。')])[0]!.original)
      .toBe('我 27 歲的時候，辭去了工作。');
  });
});

describe('pairTranslations', () => {
  it('gives each translation line to the sentence it overlaps most, each line once', () => {
    const sentences = [
      { end: 22, original: 'A', start: 12.9 },
      { end: 25.7, original: 'B', start: 23.3 },
      { end: 40, original: 'C', start: 35 },
    ];
    expect(pairTranslations(sentences, [
      line(12.7, 15, '我 27 歲的時候，'),
      line(15, 18, '辭去了工作，'),
      line(18, 22.8, '去教書。'),
      line(22.8, 25.8, '我教數學。'),
      line(40.5, 41, '晚到的一句'),
      line(50, 52, '沒有對應的句子'),
    ])).toEqual(['我 27 歲的時候，辭去了工作，去教書。', '我教數學。', '晚到的一句']);
  });
});
