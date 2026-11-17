import { describe, expect, it } from 'vitest';

import { isWideCharacter, splitIntoSentences } from '../../src/core/sentence-splitter';

const texts = (text: string) => splitIntoSentences(text).map((span) => span.text);

describe('splitIntoSentences', () => {
  it('splits at sentence enders and trims the spaces between', () => {
    expect(texts('Hello there.  How are you? Fine!')).toEqual(['Hello there.', 'How are you?', 'Fine!']);
  });

  it('keeps an unfinished tail as its own sentence', () => {
    expect(texts('Done. And then')).toEqual(['Done.', 'And then']);
  });

  it('does not split a decimal number or a dotted hostname', () => {
    expect(texts('Numbers: 3.14 and 2.71 matter.')).toEqual(['Numbers: 3.14 and 2.71 matter.']);
    expect(texts('Go to example.com now.')).toEqual(['Go to example.com now.']);
  });

  it('still splits an initialism followed by whitespace, as an accepted limitation', () => {
    expect(texts('U.S. policy changed.')).toEqual(['U.S.', 'policy changed.']);
  });

  it('splits at every CJK sentence-ending mark, with or without a following space', () => {
    expect(texts('早安。今天天氣真好！你決定要出門嗎？')).toEqual(['早安。', '今天天氣真好！', '你決定要出門嗎？']);
  });

  it('keeps a run of enders and a closing quote with the sentence they end', () => {
    expect(texts('He said "stop!" Then left?! Ok')).toEqual(['He said "stop!"', 'Then left?!', 'Ok']);
  });

  it('reports offsets into the untrimmed text', () => {
    const text = '  One.  Two.';
    for (const span of splitIntoSentences(text)) {
      expect(text.slice(span.start, span.end)).toBe(span.text);
    }
  });
});

describe('isWideCharacter', () => {
  it('treats CJK and full-width forms as wide and Latin as narrow', () => {
    expect(isWideCharacter('中')).toBe(true);
    expect(isWideCharacter('。')).toBe(true);
    expect(isWideCharacter('한')).toBe(true);
    expect(isWideCharacter('a')).toBe(false);
  });
});
