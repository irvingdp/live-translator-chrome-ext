# 雙語即時字幕翻譯

Chrome 116+ 的 Manifest V3 擴充功能：擷取目前分頁的音訊，顯示原文與譯文兩行字幕。可以選擇 Deepgram Nova-3 辨識搭配 DeepL 翻譯，或由 Gemini Live Translate 3.5 一手包辦辨識與翻譯。

## 目前支援

- 目前分頁音訊（`chrome.tabCapture` + offscreen document）
- 兩種服務組合，在 Popup 的「語音辨識」下拉切換：
  - **Gemini live translate 3.5**（預設）：單一 WebSocket 同時回傳原文與譯文，只需要一把 Gemini API Key
  - **Deepgram Nova-3 + DeepL**：逐字推進的原文，逐行送出的譯文
- YouTube、Netflix、Disney+ 與一般 HTML5 影片的頁內字幕
- 可自由拖曳、調整寬高的浮動字幕；拉高後會自動顯示更多完整的雙語句子
- 可將字幕切換至 Chrome 原生 Side Panel 查看較長的字幕紀錄，關閉 Side Panel 後會自動切回浮動字幕
- 每個 HTTPS 網站會分別記住浮動字幕的位置與尺寸
- 原文與譯文的字級、文字顏色可分別調整
- Deepgram 的每行長度上下限與所有模式的背景透明度皆可調，且在字幕進行中即時生效
- API Key 僅存放於 `chrome.storage.local`

系統音訊與跨 App 置頂字幕尚未支援。預設值：Gemini live translate 3.5、字幕寬度約為視窗 70%、背景透明度 50%。

兩種組合的差異：

| | Deepgram + DeepL | Gemini live translate 3.5 |
| --- | --- | --- |
| API Key | 兩把 | 一把 |
| 語言清單 | 10 種常用語言 | Google 官方 78 種 |
| 來源語言 | 需自行指定 | 自動偵測（無法指定） |
| 字幕分行 | 依「每行長度上下限」切行 | 依句末標點形成語意句；新譯句鎖定當下最新原文列，單次錯切不會讓後續字幕持續位移 |
| 原文推進 | 逐字成長 | 未完成句逐字成長，下一句或 `turnComplete` 到達後固定 |


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

在 Chrome 的擴充功能選單中右鍵點擊本擴充功能，選擇「選項」，輸入並儲存所選服務的 API Key：Deepgram + DeepL 兩把要一起填，Gemini 則只需要一把（<https://aistudio.google.com/>）。接著開啟 HTTPS 影片分頁，從 Popup 選擇服務與語言並按「開始即時字幕」。

## 隱私與費用

Deepgram 模式下，分頁音訊會傳送至 Deepgram，穩定的辨識文字會傳送至 DeepL；Gemini 模式下，分頁音訊只會傳送至 Google Gemini，原文與譯文都由它產生。使用者需自行提供並負擔所選服務的 API 額度：Deepgram/DeepL 按用量計費，Gemini Live 則按每分鐘 token 計費，語音約 25 tokens/秒，也就是一條連線持續消耗約 1500 input tokens/分鐘，即使沒人說話也一樣。API Key 不會同步到其他裝置，但能存取這個 Chrome profile 的人或程式仍可能讀取本機擴充功能資料。

## 授權

Copyright © 2026 Ivan Chang

本專案僅依 [GNU General Public License v3.0](LICENSE)（`GPL-3.0-only`）授權。你可以使用、研究、修改及散布本軟體；若散布本專案或其修改版本，必須依 GPL-3.0 提供相應原始碼，並以相同授權條款發布。

本軟體不提供任何明示或默示的擔保。Google Gemini、Deepgram 與 DeepL 等第三方服務及其 API 不屬於本專案授權範圍，仍分別受各自的服務條款、隱私政策及費用規則約束。
