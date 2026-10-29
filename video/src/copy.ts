export type Locale = 'en' | 'zh-TW';

export type CaptionLine = { source: string; translation: string };

export type Copy = {
  hook: string;
  oneClick: string;
  live: string;
  sidebar: string;
  tagline: string;
  cta: string;
  realProduct: string;
  sourceLabel: string;
  targetLabel: string;
  start: string;
  running: string;
  idle: string;
  tab: string;
  captionLabel: string;
  panelTitle: string;
  historyTitle: string;
  // Two lines shown in the floating captions, then a third that arrives
  // after switching to the side panel.
  lines: [CaptionLine, CaptionLine, CaptionLine];
};

// Demo lines follow a MacBook Pro launch film. Both cuts demo Chinese <-> English. The English cut translates Chinese into
// English and the Chinese cut the reverse, so each audience reads its own language.
export const COPY: Record<Locale, Copy> = {
  en: {
    hook: "Watching something in a language you don't speak?",
    oneClick: 'One click to start.',
    live: 'The original line and its translation, live.',
    sidebar: 'Open the side panel for the full history.',
    tagline: 'Live bilingual captions for any tab.',
    cta: 'Add to Chrome — free',
    realProduct: 'The real extension, on a real talk',
    sourceLabel: 'Auto-detect',
    targetLabel: 'English',
    start: 'Start live captions',
    running: 'Running',
    idle: 'Idle',
    tab: 'New MacBook Pro — PROLED XDR',
    captionLabel: 'LIVE CAPTIONS',
    panelTitle: 'Bilingual Live Captions',
    historyTitle: 'Caption history',
    lines: [
      {
        source: '如果你給 Mac 一塊 OLED，那它得是不一樣的 OLED。',
        translation: "If you give a Mac an OLED, it'll have to be a different kind of OLED.",
      },
      {
        source: '所以它的色彩會更鮮豔、亮度更亮、黑色更黑。',
        translation: "So it'll have more vivid colors, brighter brightness, blacker blacks.",
      },
      {
        source: '它看起來會真實到讓你想伸手去摸一摸。',
        translation: "It'll look so real, you'll wanna reach out and touch it.",
      },
    ],
  },
  'zh-TW': {
    hook: '看外語影片，卻聽不懂？',
    oneClick: '一鍵開始。',
    live: '原文與譯文，即時並排。',
    sidebar: '開啟側邊欄，看完整字幕紀錄。',
    tagline: '任何分頁都能顯示即時雙語字幕。',
    cta: '免費加到 Chrome',
    realProduct: '真實擴充功能的實際畫面',
    sourceLabel: '自動偵測',
    targetLabel: '繁體中文',
    start: '開始即時字幕',
    running: '執行中',
    idle: '閒置',
    tab: 'New MacBook Pro — PROLED XDR',
    captionLabel: '即時字幕',
    panelTitle: '雙語即時字幕翻譯',
    historyTitle: '即時字幕紀錄',
    lines: [
      {
        source: "If you give a Mac an OLED, it'll have to be a different kind of OLED.",
        translation: '如果你給 Mac 一塊 OLED，那它得是不一樣的 OLED。',
      },
      {
        source: "So it'll have more vivid colors, brighter brightness, blacker blacks.",
        translation: '所以它的色彩會更鮮豔、亮度更亮、黑色更黑。',
      },
      {
        source: "It'll look so real, you'll wanna reach out and touch it.",
        translation: '它看起來會真實到讓你想伸手去摸一摸。',
      },
    ],
  },
};
