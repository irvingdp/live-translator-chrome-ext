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
  providerHeading: string;
  transcriberLabel: string;
  captionModeLabel: string;
  readAheadMode: string;
  recognizer: string;
  languageHeading: string;
  sourceTitle: string;
  targetTitle: string;
  moreSettings: string;
  website: string;
  tab: string;
  captionLabel: string;
  panelTitle: string;
  historyTitle: string;
  // Two lines shown in the floating captions, then a third that arrives
  // after switching to the side panel.
  lines: [CaptionLine, CaptionLine, CaptionLine];
};

// Demo lines follow a MacBook Pro launch film and its new OLED display. Both cuts demo Chinese <-> English. The English cut translates Chinese into
// English and the Chinese cut the reverse, so each audience reads its own language.
export const COPY: Record<Locale, Copy> = {
  en: {
    hook: "Watching something in a language you don't speak?",
    oneClick: 'One click to start.',
    live: 'Captions on time, each word marked as it is said.',
    sidebar: 'Open the side panel for the full history.',
    tagline: 'Live bilingual captions for any tab.',
    cta: 'Add to Chrome — free',
    realProduct: 'The real extension, on a real talk',
    sourceLabel: 'Auto-detect',
    targetLabel: 'English',
    providerHeading: 'Providers',
    transcriberLabel: 'Speech recognition',
    captionModeLabel: 'Translation mode',
    readAheadMode: 'Read-ahead',
    recognizer: 'Local Whisper',
    languageHeading: 'Languages',
    sourceTitle: 'Source language',
    targetTitle: 'Target language',
    moreSettings: 'Show more settings',
    website: 'Website',
    tab: 'New MacBook Pro — OLED display',
    captionLabel: 'LIVE CAPTIONS',
    panelTitle: 'Bilingual Live Captions',
    historyTitle: 'Caption history',
    lines: [
      {
        source: 'MacBook Pro 首次搭載 OLED 顯示器。',
        translation: "For the first time, MacBook Pro has an OLED display.",
      },
      {
        source: '每個像素都自己發光，黑色就是真正的黑。',
        translation: "Every pixel makes its own light, so black is truly black.",
      },
      {
        source: '更亮的高光、無限的對比，色彩更鮮豔。',
        translation: "Brighter highlights, infinite contrast, colors that pop.",
      },
    ],
  },
  'zh-TW': {
    hook: '看外語影片，卻聽不懂？',
    oneClick: '一鍵開始。',
    live: '字幕準時出現，講到哪個字就標到哪個字。',
    sidebar: '開啟側邊欄，看完整字幕紀錄。',
    tagline: '任何分頁都能顯示即時雙語字幕。',
    cta: '免費加到 Chrome',
    realProduct: '真實擴充功能的實際畫面',
    sourceLabel: '自動偵測',
    targetLabel: '繁體中文',
    providerHeading: '服務提供者',
    transcriberLabel: '語音辨識',
    captionModeLabel: '翻譯模式',
    readAheadMode: '預讀模式',
    recognizer: '本地 Whisper',
    languageHeading: '語言',
    sourceTitle: '來源語言',
    targetTitle: '目標語言',
    moreSettings: '顯示更多設定',
    website: '官網',
    tab: 'New MacBook Pro — OLED display',
    captionLabel: '即時字幕',
    panelTitle: '雙語即時字幕翻譯',
    historyTitle: '即時字幕紀錄',
    lines: [
      {
        source: "For the first time, MacBook Pro has an OLED display.",
        translation: 'MacBook Pro 首次搭載 OLED 顯示器。',
      },
      {
        source: "Every pixel makes its own light, so black is truly black.",
        translation: '每個像素都自己發光，黑色就是真正的黑。',
      },
      {
        source: "Brighter highlights, infinite contrast, colors that pop.",
        translation: '更亮的高光、無限的對比，色彩更鮮豔。',
      },
    ],
  },
};
