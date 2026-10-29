export type Locale = 'en' | 'zh-TW';

export type CaptionLine = { source: string; translation: string };

export type Copy = {
  hook: string;
  oneClick: string;
  live: string;
  follow: string;
  tagline: string;
  cta: string;
  realProduct: string;
  sourceLabel: string;
  targetLabel: string;
  start: string;
  running: string;
  idle: string;
  tabs: [string, string];
  firstTab: CaptionLine[];
  secondTab: CaptionLine[];
};

// Both cuts demo Chinese <-> English. The English cut translates Chinese into
// English and the Chinese cut the reverse, so each audience reads its own language.
export const COPY: Record<Locale, Copy> = {
  en: {
    hook: "Watching something in a language you don't speak?",
    oneClick: 'One click to start.',
    live: 'The original line and its translation, live.',
    follow: 'Switch tabs. Captions follow.',
    tagline: 'Live bilingual captions for any tab.',
    cta: 'Add to Chrome — free',
    realProduct: 'The real extension, on a real talk',
    sourceLabel: 'Auto-detect',
    targetLabel: 'English',
    start: 'Start live captions',
    running: 'Running',
    idle: 'Idle',
    tabs: ['Tokyo Market Walk', 'How It Works — Lecture'],
    firstTab: [
      {
        source: '今天，我們一起逛逛東京的一個小市場。',
        translation: "Today, let's take a walk through a small market in Tokyo.",
      },
      {
        source: '從一大早開始，攤位上就擺滿了新鮮的魚。',
        translation: 'From early morning, the stalls are full of fresh fish.',
      },
    ],
    secondTab: [
      {
        source: '接下來，我會說明這項技術實際上是怎麼運作的。',
        translation: "Next, I'll explain how this technology actually works.",
      },
    ],
  },
  'zh-TW': {
    hook: '看外語影片，卻聽不懂？',
    oneClick: '一鍵開始。',
    live: '原文與譯文，即時並排。',
    follow: '換分頁，字幕跟著走。',
    tagline: '任何分頁都能顯示即時雙語字幕。',
    cta: '免費加到 Chrome',
    realProduct: '真實擴充功能的實際畫面',
    sourceLabel: '自動偵測',
    targetLabel: '繁體中文',
    start: '開始即時字幕',
    running: '執行中',
    idle: '閒置',
    tabs: ['Tokyo Market Walk', 'How It Works — Lecture'],
    firstTab: [
      {
        source: "Today, let's take a walk through a small market in Tokyo.",
        translation: '今天，我們一起逛逛東京的一個小市場。',
      },
      {
        source: 'From early morning, the stalls are full of fresh fish.',
        translation: '從一大早開始，攤位上就擺滿了新鮮的魚。',
      },
    ],
    secondTab: [
      {
        source: "Next, I'll explain how this technology actually works.",
        translation: '接下來，我會說明這項技術實際上是怎麼運作的。',
      },
    ],
  },
};
