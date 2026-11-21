---
status: accepted
---

# 採用 Gemini Live Translate 作為整合的語音辨識與翻譯服務

2026-08-06 決定採用 `gemini-3.5-live-translate-preview`，作為與 Deepgram + DeepL 並列的第二個可選服務（1.5.0 移除 Deepgram 後成為唯一的即時模式，#10）。這不推翻 [ADR 0003](0003-不以Gemini作為文字翻譯服務.md)：那份否決的是把 Gemini 當成文字翻譯，這裡採用的是它保留未決的音訊路徑。ADR 0003 的三個反對理由在這裡都有答案：

1. **請求頻率：** Live Translate 是一個長時間的 session，以每分鐘 token 計量，不是請求數。stabilizer 與 chunker 不在這條路徑上，除了音訊什麼都不送。
2. **沒有文字輸入、文字輸出的免費模型：** 這條路徑本來就是音訊輸入、音訊與轉錄輸出。
3. **能否取得原文：** 可以。`setup.inputAudioTranscription: {}` 讓伺服器送出 `serverContent.inputTranscription.text`（分頁音訊以原語言的辨識結果），翻譯另由 `serverContent.outputTranscription.text` 送達。兩個不同的欄位，不需要解析提示詞。已對照可運作的 POC（`~/projects/gemini-live-translate-chrome-extension-poc-v0.1.1`）與官方文件驗證。

免費方案條款的疑慮沒有改變：現在由使用者在選擇服務時自己決定，而不再是擴充功能唯一的選項。

整合方式：

- **字幕粒度：** 服務成對送出一整句話的原文與翻譯。把原文送進 `CaptionChunker` 會切成顯示單位，卻無法對應地切翻譯，所以 Gemini 模式把模型的一個 turn 對應到 `CaptionWindow` 的一列，略過 `TranscriptStabilizer`、`CaptionChunker` 與 `TranslationCoordinator`。`CaptionWindow` 以外的部分（捲動列、推入動畫、外觀設定、全螢幕追蹤）與 Deepgram 路徑共用（[ADR 0002](0002-字幕改為兩個單位的捲動視窗.md)）。
- **一列要有上限：** 伺服器端 VAD 只在真正停頓時結束 turn，連續講話時一列會長到蓋住影片。用 CSS 限制框（`.viewport.clamped`）、分別限制 `.original` 與 `.translation` 並顯示各自的尾端，讓兩種語言保持對齊；只限制整組會只剩翻譯，原文消失。保留的 turn 文字也限制在每個串流 2000 字元。
- **來源語言：** `translationConfig` 只有 `targetLanguageCode`，偵測由模型負責，選單停用並顯示「自動偵測」。語言代碼採 BCP-47，與 Deepgram/DeepL 的代碼分開（`GEMINI_LANGUAGE_OPTIONS`、`geminiTargetLanguage`）。
- **session 生命週期：** 連線上限約 10 分鐘、音訊 session 約 15 分鐘。`GeminiLiveSession` 宣告 `sessionResumption`、保存每個 `newHandle`，在 `goAway` 或非預期關閉時重連，空檔期間緩衝約 3 秒音訊。
- **回應音訊丟棄：** `responseModalities: ['AUDIO']` 是唯一選項，語音翻譯直接丟掉；分頁自己的聲音照常播放。

## 考慮過的選項

- **依寬度把 turn 切成多列：** 否決。翻譯比原文晚 1–3 秒，每列的翻譯都會落後上方原文約三分之一行，雙語對不齊。
- **照抄 POC：** 有兩個 bug 沒有沿用：POC 在 socket `open` 時重設重連計數，開啟後才被關閉的 socket（session 到期、驗證被拒）會每 500 毫秒無止盡重連，這裡改在 `setupComplete` 才重設；POC 從不清除 `lastError`，讓過時訊息把之後的關閉誤判為致命，這裡每次嘗試都清除。

## 後果

- **訊框是 Blob，不是字串。** Chrome 以二進位送出這個端點的 WebSocket 訊框，`JSON.parse(event.data)` 會失敗；Google 手寫的範例與 POC 都這樣寫，POC 吞掉例外後看到的是空對話。`readSocketFrame` 以 duck typing 處理字串、Blob、`ArrayBuffer` 與 `ArrayBufferView`，並以 promise 鏈依序套用，避免某一列退回較早的前綴。
- **診斷：** `GeminiLiveSession` 在 offscreen document 的 console 記錄 `opening socket` → `setup accepted` → `first audio chunk sent` → `first transcription received`，停在哪裡就表示哪一層失敗。setup 被接受、音訊也在送卻沒有轉錄時，可以試著把 `inputAudioTranscription`/`outputAudioTranscription` 移進 `generationConfig`：Google 的 WebSocket 參考與 live-translate 頁面的範例說法不一致。
- **待驗證：** `GeminiCaptionAccumulator` 以 `next.startsWith(accumulated) ? next : accumulated + next` 合併片段，累積式或增量式都正確；若模型會修改 turn 中先前的字，只需要改這個函式。
- 後來 `GeminiCaptionAccumulator` 改為把原文與翻譯各自切成句子列，翻譯句鎖定到它出現時最新的原文列，不再是一個 turn 一列。
