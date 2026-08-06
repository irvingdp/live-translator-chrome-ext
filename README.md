# 雙語即時字幕翻譯

Chrome 116+ 的 Manifest V3 擴充功能：擷取目前分頁的音訊，顯示原文與譯文兩行字幕。可以選擇 Deepgram Nova-3 辨識搭配 DeepL 翻譯，或由 Gemini Live Translate 3.5 一手包辦辨識與翻譯。

## 目前支援

- 目前分頁音訊（`chrome.tabCapture` + offscreen document）
- 兩種服務組合，在 Popup 的「語音辨識」下拉切換：
  - **Gemini live translate 3.5**（預設）：單一 WebSocket 同時回傳原文與譯文，只需要一把 Gemini API Key
  - **Deepgram Nova-3 + DeepL**：逐字推進的原文，逐行送出的譯文
- YouTube、Netflix、Disney+ 與一般 HTML5 影片的頁內字幕
- 滾動字幕視窗：每行是一句原文加一句譯文，可選 1／2／3 行；新句到達時最舊的一行往上推出
- 原文與譯文字級分別調整
- 字幕寬度、每行長度上下限、背景透明度、垂直位置皆可調，且在字幕進行中即時生效
- 字幕框寬度固定，由「字幕寬度」單獨決定，不隨句子長短或字級伸縮
- API Key 僅存放於 `chrome.storage.local`

系統音訊與跨 App 置頂字幕尚未支援。預設值：Gemini live translate 3.5、2 行、寬度
70%、背景透明度 50%、距底部 1%。

兩種組合的差異：

| | Deepgram + DeepL | Gemini live translate 3.5 |
| --- | --- | --- |
| API Key | 兩把 | 一把 |
| 語言清單 | 10 種常用語言 | Google 官方 78 種 |
| 來源語言 | 需自行指定 | 自動偵測（無法指定） |
| 字幕分行 | 依「每行長度上下限」切行 | 一段話一列，由瀏覽器斷行；原文與譯文各自最多顯示「顯示行數」行，較舊的內容從上方裁掉。兩個長度滑桿不適用並自動隱藏 |
| 原文推進 | 逐字成長 | 整句一次到位 |

以 Gemini 當純文字翻譯器的評估（結論為不採用）另見
`docs/superpowers/specs/2026-08-06-gemini-translation-evaluation.md`；本次改採 Live
Translate 音訊路徑的理由見
`docs/superpowers/specs/2026-08-06-gemini-live-translate-adoption.md`。

## 本機執行

```bash
npm install
npm run dev
```

或建立可載入 Chrome 的 production 版本：

```bash
npm test
npm run compile
npm run build
```

接著至 `chrome://extensions` 開啟「開發人員模式」，選擇「載入未封裝項目」，載入 `output/chrome-mv3`。

在 Chrome 的擴充功能選單中右鍵點擊本擴充功能，選擇「選項」，輸入並儲存所選服務的 API Key：Deepgram + DeepL 兩把要一起填，Gemini 則只需要一把（<https://aistudio.google.com/>）。接著開啟 HTTPS 影片分頁，從 Popup 選擇服務與語言並按「開始即時字幕」。

## 發佈到 Chrome Web Store

```bash
npm run release      # compile + test + build + zip
npm run screenshots  # 重新產生 docs/store-assets/ 的商店圖片
```

`release` 會產出 `output/bilingual-live-captions-<version>-chrome.zip`，`manifest.json`
位於 zip 根目錄，可直接上傳。版本號來自 `package.json` 的 `version`，WXT 會寫進
manifest；每次送審都必須比上一版高。

上傳前先把 zip 解開、用「載入未封裝項目」實際跑一次——要驗證的是**送出去的那一包**，
不是 `output/chrome-mv3/`。

後台三個分頁要填的每一格（單一用途、各權限說明、資料揭露、雙語文案、給審核員的
測試說明）都寫在 [`docs/store-listing.md`](docs/store-listing.md)。隱私權政策是
送審的硬性條件，內容在 [`PRIVACY.md`](PRIVACY.md)，網址填
`https://github.com/irvingdp/live-translator-chrome-ext/blob/main/PRIVACY.md`——
**送審前這個檔案必須已經推上 `main`**，否則審核員會開到 404。

介面文字全部走 `public/_locales/`（`en` 為預設、`zh_TW` 為覆寫），跟著 Chrome 的
語言自動切換。新增字串時兩個語系都要加——`tests/core/i18n.test.ts` 會檢查兩邊的 key
完全一致、沒有空字串、每個 key 都有給譯者看的 `description`。程式碼裡用
`t('someKey')`，key 的型別直接從 `en` 的 catalogue 推出來，打錯字編譯就會擋下來。

## 延遲說明

「字幕寬度」是影片寬度的百分比，與字級、與每行字數都無關；「每行長度上限」則決定一行塞多少字。兩者各自獨立，所以有可能設成互相衝突：字幕框太窄而每行字數太多時，最長的一行會折成兩行。把框調寬或把長度上限調小都能解決。

「每行長度下限」是短句的合併門檻：短於它的一列會併進下一列，避免「嗯。」單獨佔掉一整行；設 0 就不合併。下限永遠不會超過上限——下限滑桿以目前的上限為終點，而把上限調到比下限還低時，下限會跟著被拉下來，且之後把上限調回去不會自動還原。兩者都以「字寬」計算，CJK 算兩格、英數算一格。在字幕進行中調整只影響之後才切出來的列，已經顯示在畫面上的列會保持原樣。

音訊以 40 ms PCM16 chunk 傳送，並使用 Deepgram interim results。翻譯以「約一行」的顯示單位為粒度送出，讓每次 DeepL 請求都很短；請求不指定 `model_type`，由 DeepL 自行挑選相容模型。端到端 0.5 秒是網路與供應商狀況良好時的 stretch target，不能由瀏覽器端單方面保證；實際 release gate 為 warm session p50 ≤ 800 ms、p95 ≤ 1500 ms。

正式發布前，必須分別提供 DeepL Free 與 Pro Key，執行不允許 skip 的相容性檢查：

```bash
DEEPL_FREE_API_KEY='…:fx' DEEPL_PRO_API_KEY='…' npm run test:providers
```

YouTube、Netflix、Disney+ 帳號情境、service worker 強制終止恢復，以及實際網路的 p50/p95 延遲仍屬 release checklist；沒有相應帳號、API Key 與測量結果時，不應宣告 production release gate 通過。

## 隱私與費用

Deepgram 模式下，分頁音訊會傳送至 Deepgram，穩定的辨識文字會傳送至 DeepL；Gemini 模式下，分頁音訊只會傳送至 Google Gemini，原文與譯文都由它產生。使用者需自行提供並負擔所選服務的 API 額度：Deepgram/DeepL 按用量計費，Gemini Live 則按每分鐘 token 計費，語音約 25 tokens/秒，也就是一條連線持續消耗約 1500 input tokens/分鐘，即使沒人說話也一樣。API Key 不會同步到其他裝置，但能存取這個 Chrome profile 的人或程式仍可能讀取本機擴充功能資料。
