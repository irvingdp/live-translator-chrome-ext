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

## Gemini Live API 怎麼接的

Gemini 模式走的是 Google 的 **Live API**（`BidiGenerateContent`）：一條 WebSocket
從瀏覽器直接連到 Google，把分頁音訊持續推上去，同時收回原文與譯文。中間沒有我們的
伺服器，用的是使用者自己的金鑰。

```
wss://generativelanguage.googleapis.com/ws/
  google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=<API_KEY>

model: models/gemini-3.5-live-translate-preview
```

**連線後送出的 setup**（`src/providers/gemini-live.ts`）：

```jsonc
{ "setup": {
    "model": "models/gemini-3.5-live-translate-preview",
    "inputAudioTranscription": {},        // ← 原文從這裡來
    "outputAudioTranscription": {},       // ← 譯文從這裡來
    "sessionResumption": {},              // 重連時填 { "handle": "…" }
    "generationConfig": {
      "responseModalities": ["AUDIO"],    // 此模型唯一支援的輸出
      "translationConfig": {
        "targetLanguageCode": "zh-Hant",
        "echoTargetLanguage": false       // 輸入已是目標語言時保持安靜
      }
} } }
```

**音訊上行**：分頁音訊經 AudioWorklet 重取樣成 16 kHz 單聲道 PCM16，每 100 ms 一則：

```json
{"realtimeInput":{"audio":{"data":"<base64>","mimeType":"audio/pcm;rate=16000"}}}
```

**下行**：`serverContent.inputTranscription.text` 是原文，
`serverContent.outputTranscription.text` 是譯文——兩個獨立欄位，不需要解析同一段文字，
也不需要 prompt。`turnComplete` 代表這一列結束。模型同時會回傳翻譯後的語音
（`modelTurn.parts[].inlineData`），我們直接丟棄：這個模型只支援 `AUDIO` 輸出，
拿不到純文字，所以那段頻寬是必要成本。

實作上有四件事值得知道：

- **Chrome 收到的是 Blob，不是字串。** payload 是 UTF-8 JSON，但這個端點用二進位
  frame 傳送，所以只接受字串的 handler 會把整段對話（含 `setupComplete`）靜靜丟光。
  `readSocketFrame` 四種 framing 都收，且用 duck-typing 而非 `instanceof`，避免跨
  realm 失效。
- **一個 turn 會一直開著。** 伺服器端 VAD 只在真的停頓時才送 `turnComplete`，連續
  演講會讓同一列無限長高，所以字幕框在 CSS 限高，原文與譯文各自最多「顯示行數」行。
- **連線約 10 分鐘、音訊 session 約 15 分鐘就會被關閉**，關閉前會先送 `goAway`。
  `GeminiLiveSession` 會存下 `sessionResumptionUpdate.newHandle`，帶著它重連，
  重連期間緩衝約 3 秒音訊，所以看長片不會中斷。
- **按 token／分鐘計費，不是按請求數。** 語音約 25 tokens/秒，一條連線持續消耗約
  1500 input tokens/分鐘，即使沒人說話也一樣。這也是為什麼 DeepL 路徑那個「每分鐘
  上百次請求」的問題在這裡不存在。

完整契約與取捨記在
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

### 由 tag 觸發（建議）

推一個 `v*` tag，`.github/workflows/release.yml` 會跑 compile + test + build + zip，
檢查 zip 結構，然後建立 GitHub Release 並把 zip 掛上去：

```bash
npm version 1.0.1 --no-git-tag-version   # 或直接改 package.json
git commit -am "chore: 1.0.1" && git push
git tag v1.0.1 && git push origin v1.0.1
```

**tag 必須與 `package.json` 的 `version` 一致**，workflow 會擋下不一致的組合——
Chrome Web Store 只接受版本號比上一版高的上傳，這種錯誤在送審後才發現代價很高。
想在不動 tag 的情況下試跑，用 Actions 分頁的 workflow_dispatch。

### 在本機打包

```bash
npm run release      # compile + test + build + zip
npm run screenshots  # 重新產生 docs/store-assets/ 的商店圖片
```

產物是 `output/bilingual-live-captions-<version>-chrome.zip`，`manifest.json` 位於
zip 根目錄，可直接上傳。`output/` 不進版控，每次都是重新 build 出來的。

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
