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

**音訊上行**：分頁音訊經 AudioWorklet 重取樣成 16 kHz 單聲道 PCM16，每 100 ms 一則：

```json
{"realtimeInput":{"audio":{"data":"<base64>","mimeType":"audio/pcm;rate=16000"}}}
```

**下行**：`serverContent.inputTranscription.text` 是原文，
`serverContent.outputTranscription.text` 是譯文——兩個獨立欄位，不需要解析同一段文字，
也不需要 prompt。`turnComplete` 代表這一列結束。模型同時會回傳翻譯後的語音
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

接著至 `chrome://extensions` 開啟「開發人員模式」，選擇「載入未封裝項目」，載入 `output/chrome-mv3`。

在 Chrome 的擴充功能選單中右鍵點擊本擴充功能，選擇「選項」，輸入並儲存所選服務的 API Key：Deepgram + DeepL 兩把要一起填，Gemini 則只需要一把（<https://aistudio.google.com/>）。接著開啟 HTTPS 影片分頁，從 Popup 選擇服務與語言並按「開始即時字幕」。

## 隱私與費用

Deepgram 模式下，分頁音訊會傳送至 Deepgram，穩定的辨識文字會傳送至 DeepL；Gemini 模式下，分頁音訊只會傳送至 Google Gemini，原文與譯文都由它產生。使用者需自行提供並負擔所選服務的 API 額度：Deepgram/DeepL 按用量計費，Gemini Live 則按每分鐘 token 計費，語音約 25 tokens/秒，也就是一條連線持續消耗約 1500 input tokens/分鐘，即使沒人說話也一樣。API Key 不會同步到其他裝置，但能存取這個 Chrome profile 的人或程式仍可能讀取本機擴充功能資料。
