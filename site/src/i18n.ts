export type Lang = 'en' | 'zh-tw';

export const STORE_URL =
  'https://chromewebstore.google.com/detail/bilingual-live-captions/ehgfnhdncllgdojcgchaehioknjloikn';
export const REPO_URL = 'https://github.com/irvingdp/live-translator-chrome-ext';
export const FEEDBACK_URL = `${REPO_URL}/issues`;

// Joins a path onto the configured base, e.g. url('video/a.mp4').
export const url = (path = '') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

type Item = { title: string; body: string };

// One spoken line in a mode demo: the original split into the pieces read-ahead
// highlights one by one, and its translation.
export type DemoLine = { words: string[]; translation: string };

export type Mode = {
  name: string;
  tagline: string;
  body: string;
  points: string[];
  note: string;
  demoLabel: string;
  lines: [DemoLine, DemoLine];
};

export type Strings = {
  htmlLang: string;
  videoLocale: 'en' | 'zh-TW';
  title: string;
  description: string;
  heroTitle: string;
  heroLead: string;
  install: string;
  source: string;
  modesTitle: string;
  modesLead: string;
  live: Mode;
  readAhead: Mode;
  // Joins a demo line's words: a space for English, nothing for Chinese.
  sourceJoiner: string;
  demo: { speech: string; captions: string; readAhead: string; hold: string; liveBadge: string };
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
      'A Chrome extension that shows the original line and its translation, live, over any video tab. Bring your own Gemini API key.',
    heroTitle: 'Understand any video, in two languages at once.',
    heroLead:
      'Bilingual Live Captions listens to the tab you pick and shows the original line with its translation right on the video — live, in 78 languages.',
    install: 'Add to Chrome — free',
    source: 'View source',
    modesTitle: 'Two modes, for two kinds of video',
    modesLead: 'Pick one in the extension’s “Translation mode” menu.',
    live: {
      name: 'Live audio mode',
      tagline: 'For live streams, calls and any tab',
      body: 'Gemini live translate 3.5 listens to the tab as it plays and returns the original line and its translation together. Captions follow the speaker by about a second.',
      points: [
        'Works on any tab, including live streams and protected video like Netflix',
        'Recognition and translation in one connection',
        'Needs one Gemini API key',
      ],
      note: 'Captions arrive about a second after the speaker',
      demoLabel: 'Animation: in live audio mode the caption appears word by word, about a second after the speaker talks.',
      lines: [
        { words: ['歡迎回到', '直播，', '決賽', '馬上就要', '開始了。'], translation: 'Welcome back to the stream — the final round starts in a minute.' },
        { words: ['謝謝', '大家', '今天', '在聊天室', '提問。'], translation: 'Thanks, everyone, for all the questions in chat today.' },
      ],
    },
    readAhead: {
      name: 'Read-ahead mode',
      tagline: 'For videos you watch, not live',
      body: 'Read-ahead reads the audio the player has already loaded but not yet played, and translates it before you get there. Each caption appears as its speech starts — nothing is predicted.',
      points: [
        'Captions on time, with each word marked as it is said',
        'YouTube, ordinary HTML5 video, and streaming sites you allow',
        'Gemini, Groq Whisper, or Local Whisper on your own computer with no key; uploader captions are used when the video has them',
        'If the next line is not translated yet, the video pauses for a moment',
      ],
      note: 'Captions start with the speaker',
      demoLabel: 'Animation: read-ahead translates the audio ahead of the playhead, so each caption appears as its speech starts and marks each word as it is said.',
      lines: [
        { words: ['學語言', '最好的方法，', '就是', '每天', '使用它。'], translation: 'The best way to learn a language is to use it every day.' },
        { words: ['從小地方', '開始，', '不要', '害怕', '犯錯。'], translation: 'Start small, and don’t be afraid of mistakes.' },
      ],
    },
    sourceJoiner: '',
    demo: { speech: 'Speaker', captions: 'Captions', readAhead: 'Read ahead', hold: 'Reading audio…', liveBadge: 'LIVE' },
    featuresTitle: 'What it does',
    features: [
      {
        title: 'Two lines, live',
        body: 'The original speech in white, the translation in amber, updating as people talk. Works on YouTube, Netflix, Disney+ and any HTML5 video.',
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
      {
        title: 'Switch it on',
        body: 'Open a video, click the extension icon, pick live audio or read-ahead, and flip the switch at the top right.',
      },
    ],
    providersTitle: 'Providers and languages',
    providerHeaders: ['', 'Live audio (Gemini live translate 3.5)', 'Read-ahead'],
    providerRows: [
      ['API keys', 'One (Google)', 'The same one, or Groq; none for Local Whisper or a video with uploader captions'],
      ['Languages', '78', '78'],
      ['Captions appear', 'Just after the speaker', 'As the speaker starts; the video pauses briefly if a sentence is not ready'],
      ['Works on', 'Any tab, including live streams', 'YouTube, ordinary HTML5 video, and streaming sites you allow'],
    ],
    faqTitle: 'Questions',
    faq: [
      {
        title: 'Does it cost anything?',
        body: 'The extension is free and open source. Speech and translation are billed by Google to your own Gemini account — a free key is enough to start; check Google’s pricing for more.',
      },
      {
        title: 'Where is my API key stored?',
        body: 'Only in this Chrome profile’s local storage. It is not synced, web pages cannot read it, and it is only ever sent to the service it belongs to.',
      },
      {
        title: 'Can the developer hear what I watch?',
        body: 'No. The extension has no backend: tab audio goes straight to your provider. Only the text you choose to send through the optional feedback form ever reaches the developer.',
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
      'Chrome 擴充功能：在任何影片分頁上即時顯示原文與譯文兩行字幕，使用你自己的 Gemini API 金鑰。',
    heroTitle: '任何影片，同時用兩種語言看懂。',
    heroLead: '雙語即時字幕會擷取你選的分頁聲音，直接在影片上即時顯示原文與譯文，支援 78 種語言。',
    install: '免費加到 Chrome',
    source: '查看原始碼',
    modesTitle: '兩種模式，對應兩種影片',
    modesLead: '在擴充功能的「翻譯模式」選單切換。',
    live: {
      name: '即時音訊模式',
      tagline: '直播、會議，任何分頁都能用',
      body: 'Gemini live translate 3.5 邊聽分頁的聲音，邊同時回傳原文與譯文。字幕比講者晚約一秒出現。',
      points: [
        '任何分頁都能用，包含直播和 Netflix 這類有版權保護的影片',
        '辨識和翻譯在同一條連線完成',
        '只需要一把 Gemini API Key',
      ],
      note: '字幕比講者晚約 1 秒出現',
      demoLabel: '動畫：即時音訊模式中，講者說完一段，字幕約一秒後才逐字出現。',
      lines: [
        { words: ['Welcome', 'back', 'to', 'the', 'stream —', 'the', 'final', 'round', 'starts', 'in', 'a', 'minute.'], translation: '歡迎回到直播，決賽馬上就要開始了。' },
        { words: ['Thanks,', 'everyone,', 'for', 'all', 'the', 'questions', 'in', 'chat', 'today.'], translation: '謝謝大家今天在聊天室提問。' },
      ],
    },
    readAhead: {
      name: '預讀模式',
      tagline: '看影片（非直播）時用',
      body: '預讀會讀取播放器已經載入、還沒播放的音訊，在你看到之前先翻好。每句字幕在講者開口時就出現，不靠猜測。',
      points: [
        '字幕準時出現，講到哪個字就標示哪個字',
        'YouTube、一般 HTML5 影片，以及你允許的串流網站',
        '可選 Gemini、Groq Whisper，或在自己電腦執行、不需要金鑰的本地 Whisper；影片有上傳者字幕時直接讀字幕',
        '下一句還沒翻好時，影片會短暫暫停等待',
      ],
      note: '字幕和講者同時開始',
      demoLabel: '動畫：預讀模式先翻好播放位置前方的音訊，所以字幕在講者開口時出現，並逐字標示講到的字。',
      lines: [
        { words: ['The', 'best', 'way', 'to', 'learn', 'a', 'language', 'is', 'to', 'use', 'it', 'every', 'day.'], translation: '學語言最好的方法，就是每天使用它。' },
        { words: ['Start', 'small,', 'and', 'don’t', 'be', 'afraid', 'of', 'mistakes.'], translation: '從小地方開始，不要害怕犯錯。' },
      ],
    },
    sourceJoiner: ' ',
    demo: { speech: '講者', captions: '字幕', readAhead: '已預讀', hold: '讀取音訊中…', liveBadge: 'LIVE' },
    featuresTitle: '功能',
    features: [
      {
        title: '兩行字幕，即時更新',
        body: '白色是原文、琥珀色是譯文，邊說邊出現。支援 YouTube、Netflix、Disney+ 與一般 HTML5 影片。',
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
      { title: '打開開關', body: '打開影片，點擴充功能圖示，選即時音訊或預讀，再打開右上角的開關。' },
    ],
    providersTitle: '服務與語言',
    providerHeaders: ['', '即時音訊模式（Gemini live translate 3.5）', '預讀模式'],
    providerRows: [
      ['API Key', '一把（Google）', '同一把；或 Groq；本地 Whisper 或有上傳者字幕的影片不需要'],
      ['語言數', '78 種', '78 種'],
      ['字幕出現時機', '比講者稍晚', '講者開口時；下一句還沒翻好時影片會短暫暫停'],
      ['適用範圍', '任何分頁，包含直播', 'YouTube、一般 HTML5 影片，以及你允許的串流網站'],
    ],
    faqTitle: '常見問題',
    faq: [
      {
        title: '要付費嗎？',
        body: '擴充功能免費且開源。語音辨識與翻譯由 Google 依用量向你的 Gemini 帳號計費，用免費金鑰就能開始，詳細請參考 Google 的價格。',
      },
      {
        title: '我的 API Key 存在哪裡？',
        body: '只存在這個 Chrome 設定檔的本機儲存空間，不會同步、網頁讀不到，也只會送到它所屬的那個服務。',
      },
      {
        title: '開發者聽得到我在看什麼嗎？',
        body: '聽不到。擴充功能沒有後端，分頁音訊直接送到你選的服務。只有你主動在選填的回饋表單送出的內容，才會傳給開發者。',
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
