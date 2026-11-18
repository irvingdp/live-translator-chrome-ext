---
status: accepted
---

# 本地 Whisper：在觀眾電腦上的 offscreen document 執行 Whisper

預讀模式的雲端語音辨識有每日額度，也需要金鑰（ADR 0002）。**本地 Whisper** 加入一個兩者都不需要的語音辨識。它在觀眾自己的電腦上、在瀏覽器中，以 transformers.js 搭配 WebGPU 執行 Whisper 模型（issue #15）。

- 它在 **offscreen document** 中執行，這個文件原本就為即時擷取而存在：WebGPU 在那裡可用，一個載入的模型能服務所有分頁，也不受 YouTube 頁面 CSP 的限制。背景把每個片段的音訊送給它，再取回句子。之後的流程與 Groq 相同：同樣的句子整理，再交給 Chrome 的翻譯或 Google 網頁翻譯。
- **提供的模型：** `large-v3-turbo`（預設，566 MB）與 `small`（325 MB）。它們是 `onnx-community/whisper-*_timestamped`，也就是帶有逐字時間戳的匯出版本。
- **下載：** 觀眾在 popup 按下「下載模型（N MB）」之前，什麼都不會下載。下載在 offscreen document 中進行，所以關閉 popup 不會中斷。它以訊息回報自己的進度與結束，背景再寫入 `chrome.storage.session`。service worker 從不等待它：Chrome 會停止在單一訊息上花超過 5 分鐘的 worker。第一版確實在等，結果卡在 566 MB 中的 394 MB。超過 2 分鐘沒有消息的下載視為已停止，可以重新開始。已完成的檔案會保留在快取中，所以重新開始只會抓缺少的部分。檔案存放在擴充功能的 Cache Storage（`transformers-cache`），popup 可以刪除它們。
- **開始：** 使用本地 Whisper 的 session 只有在所選模型完整快取後才會開始。預讀開始前，模型會先載入 GPU，讓最初的片段不必等待。
- **預設語音辨識：** 從未選擇過的觀眾，若電腦有 WebGPU 就預設本地 Whisper，否則為 Groq Whisper。兩種情況都由 Chrome 內建的 Translator 翻譯。這是使用者的決定，目的是讓預讀不依賴 Gemini 每天 500 次的額度。已儲存的選擇絕不更改。1.5.0 以前的設定沒有儲存選擇，所以這些觀眾會得到新的預設值。
- **沒有 WebGPU 就沒有本地 Whisper：** 該選項會停用並說明原因。沒有 CPU 備援。
- **不自動切換。** 片段超過 7 秒時顯示「本地 Whisper 在 7 秒內沒有辨識完」，並建議改用較小的模型或 Groq。字幕上提供「改用 Groq Whisper」。反過來，當 Groq 無法服務（太慢、限流、無法使用或額度用完）時，字幕上提供「改用本地 Whisper」，但前提是電腦有 WebGPU（由 service worker 檢查）。模型已下載時，按鈕會載入模型，並從觀眾所在位置以本地 Whisper 重新開始 session。模型未下載時，按鈕會停止字幕，並打開已切到本地 Whisper、停在下載按鈕的 popup。所以按鈕的順序是 Gemini → Groq → 本地 Whisper。

## 量測（2026-11-17，使用者的 Mac，WebGPU）

與 Groq spike 相同的 60 秒 TED 片段，切成 15 秒片段，另加一段 15.9 秒的合成台灣華語音訊：

| 模型／裝置 | 下載 | 首次載入 | 每 15 秒片段 | 第一個字時間，中位數／p90 | 中文錯字（約 65 字中） |
|---|---|---|---|---|---|
| base / WebGPU | 113 MB | 14 秒 | 0.8–1.9 秒 | 0.43 / 0.64 秒 | 5 |
| small / WebGPU | 325 MB | 37 秒 | 1.4–1.8 秒 | 0.45 / 0.62 秒 | 1 |
| large-v3-turbo / WebGPU | 566 MB | 61 秒 | 1.6–1.8 秒 | 0.43 / 0.59 秒 | 0 |
| base / WASM（CPU） | 80 MB | 9 秒 | 2.5–4.4 秒 | 0.43 / 0.64 秒 | 4 |

「首次載入」包含下載時間。作為比較，Groq 每個片段 0.3–1.1 秒，時間中位數 0.29 秒。

## 考慮過的選項

- **由觀眾自己執行的伺服器**（`localhost` 上的 whisper.cpp）：更快，也能用任何模型，但需要安裝並讓某個程式持續執行。這個版本否決。
- **base：** 中文錯字太多（「公立」辨識成「功力」、「毅力」辨識成「意力」），不值得為了較小的檔案採用。
- **沒有 WebGPU 時改用 CPU（WASM）：** 連 base 都達不到每個片段 3 秒的目標，較大的模型會更慢。
- **在頁面中執行：** 受 YouTube 的 CSP 限制，而且每個分頁都要一個模型。
- **繁體中文提示詞**（Groq 現在對設為繁體中文的講話會帶上）：transformers.js 4.3.2 沒有實作 Whisper 的 `prompt_ids`。本地 Whisper 寫中文時由模型自行決定，通常是簡體。

## 後果

- ONNX Runtime 的 WebAssembly（`ort-wasm-simd-threaded.asyncify`，27 MB）打包在套件的 `ort/` 下。擴充功能頁面不可以從 CDN 載入程式碼。transformers.js 直接 import 它，並關閉 `useWasmCache`，因為擴充功能的 CSP 會擋下它原本會建立的 `blob:` 模組。MV3 預設的 CSP（`script-src 'self'`）不允許編譯 WebAssembly；第一次建置就因此失敗（"no available backend found … violates … script-src 'self'"）。所以 manifest 現在把 `extension_pages` 設為 `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`，manifest 檢查也要求一字不差。`'wasm-unsafe-eval'` 只允許 WebAssembly，不允許 `eval` 或遠端程式碼。模型權重是資料，不是程式碼。
- Hugging Face 提供模型檔時的 CORS 設定很寬鬆，所以不需要 host 權限，這與 issue #15 原本的計畫不同。選擇本地 Whisper 時只會要求網頁翻譯備援的網域。
- offscreen document 的理由現在是 `USER_MEDIA` 與 `WORKERS`。session 執行期間它保持開啟，session 或下載結束後關閉，與以往相同。
- 逐字時間大約比人工字幕的開始晚 0.45 秒，比 Groq 稍晚。
