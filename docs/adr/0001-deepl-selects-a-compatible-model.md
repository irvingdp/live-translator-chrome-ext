---
status: superseded
---

# DeepL 自行選擇相容的模型

> **已被取代。** 1.5.0 移除了 Deepgram 與 DeepL（#10），即時模式只剩 Gemini（[ADR 0004](0004-gemini-live-translate-as-a-combined-provider.md)）。

2026-08-05 在真實 Chrome 測試時，英文字幕持續出現，翻譯卻觸發了連續五次失敗的熔斷。DeepL API 金鑰有效，額度也很充足。擴充功能當時強制指定 `model_type: latency_optimized`，而 DeepL 的標準請求格式允許服務自行選擇相容的模型。

因此從翻譯請求中移除選用的 `model_type`，請求內容只剩 `text`、`source_lang` 與 `target_lang`，由 DeepL 選擇與語言組合相容的模型，包含 `EN` 到 `ZH-HANT`。端點選擇、授權標頭、語言代碼、字幕生命週期、重試延遲、五次失敗熔斷與 API 金鑰的處理都不變。

## 考慮過的選項

- **保留 `latency_optimized`，失敗時再改送不指定模型的請求：** 否決。這次變更不加入備援請求，也不加入額外的診斷，只改請求格式。

## 後果

- 改動只在 `DeepLClient` 的請求內容，以及既有單元測試的預期值。
- 應使用者明確要求，這次變更後不執行測試，也不做 Chrome 驗證；測試只更新為描述預期的請求格式。
- API 金鑰仍只放在 `Authorization` 標頭中，不會出現在網址、日誌、持久化的重試狀態、測試 fixture 或文件中。
