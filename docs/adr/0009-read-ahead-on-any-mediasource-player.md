---
status: accepted
---

# 在觀眾允許的網站上，任何 MediaSource 播放器都能預讀

預讀原本只能在 YouTube（緩衝擷取，再透過 YouTube 自己的播放器 API 重新載入）和一般影片檔（影子播放器）上讀到即將播放的音訊。其他串流播放器（B 站的 dash.js、hls.js 網站⋯）播放的是 `blob:` 來源，一律不支援。每一次逐站嘗試都卡在同一點：擷取程式在觀眾按下開始時才到場，那時播放器早已 append 了 init segment（編碼設定）和前面的音訊，只能靠該網站自己的播放器 API 讓播放器再 append 一次。

Chrome 上所有非 DRM 的串流播放器，都是透過 MediaSource `SourceBuffer.appendBuffer` 把媒體交給 `<video>`，格式為 fMP4 或 WebM（hls.js 會把 TS 轉成 fMP4）。因此，**從頁面載入時就在場**的擷取程式，能看到每個播放器的 init segment 與每一次 append，不需要播放器 API，也不需要重新載入。

所以自 2.0.0 起，觀眾可以**允許一個網站**。允許時會向 Chrome 要求該網站的 host 權限（`https://<網站>/*`，在 popup 中、於觀眾點擊的當下請求），並用 `chrome.scripting.registerContentScripts` 為該 origin 註冊 MediaSource 擷取程式：`world: 'MAIN'`、`runAt: 'document_start'`、只在最上層 frame、跨 session 保留。manifest 在 `optional_host_permissions` 宣告 `https://*/*`，只作為這些逐站請求的上限。

擷取程式 hook 了 `URL.createObjectURL`（把 blob 網址對應回它的 MediaSource，藉此選出最大那支影片的 buffer，而不是廣告或預覽）、`MediaSource.prototype.addSourceBuffer`，以及每個 buffer 的 `appendBuffer`/`abort`。它把 WebM/Opus 與 fMP4（任何 profile 的 AAC，或 Opus；以 `tfdt` + `trun` 計時）解析成壓縮音框，在 buffer 仍持有期間保留，上限 15 分鐘的音訊。預讀開始之前，它不解碼也不送出任何東西。開始之後，以 WebCodecs 解碼，並用與 YouTube 擷取程式相同的訊息送出 16 kHz 單聲道區塊。加密的音軌（`enca`/`encv`，或 `video.mediaKeys`）屬於 DRM，不支援；`AudioDecoder` 無法設定的編碼也不支援。

預讀取得音訊的順序：頁面上有 MediaSource 擷取程式時用它；未允許的 YouTube 用 YouTube 自己的擷取程式（不變，所以 YouTube 不需要任何權限）；一般影片檔用影子播放器；其餘的 `blob:` 來源則請觀眾允許網站（「這個網站需要先允許…」並附「允許這個網站」，按下後打開 popup）。允許後分頁會重新整理，原本的 session 在新頁面上自動接續。

## 考慮過的選項

- **逐站使用播放器 API**（B 站的 `player.reload()`、hls.js 的 `recoverMediaError`⋯）：否決。每個網站都要自己的程式碼，網站一改就壞。
- **開始時才注入，等播放器重新 append init segment：** 否決。大多數播放器不會重送 init segment；已經緩衝的音訊就讀不到了。
- **一次取得所有網站的權限**（安裝時授予 `https://*/*`，或在 manifest 宣告全網站的 `content_scripts`）：否決。這會讓既有使用者的擴充功能被停用直到同意，而且會在使用者造訪的每個頁面上執行 hook。
- **預設也允許 YouTube：** 否決。YouTube 本來就不需要任何權限；允許 YouTube 只是讓它改用通用擷取程式。

## 後果

- 允許的網站每次載入頁面都會執行擷取程式，不論有沒有在播影片。它只包住函式並記錄播放器 append 的內容；內部的錯誤都會被吞掉，絕不會中斷播放。
- 沒有播放器 API，補充或跳轉只能從儲存的音訊提供。播放器已丟掉的音訊，要等播放器再次下載時才會回來。
- 擷取程式只看最上層 frame：iframe 裡的播放器、在 worker 中使用的 MediaSource、直播與 DRM 都不在範圍內。
- 已註冊的腳本就是允許網站的清單。啟動時以及 Chrome 移除權限時，沒有權限的註冊會被移除。在選項頁移除網站會取消註冊並歸還權限。
- 串流的 `blob:` 網址在播放器重建 MediaSource 時就會改變，所以預讀以頁面網址來識別這類影片。
- AAC 一律只解核心那一層：HE-AAC（SBR）與 HE-AAC v2（PS）都改用核心的 AAC-LC 設定解碼。核心已涵蓋到其取樣率一半的頻率，遠超過預讀 16 kHz 所需。這也讓被播放器錯標的串流能正確解碼：2026-11-18 在一個用 hls.js 的網站上，hls.js 依播放清單的 `mp4a.40.5` 寫出 HE-AAC 設定（`29 91 88 00`，核心與擴展都是 48 kHz），實際卻是每個音框 1024 個樣本的 48 kHz AAC-LC；照 HE-AAC 解碼時每個音框接縫都斷開（接縫跳動是一般位置的 33 倍），聲音極度破碎，語音辨識只剩幻覺。
