# 雙語即時字幕翻譯

Chrome 116+ 的 Manifest V3 擴充功能：在影片上顯示原文與譯文兩行字幕。即時音訊模式由 Gemini 一手包辦辨識與翻譯，只需要一把 Gemini API Key；預讀模式用 Groq 或本地的 Whisper 辨識，搭配 Chrome 內建翻譯（無法使用時自動改用 Google 網頁翻譯）或 Groq（Qwen）翻譯。

## 目前支援

- 兩種模式，在 Popup 的「翻譯模式」下拉切換：
  - **即時音訊模式**（預設，Gemini live translate 3.5）：擷取目前分頁的音訊（`chrome.tabCapture` + offscreen document），單一 WebSocket 同時回傳原文與譯文
  - **預讀模式**：先讀取播放器已經載入、還沒播放的音訊並翻譯，字幕在講者開口時就出現（YouTube 與一般 HTML5 影片；見 [ADR 0005](docs/adr/0005-預讀透過緩衝擷取或影子播放器.md)）。語音辨識與翻譯可以分開選（見 [ADR 0006](docs/adr/0006-預讀的語音辨識與翻譯分開選擇.md)）；Gemini 常因過載回應失敗，不提供作為預讀的語音辨識（見 [ADR 0012](docs/adr/0012-預讀不提供Gemini語音辨識.md)）。沒選過的話，預設用 Groq Whisper 辨識、Groq（Qwen）翻譯，只需要一把 Groq 金鑰：
    - **Groq Whisper** 辨識，搭配 **Chrome 內建翻譯**（在本機執行，不需要金鑰；這台電腦或這組語言無法使用時，自動改用 Google 網頁翻譯。這不是官方 API，可能隨時失效）。Groq 每天 2000 次的額度用完或無法回應時，字幕上的「改用本地 Whisper」按鈕會直接切換（這台電腦能跑時）
    - **本地 Whisper**：在這台電腦用 WebGPU 執行 Whisper，不需要金鑰、沒有額度。模型（large-v3-turbo 566 MB 或 small 325 MB）在 popup 確認大小後下載一次；翻譯同樣交給 Chrome 內建翻譯。沒有 WebGPU 的電腦不能使用（見 [ADR 0008](docs/adr/0008-本地Whisper在offscreen-document執行.md)）
    - **Groq（Qwen）翻譯**：搭配任一種 Whisper 時，翻譯可以改選 Groq 上的 Qwen 語言模型。它會參考前後句，成語照意思翻、用語一致，品質明顯比 Chrome 內建翻譯好。使用你的 Groq 金鑰（與 Groq Whisper 共用），每天約 1,000 個片段；翻不了的片段自動改用 Chrome 內建翻譯（見 [ADR 0011](docs/adr/0011-預讀翻譯可選用Groq的Qwen.md)）
    - **逐字標示**：用 Groq 或本地 Whisper 辨識時，原文整句先顯示，講者講到哪個字就標示哪個字（已講的正常、正在講的加底色、還沒講的變淡）。浮動字幕和 Side Panel 都有。字幕軌沒有逐字時間，只顯示整句。popup 可以關掉
    - **字幕軌優先**：影片有上傳者提供的字幕時，直接讀字幕，不呼叫語音辨識；也有你的目標語言字幕時，連翻譯也不用。popup 可以關掉「優先使用影片字幕軌」改用語音辨識。YouTube 自動產生的字幕和自動翻譯不算（見 [ADR 0007](docs/adr/0007-預讀優先使用上傳者的字幕軌.md)）
- YouTube、Netflix、Disney+ 與一般 HTML5 影片的頁內字幕
- **播放器按鈕**：YouTube 和 B 站的播放器控制列會多一個按鈕，點開可以直接開關字幕（照 popup 選的模式；即時模式要先在那個分頁點過一次擴充功能圖示）、切換翻譯語言（見 [ADR 0013](docs/adr/0013-播放器按鈕直接在YouTube與B站載入.md)）
- 可自由拖曳、調整寬高的浮動字幕；拉高後會自動顯示更多完整的雙語句子
- 可將字幕切換至 Chrome 原生 Side Panel 查看較長的字幕紀錄，關閉 Side Panel 後會自動切回浮動字幕
- 每個 HTTPS 網站會分別記住浮動字幕的位置與尺寸
- 原文與譯文的字級、文字顏色可分別調整
- 背景透明度可調，且在字幕進行中即時生效
- API Key 僅存放於 `chrome.storage.local`

系統音訊與跨 App 置頂字幕尚未支援。預設值：即時音訊模式、字幕寬度約為視窗 70%、背景透明度 50%。

兩種模式的差異：

| | 即時音訊模式（Gemini live translate 3.5） | 預讀模式 |
| --- | --- | --- |
| 字幕時機 | 比講者稍晚出現 | 講者開口時出現；下一句還沒翻好時，影片會暫停等待 |
| 適用範圍 | 任何分頁（含直播、DRM 影片） | YouTube 與一般 HTML5 影片（不支援直播與 DRM） |
| 來源語言 | 自動偵測（無法指定） | 自動偵測，也可以指定 |
| 語言清單 | Google 官方 78 種 | 同左 |
| API Key | Gemini | Groq；本地 Whisper 搭配 Chrome 內建翻譯時不需要 |
| 免費額度 | 依每分鐘 token 計算 | 每段 10～15 秒音訊算一次請求：Groq 每天 2000 次；本地 Whisper 沒有額度 |

> 1.5.0 起移除了 Deepgram Nova-3 + DeepL。原本選 Deepgram 的使用者會自動改用 Gemini live。

## Gemini Live API 

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

**音訊上行**：分頁音訊由 Web Audio 原生重取樣成 16 kHz，AudioWorklet
將所有聲道 downmix 成單聲道，再轉為 PCM16，每 100 ms 一則：

```json
{"realtimeInput":{"audio":{"data":"<base64>","mimeType":"audio/pcm;rate=16000"}}}
```

**下行**：`serverContent.inputTranscription.text` 是原文，
`serverContent.outputTranscription.text` 是譯文——兩個獨立欄位，不需要解析同一段文字，
也不需要 prompt。兩個 transcription stream 各自累積，再依句子順序配成雙語列；
`turnComplete` 會固定原文尾句，但仍容許晚到的譯文補回同一列。模型同時會回傳翻譯後的語音
（`modelTurn.parts[].inlineData`），我們直接丟棄：這個模型只支援 `AUDIO` 輸出，
拿不到純文字，所以那段頻寬是必要成本。

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

接著至 `chrome://extensions` 開啟「開發人員模式」，選擇「載入未封裝項目」，載入
`output/chrome-mv3`。macOS 與 Windows 的正式版 Chrome 不允許直接安裝本機自行簽署的
CRX；需要可點擊安裝的封裝版本時，必須發布到 Chrome Web Store，或由組織透過企業政策部署。

在 Chrome 的擴充功能選單中右鍵點擊本擴充功能，選擇「選項」，輸入並儲存 Gemini API Key（<https://aistudio.google.com/>）。接著開啟 HTTPS 影片分頁，從 Popup 選擇服務與語言，再打開 Popup 右上角的開關。

## 評分與回饋

使用者開始過一次字幕、再到第二個分頁授權時，Popup 頂端會出現評分卡片（按「稍後再說」則到第 5 個分頁再問一次，之後不再出現）。點 4–5 顆星會直接送出評分；點 1–3 顆星則顯示回饋表單（「哪裡可以做得更好？」為選填下拉選單：字幕翻譯不精準／字幕延遲／UI 介面不友善／其他，選「其他」才出現文字框；不收集 Email，也不會導到其他頁面），送出後由 Google Apps Script 寫入 Google Sheet 並寄信給開發者。部署步驟見 [`feedback/README.md`](feedback/README.md)，部署後把網址填入 `src/core/feedback.ts` 的 `FEEDBACK_ENDPOINT`（打 tag 發佈時 CI 會檢查）。

真實瀏覽器的 e2e 測試：

```bash
npx playwright install chromium   # 第一次
npm run build && npm run e2e
```

## 官網與介紹影片

官網位於 <https://irvingdp.github.io/live-translator-chrome-ext/>，原始碼在 `site/`（Astro，英文與繁中）。首頁的 25 秒介紹影片由 `video/`（Remotion）產生。兩者都是獨立的 npm 套件，不影響擴充功能本身的依賴。

```bash
cd video && npm install
npm run studio                       # 在 Remotion Studio 預覽、調整影片
npm run render -- ../site/public/video   # 渲染 en / zh-TW 影片與封面圖

cd ../site && npm install
npm run dev                          # 本機預覽官網
```

`.github/workflows/pages.yml` 會在 `site/`、`video/` 或 `PRIVACY.md` 有變更時重新渲染影片、建置官網；PR 只驗證，合併到 `main` 才部署到 GitHub Pages。影片檔不進版控。

## 隱私與費用

Gemini live 把目前分頁的音訊傳送至 Google Gemini。預讀模式在影片有上傳者提供的字幕時只讀字幕，不傳送音訊；沒有字幕時，把播放器已載入的音訊片段傳送至 Groq，選本地 Whisper 時音訊不離開這台電腦；辨識出的文字由 Chrome 內建翻譯在本機翻譯（字幕軌沒有目標語言時，字幕文字也一樣）；Chrome 內建翻譯無法使用時，改送至 Google 網頁翻譯；翻譯選 Groq（Qwen）時，這些文字連同前兩句改送至 Groq。使用者需自行提供並負擔所選服務的 API 額度：Gemini Live 按每分鐘 token 計費，語音約 25 tokens/秒，也就是一條連線持續消耗約 1500 input tokens/分鐘，即使沒人說話也一樣。API Key 不會同步到其他裝置，但能存取這個 Chrome profile 的人或程式仍可能讀取本機擴充功能資料。

## 授權

Copyright © 2026 Ivan Chang

本專案僅依 [GNU General Public License v3.0](LICENSE)（`GPL-3.0-only`）授權。你可以使用、研究、修改及散布本軟體；若散布本專案或其修改版本，必須依 GPL-3.0 提供相應原始碼，並以相同授權條款發布。

本軟體不提供任何明示或默示的擔保。Google Gemini 等第三方服務及其 API 不屬於本專案授權範圍，仍分別受各自的服務條款、隱私政策及費用規則約束。
