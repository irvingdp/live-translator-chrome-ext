---
status: accepted
---

# 不以 Gemini 作為文字翻譯服務

需求是在免費方案上用 Gemini Live API 做翻譯，端到端目標 0.5 秒。2026-08-06 評估後**不採用**，popup 中的「Gemini 3.5 Live（即將推出）」選項也移除，而不是留著一個不會兌現的承諾。這個結論只針對把 Gemini 當成*文字*翻譯服務；評估中提到的音訊路徑後來經過驗證並採用，見 [ADR 0004](0004-Gemini-Live-Translate作為整合的辨識與翻譯服務.md)。

理由有三：

1. **請求頻率比免費方案高出一個數量級。** 從處理流程量測，每分鐘連續講話，英文需要 60–150 個翻譯請求（一般約 100），中日韓 200–330 個。原因在 `TranscriptStabilizer`：穩定文字一次只前進一個字（中日韓一次一個字元），`CaptionChunker` 每前進一次就把變長的那列送去翻譯，一列在變長過程中被翻 10–15 次，字元量約放大 5 倍。Google 已不再公布免費方案的 RPM/TPM/RPD，最後公布的 Flash 等級數字是 10–15 RPM。
2. **沒有免費模型是文字輸入、文字輸出。** `gemini-3.5-live-translate-preview` 只接受音訊；`gemini-2.5-flash-native-audio-preview-12-2025` 只輸出音訊；唯一符合的 `gemini-3.1-flash-live-preview` 需要付費帳單，免費金鑰會在產生內容時收到 WebSocket close 1011 "You exceeded your current quota"（官方論壇的 Google 員工回覆，2026-08-05）。
3. **免費方案條款不適合字幕內容。** 免費方案的輸入會用於改善 Google 產品、可能由人工審閱，條款要求不要送出敏感或個人資訊，而字幕帶有使用者正在看的任何內容。要提供給 EEA、英國或瑞士的使用者，也必須使用付費服務。

## 考慮過的選項

- **只翻譯已完成的列：** 請求頻率是自己造成的：每穩定一個字就重翻整列。只翻已完成的列可降到每分鐘 10–20 個請求，連保守的免費方案也容得下，代價是最下面那列的翻譯晚 4–6 秒才出現。這對任何服務都適用（包括 DeepL，若每月 50 萬字元成了瓶頸），是「即時那一列要多即時」的產品決定，不是選擇服務的決定，這次不做。
- **`gemini-3.5-live-translate-preview` 的持續 WebSocket session：** 架構上最有意思：輸入音訊、輸出翻譯，以每分鐘 token 計量而不是請求數，能避開頻率問題，並可能同時取代 Deepgram 與 DeepL。設計前必須依序驗證：能否取得來源語言的轉錄（雙語字幕的關鍵）、免費方案是否可用、token 消耗（音訊約每秒 25 token，每分鐘約 1500 輸入 token）、session 生命週期（音訊 session 上限 15 分鐘、連線約 10 分鐘，需要以續接 token 無縫重連）。

## 後果

- 當時的 DeepL 流程也不保證 0.5 秒：`README.md` 把它列為延伸目標，實際門檻是 p50 ≤ 800 ms / p95 ≤ 1500 ms，而端到端延遲從未量測過。如果 0.5 秒成為硬性需求，第一步是量測，不是換服務；LLM 的延遲比專用翻譯端點更高也更不穩定。
- 資料來源：<https://ai.google.dev/gemini-api/docs/rate-limits>（2026-07-21 更新）、`/pricing`、`/models`、`/live-api`、`/live-api/live-translate`、`/live-session`、`/terms`，以及 Google 員工在 discuss.ai.google.dev 的兩則回覆（2026-08-05、2026-07-13）。
