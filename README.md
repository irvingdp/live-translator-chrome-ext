# 雙語即時字幕翻譯

Chrome 116+ 的 Manifest V3 擴充功能：擷取目前分頁的音訊，以 Deepgram Nova-3 產生逐字稿，再透過 DeepL 顯示原文與譯文字幕。

## 目前支援

- 目前分頁音訊（`chrome.tabCapture` + offscreen document）
- Deepgram 即時語音辨識
- DeepL Free / Pro 翻譯端點
- YouTube、Netflix、Disney+ 與一般 HTML5 影片的頁內字幕
- 原文與譯文字級分別調整
- API Key 僅存放於 `chrome.storage.local`

本地 Whisper、Gemini Live、系統音訊與跨 App 置頂字幕目前只在介面標示為後續功能。

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

接著至 `chrome://extensions` 開啟「開發人員模式」，選擇「載入未封裝項目」，載入 `.output/chrome-mv3`。

開啟 HTTPS 影片分頁，從擴充功能 Popup 輸入自己的 Deepgram 與 DeepL API Key、選擇語言並按「開始即時字幕」。

## 延遲說明

音訊以 40 ms PCM16 chunk 傳送，並使用 Deepgram interim results 與 DeepL `latency_optimized`。端到端 0.5 秒是網路與供應商狀況良好時的 stretch target，不能由瀏覽器端單方面保證；實際 release gate 為 warm session p50 ≤ 800 ms、p95 ≤ 1500 ms。

正式發布前，必須分別提供 DeepL Free 與 Pro Key，執行不允許 skip 的相容性檢查：

```bash
DEEPL_FREE_API_KEY='…:fx' DEEPL_PRO_API_KEY='…' npm run test:providers
```

YouTube、Netflix、Disney+ 帳號情境、service worker 強制終止恢復，以及實際網路的 p50/p95 延遲仍屬 release checklist；沒有相應帳號、API Key 與測量結果時，不應宣告 production release gate 通過。

## 隱私與費用

啟動後，分頁音訊會傳送至 Deepgram，穩定的辨識文字會傳送至 DeepL。使用者需自行提供並負擔兩項服務的 API 額度。API Key 不會同步到其他裝置，但能存取這個 Chrome profile 的人或程式仍可能讀取本機擴充功能資料。
