---
status: accepted
---

# 預讀模式不提供 Gemini 語音辨識

預讀模式原本有三種**語音辨識**可選：Gemini（`gemini-flash-lite-latest`，同時翻譯）、Groq Whisper、本地 Whisper（ADR 0006、0008）。2026-11-24 起拿掉 Gemini，只剩兩種 Whisper，翻譯一律由觀眾選的**翻譯**服務負責（Chrome 內建翻譯或 Groq（Qwen），ADR 0011）。即時模式（Gemini Live，ADR 0004）不受影響。

## 原因

Gemini 在尖峰時段經常過載，回 HTTP 503（「This model is currently experiencing high demand」）。2026-11-24 用約 12 秒的音訊片段實測：

| 模型 | 結果 |
| --- | --- |
| `gemini-flash-lite-latest`（預讀用的） | 10 次中 7 次 503 |
| `gemini-flash-latest` | 4 次全部 503 |
| `gemini-2.5-flash`、`gemini-2.5-flash-lite` | 404，已下架 |

預讀的片段只有一次機會（每個片段 7 秒預算，ADR 0005），503 就代表那一段沒有字幕，影片還可能停住等。換成更大的模型一樣過載，在預算內重試也只救得回一部分。Gemini 免費方案每天 500 次的額度又比 Groq 的 2000 次少（ADR 0006），而 Whisper 有逐字時間、Gemini 沒有（逐字標示）。留著它，等於提供一個最容易失敗的選項。

## 結果

- 已存的 `readAheadRecognizer: 'gemini'` 視為沒選過：電腦有 WebGPU 就用本地 Whisper，否則用 Groq Whisper（ADR 0008 的預設）。
- 預讀模式不再需要 Gemini 金鑰；即時模式照舊需要。
- 字幕上的切換按鈕只剩 Groq Whisper ↔ 本地 Whisper。
- 要重新加回 Gemini，須先確認它在尖峰時段的 503 比例降到可以接受。
