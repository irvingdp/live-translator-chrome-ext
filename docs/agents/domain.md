# 領域文件

工程類 skill 在探索程式碼時，應如何使用這個 repo 的領域文件。

## 探索之前，先讀這些

- repo 根目錄的 **`GLOSSARY.md`**，或
- repo 根目錄的 **`GLOSSARY-MAP.md`**（若存在）：它指向每個 context 各自的 `GLOSSARY.md`。讀與主題相關的每一份。
- **`docs/adr/`**：讀與你即將動到的範圍相關的 ADR。在多 context 的 repo 中，也要看 `src/<context>/docs/adr/` 裡屬於該 context 的決定。

這些檔案若有任何一個不存在，**直接繼續，不用提**。不要指出它們不存在，也不要一開始就建議建立。`/domain-modeling` skill（經由 `/grill-with-docs` 與 `/improve-codebase-architecture` 使用）會在用詞或決定真正確定時才建立它們。

## 檔案結構

單一 context 的 repo（大多數 repo）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-訂單採用事件溯源.md
│   └── 0002-寫入模型使用Postgres.md
└── src/
```

多 context 的 repo（根目錄有 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 全系統的決定
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← 該 context 的決定
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## ADR 檔名

ADR 檔名一律用中文：四位數編號，加上一句簡短的中文標題，例如 `0006-預讀的語音辨識與翻譯分開選擇.md`。產品名、API 名稱等專有名詞保留原文，標題中的空格改成 `-`。引用時連到完整檔名。

## 使用詞彙表的用詞

當你的產出提到某個領域概念（issue 標題、重構提案、假設、測試名稱），使用 `GLOSSARY.md` 定義的用詞。不要改用詞彙表明確避免的同義詞。

如果你需要的概念還不在詞彙表裡，這是一個訊號：要嘛你在發明專案沒在用的說法（重新考慮），要嘛真的有缺口（記下來交給 `/domain-modeling`）。

## 指出與 ADR 的衝突

如果你的產出與既有 ADR 相牴觸，要明確指出，而不是默默推翻：

> _與 ADR-0007（event-sourced orders）相牴觸，但值得重新討論，因為…_
