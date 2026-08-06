# Privacy Policy — Bilingual Live Captions / 雙語即時字幕翻譯

**Last updated: 2026-08-06**

English below. 中文在前。

---

## 中文

### 摘要

這個擴充功能沒有伺服器，開發者收不到你的任何資料。它做的事是：把你指定分頁的
音訊，用**你自己申請的 API Key**直接送到你選擇的語音／翻譯服務，再把回傳的文字
畫在畫面上。

### 開發者收集的資料

**沒有。** 這個擴充功能不含分析工具、不含遙測、沒有後端伺服器，也不會把任何資料
回傳給開發者。開發者無從得知你安裝了它、你看了什麼、或你說了什麼。

### 會離開你裝置的資料

啟動字幕之後，**你所選分頁的音訊**會被送到你指定的服務供應商。連線是從你的瀏覽器
直接連到該服務，不經過任何中間伺服器：

| 你選擇的服務 | 送出的內容 | 送到哪裡 |
| --- | --- | --- |
| Gemini live translate 3.5（預設） | 分頁音訊 | Google（`generativelanguage.googleapis.com`） |
| Deepgram Nova-3 + DeepL | 分頁音訊送 Deepgram；辨識出的文字送 DeepL | Deepgram（`api.deepgram.com`）、DeepL（`api.deepl.com` 或 `api-free.deepl.com`） |

音訊只在你按下「開始即時字幕」之後、且只針對你選定的那一個分頁擷取。按下停止或
關閉該分頁就停止擷取。原文與譯文只顯示在畫面上，不會被儲存成檔案或紀錄。

### 只留在你裝置上的資料

- **API Key**：存放在 `chrome.storage.local`，只在這台電腦的這個 Chrome 設定檔中。
  不會使用 Chrome 同步，不會離開裝置——除了送往該金鑰本來所屬的那一個服務作為
  認證之用。
- **字幕外觀與語言設定**：同樣存在 `chrome.storage.local`。
- **工作階段狀態**：暫存於 `chrome.storage.session`（Chrome 關閉即消失），其中
  **不含任何 API Key**，金鑰在寫入前已被移除。

任何時候都可以在擴充功能的選項頁清空金鑰欄位並儲存；移除擴充功能會一併刪除以上
所有本機資料。

### 第三方服務

你的音訊與文字如何被使用，取決於你選擇的服務與你和他們之間的合約，不由這個擴充
功能決定。請自行閱讀：

- Google Gemini API — [條款](https://ai.google.dev/gemini-api/terms)、
  [Google 隱私權政策](https://policies.google.com/privacy)
- Deepgram — [隱私權政策](https://deepgram.com/privacy)
- DeepL — [隱私權政策](https://www.deepl.com/privacy)

### 使用 Gemini 免費方案前務必知道的兩件事

預設的服務供應商是 Gemini，而 Google 的免費方案條款與付費方案不同：

1. **免費方案的輸入內容會被 Google 用來改善產品，且可能有人工審閱。** 也就是說，
   你用免費金鑰所擷取的分頁音訊，不應包含機密、敏感或個人資訊。若你要處理這類
   內容，請使用付費方案的金鑰，或改用 Deepgram + DeepL。
2. **免費方案在歐洲經濟區（EEA）、英國、瑞士不適用。** 位於這些地區的使用者需要
   付費方案的金鑰。

### 權限用途

| 權限 | 用途 |
| --- | --- |
| `tabCapture` | 擷取你選定分頁的音訊，這是產生字幕的唯一資料來源 |
| `offscreen` | Manifest V3 的 service worker 無法使用 AudioContext，音訊處理與 API 連線必須在離螢幕文件中進行 |
| `activeTab`、`scripting` | 把字幕圖層注入你按下開始的那個分頁 |
| `storage` | 儲存你的 API Key 與字幕設定 |
| 內容腳本 `https://*/*` | 字幕必須能疊在任何影片網站上；腳本只會畫字幕，不會讀取或送出網頁內容 |
| `host_permissions` | 只限四個服務供應商的 API 網域，供上述連線使用 |

### 兒童

本擴充功能非為 13 歲以下兒童設計，也不會刻意收集其資料（實際上不收集任何人的資料）。

### 政策變更

本政策若有變更，會更新本頁最上方的日期，並隨新版本一同發佈。

### 聯絡方式

問題或疑慮請至
<https://github.com/irvingdp/live-translator-chrome-ext/issues> 開 issue。

---

## English

### Summary

This extension has no server and the developer receives none of your data. What it
does: it sends the audio of a tab you pick to a speech/translation service you
choose, using **your own API key**, and draws the returned text on screen.

### Data collected by the developer

**None.** There is no analytics, no telemetry, and no backend. Nothing is ever sent
to the developer. The developer cannot tell that you installed it, what you watched,
or what was said.

### Data that leaves your device

Once you start captions, **the audio of the tab you selected** is sent to the
provider you chose. The connection goes from your browser straight to that service,
with no intermediary server:

| Provider you choose | What is sent | Where it goes |
| --- | --- | --- |
| Gemini live translate 3.5 (default) | Tab audio | Google (`generativelanguage.googleapis.com`) |
| Deepgram Nova-3 + DeepL | Tab audio to Deepgram; the recognised text to DeepL | Deepgram (`api.deepgram.com`), DeepL (`api.deepl.com` or `api-free.deepl.com`) |

Audio is captured only after you press start, and only for the one tab you selected.
Capture stops when you press stop or close that tab. The original and translated
text is only rendered on screen; it is never written to a file or a log.

### Data that stays on your device

- **API keys**: stored in `chrome.storage.local`, on this machine and this Chrome
  profile only. Chrome Sync is not used. They never leave the device except as
  authentication to the one service each key belongs to.
- **Caption appearance and language settings**: also in `chrome.storage.local`.
- **Session state**: held in `chrome.storage.session` (cleared when Chrome closes)
  and **contains no API keys** — they are stripped before it is written.

You can clear the key fields on the options page and save at any time. Removing the
extension deletes all of the above local data.

### Third-party services

How your audio and text are used is governed by the provider you choose and your
agreement with them, not by this extension. Please read:

- Google Gemini API — [terms](https://ai.google.dev/gemini-api/terms),
  [Google Privacy Policy](https://policies.google.com/privacy)
- Deepgram — [privacy policy](https://deepgram.com/privacy)
- DeepL — [privacy policy](https://www.deepl.com/privacy)

### Two things to know before using a free Gemini key

Gemini is the default provider, and Google's free-tier terms differ from the paid
tier:

1. **Free-tier input is used by Google to improve its products and may be read by
   human reviewers.** Audio captured with a free key should therefore not contain
   confidential, sensitive, or personal information. For such content, use a paid
   key or switch to Deepgram + DeepL.
2. **The free tier is not available in the EEA, the UK, or Switzerland.** Users
   there need a paid-tier key.

### Why each permission is needed

| Permission | Purpose |
| --- | --- |
| `tabCapture` | Capture the audio of the tab you selected — the only source of caption text |
| `offscreen` | A Manifest V3 service worker cannot use AudioContext, so audio processing and the provider connection run in an offscreen document |
| `activeTab`, `scripting` | Inject the caption overlay into the tab where you pressed start |
| `storage` | Save your API keys and caption settings |
| `https://*/*` content script | Captions must be able to sit on top of any video site. The script only draws captions; it never reads or transmits page content |
| `host_permissions` | Limited to the four provider API domains used for the connections above |

### Children

This extension is not directed at children under 13 and does not knowingly collect
their data — it collects no one's data.

### Changes

If this policy changes, the date at the top of this page is updated and the change
ships with a new version.

### Contact

Please open an issue at
<https://github.com/irvingdp/live-translator-chrome-ext/issues>.
