# Issue 追蹤：GitHub

這個 repo 的 issue 與規格都放在 GitHub issue。所有操作都使用 `gh` CLI。

## 慣例

- **建立 issue**：`gh issue create --title "..." --body "..."`。多行內容用 heredoc。
- **讀取 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，搭配適當的 `--label` 與 `--state` 篩選。
- **把 issue 設為父 issue 的子 issue**：`gh issue create --parent <parent> ...`，或事後執行 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94 以上）。較舊的 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（database id，同下方的**封鎖關係**）。沒有子 issue 功能時，在子 issue 內文最上方寫 `Part of #<parent>`。
- **在 issue 留言**：`gh issue comment <number> --body "..."`
- **加上／移除標籤**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **關閉**：`gh issue close <number> --comment "..."`

repo 從 `git remote -v` 推斷；在 clone 內執行時 `gh` 會自動處理。

## 把 pull request 當成分流來源

**PRs as a request surface: no.** _（如果這個 repo 把外部 PR 視為功能需求，就設為 `yes`；`/triage` 會讀這個旗標。）_

設為 `yes` 時，PR 和 issue 走同樣的標籤與狀態，使用對應的 `gh pr` 指令：

- **讀取 PR**：`gh pr view <number> --comments`，差異用 `gh pr diff <number>`。
- **列出待分流的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **留言／標籤／關閉**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 與 PR 共用同一組編號，所以單獨的 `#42` 可能是兩者之一：先用 `gh pr view 42` 判斷，不是的話再用 `gh issue view 42`。

## 當 skill 說「發布到 issue tracker」（publish to the issue tracker）

建立一個 GitHub issue。

## 當 skill 說「取得相關的 ticket」（fetch the relevant ticket）

依照上方的**讀取 issue** 讀取。

## Wayfinding 操作

由 `/wayfinder` 使用。**map** 是單一個 issue，**child** issue 就是各張 ticket。

- **Map**：單一個標上 `wayfinder:map` 的 issue，內文包含 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **Child ticket**：以 GitHub 子 issue 連到 map 的 issue（見**把 issue 設為父 issue 的子 issue**）。沒有子 issue 功能時，把 child 加到 map 內文的 task list，並在 child 內文最上方寫 `Part of #<map>`。標籤：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。認領後，ticket 指派給負責的開發者。
- **封鎖關係**：使用 GitHub **原生的 issue 相依性**，這是正式、在 UI 上看得到的表示方式。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 加上一條邊，其中 `<blocker-db-id>` 是封鎖者的數字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 也不是 `node_id`）。GitHub 會回報 `issue_dependencies_summary.blocked_by`（只算仍開啟的封鎖者，也就是實際的關卡）。無法使用相依性時，退而在 child 內文最上方寫一行 `Blocked by: #<n>, #<n>`。所有封鎖者都關閉後，ticket 就解除封鎖。
- **前緣查詢**：列出 map 仍開啟的 child（`gh issue list --state open`，限定在 map 的子 issue／task list），排除有開啟中封鎖者的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中有仍開啟的 issue）以及已有指派人的；依 map 中的順序，第一個勝出。
- **認領**：`gh issue edit <n> --add-assignee @me`，這是 session 的第一個寫入動作。
- **解決**：`gh issue comment <n> --body "<answer>"`，接著 `gh issue close <n>`，再把脈絡指標（摘要 + 連結）附加到 map 的 Decisions-so-far。
