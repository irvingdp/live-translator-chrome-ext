---
status: accepted
---

# 播放器按鈕：直接在 YouTube 與 B 站載入

觀眾想要像其他字幕外掛一樣，在 YouTube 和 B 站播放器的控制列上有一個按鈕，不必先點瀏覽器工具列的擴充功能圖示。按鈕點開是一個小選單：**開啟字幕**開關、**翻譯成**哪個語言、**更多設定**（打開 popup）。

## 決定

- **直接載入，不另外詢問。** 按鈕腳本寫進 manifest 的 `content_scripts`，只比對 `https://www.youtube.com/*` 與 `https://www.bilibili.com/*`，在擴充功能自己的隔離環境、`document_idle` 執行。曾考慮改成選用權限（popup 開關，像 ADR 0009 的「允許的網站」那樣請求），使用者選擇直接允許：按鈕一裝好就在，不需要找設定。代價是 manifest 多了這兩個網站的存取權：已安裝的人更新後，Chrome 會先停用擴充功能，等他們同意「讀取和變更 www.youtube.com、www.bilibili.com 上的資料」；商店頁也會列出這項權限。`scripts/verify-manifest.mjs` 只容許這一個內容腳本，比對的網站、檔案和執行環境都寫死。
- **照 popup 選的模式開始。** 選單的「開啟字幕」用觀眾在 popup 選的模式，開關底下寫著是哪一個。預讀模式隨時可以從這裡開始。即時模式要用 `tabCapture` 錄分頁的聲音，Chrome 只在觀眾曾在這個分頁點過擴充功能自己的按鈕（activeTab）後才允許；沒點過時開始會失敗，選單就請觀眾先點一下工具列上的圖示，之後就能從這裡開。曾考慮一律改用預讀，使用者選擇保留自己選的模式。缺金鑰、缺 Groq 權限或本地 Whisper 模型還沒下載時不會開始，選單會說缺什麼，請觀眾到「更多設定」處理，因為那些都只能在 popup 完成。
- **只有 YouTube 與 B 站。** 按鈕插進這兩個網站自己的控制列（`.ytp-right-controls`、`.bpx-player-control-bottom-right`），位置穩定。其他網站沒有共同的控制列可找。

## 結果

- 按鈕的圖示嵌在腳本裡（data URL），不必把擴充功能的檔案開放給網頁讀取。
- 擁有這兩個網站的存取權，並不會讓預讀在 YouTube 改走「允許的網站」的路徑：那由註冊的 MediaSource 擷取決定（ADR 0009），不看權限。
- 原本建置但從未載入的 `player-toggle` 被這個按鈕取代（issue #23）。
