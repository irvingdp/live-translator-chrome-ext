export type Lang = 'en' | 'zh-tw';

export const STORE_URL =
  'https://chromewebstore.google.com/detail/bilingual-live-captions/ehgfnhdncllgdojcgchaehioknjloikn';
export const REPO_URL = 'https://github.com/irvingdp/live-translator-chrome-ext';
export const FEEDBACK_URL = `${REPO_URL}/issues`;

// Joins a path onto the configured base, e.g. url('video/a.mp4').
export const url = (path = '') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

type Item = { title: string; body: string };

export type Strings = {
  htmlLang: string;
  videoLocale: 'en' | 'zh-TW';
  title: string;
  description: string;
  heroTitle: string;
  heroLead: string;
  install: string;
  source: string;
  featuresTitle: string;
  features: Item[];
  stepsTitle: string;
  steps: Item[];
  providersTitle: string;
  providerHeaders: [string, string, string];
  providerRows: [string, string, string][];
  faqTitle: string;
  faq: Item[];
  privacy: string;
  feedback: string;
  otherLang: string;
};

export const STRINGS: Record<Lang, Strings> = {
  en: {
    htmlLang: 'en',
    videoLocale: 'en',
    title: 'Bilingual Live Captions — live translated captions for any tab',
    description:
      'A Chrome extension that shows the original line and its translation, live, over any video tab. Bring your own Gemini or Deepgram + DeepL key.',
    heroTitle: 'Understand any video, in two languages at once.',
    heroLead:
      'Bilingual Live Captions listens to the tab you pick and shows the original line with its translation right on the video — live, in 78 languages.',
    install: 'Add to Chrome — free',
    source: 'View source',
    featuresTitle: 'What it does',
    features: [
      {
        title: 'Two lines, live',
        body: 'The original speech in white, the translation in amber, updating as people talk. Works on YouTube, Netflix, Disney+ and any HTML5 video.',
      },
      {
        title: 'Follows you across tabs',
        body: 'Switch to another video tab and a badge appears on the icon. One click and the captions move with you.',
      },
      {
        title: 'Captions where you want them',
        body: 'Drag and resize the caption box, or move the full history into Chrome’s side panel. Each site remembers its own layout.',
      },
      {
        title: 'Your key, no middleman',
        body: 'Audio goes from your browser straight to the provider you choose, with your own API key. There is no server of ours in between.',
      },
    ],
    stepsTitle: 'Up and running in three steps',
    steps: [
      { title: 'Install', body: 'Add the extension from the Chrome Web Store (Chrome 116 or newer).' },
      {
        title: 'Get a Gemini API key',
        body: 'The welcome page walks you through creating a key in Google AI Studio and pasting it in.',
      },
      { title: 'Press start', body: 'Open a video, click the extension icon, and press “Start live captions”.' },
    ],
    providersTitle: 'Providers and languages',
    providerHeaders: ['', 'Gemini live translate 3.5', 'Deepgram Nova-3 + DeepL'],
    providerRows: [
      ['API keys', 'One (Google)', 'Two (Deepgram, DeepL)'],
      ['Languages', '78', '10 common languages'],
      ['Source language', 'Detected automatically', 'You pick it'],
      ['Best for', 'Simplest setup, widest coverage', 'Word-by-word source text, tunable line length'],
    ],
    faqTitle: 'Questions',
    faq: [
      {
        title: 'Does it cost anything?',
        body: 'The extension is free and open source. Speech and translation are billed by the provider you choose, on your own account — check their pricing.',
      },
      {
        title: 'Where is my API key stored?',
        body: 'Only in this Chrome profile’s local storage. It is not synced, web pages cannot read it, and it is only ever sent to the service it belongs to.',
      },
      {
        title: 'Can the developer hear what I watch?',
        body: 'No. The extension has no backend: tab audio goes straight to your provider.',
      },
      {
        title: 'Does it caption system audio or other apps?',
        body: 'Not yet. It captures the audio of one Chrome tab at a time.',
      },
    ],
    privacy: 'Privacy policy',
    feedback: 'Feedback',
    otherLang: '繁體中文',
  },
  'zh-tw': {
    htmlLang: 'zh-Hant-TW',
    videoLocale: 'zh-TW',
    title: '雙語即時字幕 Bilingual Live Captions — 任何分頁都能即時翻譯',
    description:
      'Chrome 擴充功能：在任何影片分頁上即時顯示原文與譯文兩行字幕，使用你自己的 Gemini 或 Deepgram + DeepL 金鑰。',
    heroTitle: '任何影片，同時用兩種語言看懂。',
    heroLead: '雙語即時字幕會擷取你選的分頁聲音，直接在影片上即時顯示原文與譯文，支援 78 種語言。',
    install: '免費加到 Chrome',
    source: '查看原始碼',
    featuresTitle: '功能',
    features: [
      {
        title: '兩行字幕，即時更新',
        body: '白色是原文、琥珀色是譯文，邊說邊出現。支援 YouTube、Netflix、Disney+ 與一般 HTML5 影片。',
      },
      {
        title: '換分頁，字幕跟著走',
        body: '切到另一個有影片的分頁時，圖示上會出現提示，點一下字幕就跟過去。',
      },
      {
        title: '字幕放哪裡由你決定',
        body: '字幕框可以拖曳、調整大小，也能把完整紀錄移到 Chrome 側邊欄。每個網站會記住各自的位置。',
      },
      {
        title: '用你自己的金鑰，沒有中間人',
        body: '音訊從你的瀏覽器直接送到你選的服務，用的是你自己的 API Key，中間沒有我們的伺服器。',
      },
    ],
    stepsTitle: '三步開始使用',
    steps: [
      { title: '安裝', body: '從 Chrome 線上應用程式商店安裝（需要 Chrome 116 以上）。' },
      { title: '取得 Gemini API Key', body: '歡迎頁會一步步帶你在 Google AI Studio 建立金鑰並貼上。' },
      { title: '按下開始', body: '打開影片，點擴充功能圖示，按「開始即時字幕」。' },
    ],
    providersTitle: '服務與語言',
    providerHeaders: ['', 'Gemini live translate 3.5', 'Deepgram Nova-3 + DeepL'],
    providerRows: [
      ['API Key', '一把（Google）', '兩把（Deepgram、DeepL）'],
      ['語言數', '78 種', '10 種常用語言'],
      ['來源語言', '自動偵測', '需自行指定'],
      ['適合', '設定最簡單、語言最多', '想看逐字原文、調整每行長度'],
    ],
    faqTitle: '常見問題',
    faq: [
      {
        title: '要付費嗎？',
        body: '擴充功能免費且開源。語音辨識與翻譯由你選的服務商依用量向你的帳號計費，請參考它們的價格。',
      },
      {
        title: '我的 API Key 存在哪裡？',
        body: '只存在這個 Chrome 設定檔的本機儲存空間，不會同步、網頁讀不到，也只會送到它所屬的那個服務。',
      },
      {
        title: '開發者聽得到我在看什麼嗎？',
        body: '聽不到。擴充功能沒有後端，分頁音訊直接送到你選的服務。',
      },
      {
        title: '可以翻譯系統音訊或其他 App 嗎？',
        body: '目前還不行，一次只會擷取一個 Chrome 分頁的聲音。',
      },
    ],
    privacy: '隱私權政策',
    feedback: '意見回饋',
    otherLang: 'English',
  },
};
