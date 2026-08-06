# Chrome Web Store 上架填寫內容

後台每一格要填的東西都在這裡。被退件時改這份，不要只改後台——下次改版才有得對照。

- **項目名稱**：由 manifest 的 `__MSG_extName__` 決定，不在後台填。
- **隱私權政策網址**：`https://github.com/irvingdp/live-translator-chrome-ext/blob/main/PRIVACY.md`
  （送審前 `PRIVACY.md` 必須已經推上 `main`，否則審核員會開到 404 而退件）
- **上傳檔案**：`npm run release` 產生的 `output/bilingual-live-captions-1.0.0-chrome.zip`

---

## Store listing 分頁

**類別**：Productivity（生產力工具）
**預設語言**：English。存檔後再新增「中文（繁體）」並貼下方中文文案。
**截圖**：商店只會顯示一組截圖給所有語言的訪客，所以 `npm run screenshots` 產出的是
英文介面（與圖上的英文文案一致）。要中文版可跑 `node scripts/store-screenshots.mjs zh_TW`。

### 簡短描述 / Short description（上限 132 字元）

英文（124 字元）：

```
Live bilingual captions for any tab: the original line and its translation, from your own Gemini or Deepgram + DeepL key.
```

中文：

```
為任何分頁加上即時雙語字幕：上行原文、下行譯文，使用你自己的 Gemini 或 Deepgram + DeepL 金鑰。
```

### 詳細描述 / Detailed description

**English**（第一段就講清楚 BYOK 與介面語言，避免使用者裝了才發現）：

```
Bilingual Live Captions puts a two-line caption over any video you are watching:
the original speech on top, its translation underneath.

BEFORE YOU INSTALL
• You need your own API key. This extension has no subscription and no server of
  its own — it uses your key to talk to the provider directly. A free Google AI
  Studio key is enough to start.

The interface follows Chrome's language: English or Traditional Chinese.

TWO WAYS TO RUN IT
• Gemini live translate 3.5 (default) — one Google API key. A single connection
  sends the tab audio and returns both the original text and the translation.
  78 target languages; the source language is detected automatically.
• Deepgram Nova-3 + DeepL — two keys. Speech recognition advances word by word,
  so the original line grows as the speaker talks, and each finished line is
  translated separately.

WHAT YOU CAN ADJUST
• 1, 2 or 3 caption rows
• Separate font sizes for the original and the translation
• Caption box width, background opacity, distance from the bottom
• Maximum and minimum line length (Deepgram mode)
• Everything applies live, while captions are running

WHERE IT WORKS
YouTube, Netflix, Disney+ and ordinary HTML5 video on any https page, including
fullscreen.

PRIVACY
No analytics, no telemetry, no server of ours. Your keys stay in local Chrome
storage on this device. Tab audio goes straight from your browser to the provider
you picked. Full policy:
https://github.com/irvingdp/live-translator-chrome-ext/blob/main/PRIVACY.md

Note on the free Gemini tier: Google uses free-tier input to improve its products
and human reviewers may read it, and the free tier is not available in the EEA,
the UK, or Switzerland. Use a paid key or Deepgram + DeepL for sensitive content.

Not affiliated with Google, Deepgram, or DeepL.
```

**中文**：

```
在你正在看的影片上疊一組兩行字幕：上行原文，下行譯文。

安裝前請先知道
• 需要自備 API Key。這個擴充功能沒有訂閱制、也沒有自己的伺服器，是用你的金鑰
  直接連到服務商。用 Google AI Studio 的免費金鑰就可以開始。
• 操作介面支援英文與繁體中文，會跟著 Chrome 的語言自動切換。

兩種組合
• Gemini live translate 3.5（預設）— 一把 Google 金鑰。單一連線把分頁音訊送出，
  同時回傳原文與譯文。78 種目標語言，來源語言自動偵測。
• Deepgram Nova-3 + DeepL — 兩把金鑰。逐字推進的辨識，原文會隨著講者一個字一個字
  長出來，每完成一行再送出翻譯。

可以調整的項目
• 字幕 1、2 或 3 行
• 原文與譯文的字級各自獨立
• 字幕框寬度、背景透明度、距離底部的位置
• 每行長度上限與下限（Deepgram 模式）
• 全部都能在字幕進行中即時生效

適用範圍
YouTube、Netflix、Disney+ 以及任何 https 網頁上的一般 HTML5 影片，全螢幕也支援。

隱私
沒有分析工具、沒有遙測、沒有我們的伺服器。金鑰只留在這台裝置的 Chrome 本機儲存
空間。分頁音訊由你的瀏覽器直接送到你選的服務商。完整政策：
https://github.com/irvingdp/live-translator-chrome-ext/blob/main/PRIVACY.md

使用 Gemini 免費方案請注意：Google 會用免費方案的輸入改善產品且可能有人工審閱，
且免費方案在 EEA、英國、瑞士不適用。處理敏感內容請改用付費金鑰或 Deepgram + DeepL。

與 Google、Deepgram、DeepL 均無官方合作關係。
```

### 圖片

由 `npm run screenshots` 產生於 `docs/store-assets/`：

| 檔案 | 尺寸 | 用途 |
| --- | --- | --- |
| `screenshot-1-captions.png` | 1280×800 | 主圖：字幕疊在播放器上 |
| `screenshot-2-popup-gemini.png` | 1280×800 | Gemini 模式的設定面板 |
| `screenshot-3-popup-deepgram.png` | 1280×800 | Deepgram 模式，含每行長度控制 |
| `screenshot-4-options.png` | 1280×800 | API Key 設定頁 |
| `promo-small-440x280.png` | 440×280 | 小宣傳圖（沒有這張，排序會排在有的後面） |

---

## Privacy 分頁

### Single purpose（單一用途）

```
Capture the audio of a tab the user selects and display it as live bilingual
captions over that tab's video — the original transcript on one line and its
translation on the next.
```

### 權限用途說明（每一項都要填，缺一項會退件）

**`tabCapture`**
```
The extension's entire purpose is captioning what is being said in a tab, so the
tab's audio is its only input. tabCapture is started by an explicit user action
(the Start button in the popup) for the one tab the user chose, and stops when the
user presses Stop or closes that tab. No other tab is ever captured.
```

**`offscreen`**
```
A Manifest V3 service worker has no AudioContext and cannot hold a long-lived
WebSocket reliably. The captured audio is resampled to 16 kHz PCM16 and streamed to
the speech provider from an offscreen document, which is the only supported place
to do this in MV3. It is created when captioning starts and closed when it ends.
```

**`activeTab`**
```
Used together with scripting to place the caption overlay into the tab the user
pressed Start on. Nothing is injected until that click.
```

**`scripting`**
```
Injects the caption overlay content script into the user's chosen tab when it is
not already present. This is the recovery path used after the service worker has
been suspended and restarted.
```

**`storage`**
```
Stores the user's own API keys and their caption preferences (rows, font sizes,
width, opacity, position, language) in local storage on the device. Nothing is
synced and nothing is sent anywhere.
```

**Host permissions（四個 API 網域）**
```
These are the four endpoints the user's chosen provider needs:
generativelanguage.googleapis.com for Gemini live translate, api.deepgram.com for
speech recognition, and api.deepl.com / api-free.deepl.com for translation (the
free and paid DeepL tiers use different hosts, and which one applies depends on the
user's key). The extension contacts no other host.
```

**Broad host permissions — 內容腳本 `https://*/*`**
```
The caption overlay has to be able to sit on top of a video on whatever site the
user is watching, so the content script matches all https pages. It is a renderer
only: it draws a shadow-DOM overlay, reads the position and size of the page's
largest <video> element so the captions line up with it, and reads its own settings
from extension storage. It does not read, collect, or transmit page content, and it
does nothing at all until the user starts a captioning session in that tab.

It is registered statically rather than injected on demand because captions must
survive in-page navigation: when the page changes, the content script reloads and
announces itself so the overlay comes back. activeTab is revoked on a cross-origin
navigation, so an injection-only approach cannot restore the overlay afterwards.
```

### Remote code（遠端程式碼）

選 **「No, I am not using remote code」**。所有 JavaScript 都在套件內；擴充功能只
把資料送往 API，不下載也不執行任何遠端程式碼。

### 資料用途揭露（Data usage）

要勾選的類別：

- ☑ **Website content** — 分頁音訊，以及由它產生的原文逐字稿與譯文。這是唯一離開
  裝置的內容資料，且只送往使用者自選的服務商。
- ☑ **Authentication information** — 使用者的 API Key。只存在本機，且只會送往該
  金鑰所屬的那一個服務作為認證。

**不要勾**：Personally identifiable information、Health information、Financial and
payment information、Personal communications、Location、Web history、User activity。
擴充功能不讀取瀏覽紀錄、不追蹤使用行為、不辨識使用者身分。

三個切結項目全部勾選，皆屬實：

- 不將資料販售或轉移給第三方（未經核可用途）
- 不將資料用於或轉移至與單一用途無關的用途
- 不將資料用於或轉移以判定信用狀況或放貸目的

---

## Distribution 分頁

- **可見度**：Public
- **地區**：全部（Gemini 免費方案在 EEA／英國／瑞士不適用一事，已寫在描述與隱私權
  政策中；當地使用者改用付費金鑰或 Deepgram + DeepL 仍可正常使用，因此不需要在
  商店層級排除這些地區）
- **付費模式**：免費

---

## Test Instructions 分頁（不會公開，但很關鍵）

自備金鑰型的擴充功能最常見的退件原因，就是審核員打開後看到一個「不會動」的東西。
**這一格一定要放一把可用的 Gemini API Key。**

```
This extension requires the reviewer to supply an API key, so a working test key is
provided below.

Test key (Google AI Studio, Gemini API): <在這裡貼上一把可用的金鑰>

Steps:
1. Right-click the extension icon and choose Options. Paste the key above into the
   "Gemini API Key" field and press "Save settings".
2. Open any https page with a talking video — for example a YouTube conference talk
   in English.
3. Click the extension icon. "Speech recognition" is already set to "Gemini live
   translate 3.5". Set "Target language" to whatever you would like to read.
4. Press "Start live captions". Within a few seconds two lines of caption appear
   over the video: the original speech on top, the translation below.
5. Press the same button again (now "Stop captions") to stop.

The interface follows Chrome's language: English by default, Traditional Chinese
for zh-TW. No account, login, or payment is required beyond the key above.
```

---

## 送審前檢查

- [ ] `PRIVACY.md` 已推上 GitHub `main`，無痕視窗開得起來
- [ ] `npm run release` 全綠，zip 產生
- [ ] zip 解開後實際載入過一次，字幕真的會出現
- [ ] Test Instructions 裡的金鑰是可用的
- [ ] 四張截圖與宣傳圖尺寸正確
- [ ] 開發者帳號已付 5 美元註冊費、已申報 trader／non-trader
