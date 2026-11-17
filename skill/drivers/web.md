# 網頁驅動程式

適用：網站，以及任何能在瀏覽器開啟的前端（含 Cordova App 的網頁層，搭配手機尺寸）。

程式是 `scripts\browser-driver.mjs`。它只用 Node 內建模組，操作本機已安裝的 Edge（找不到時用 Chrome），走行程間管道不開 port，每次用一次性的空白 profile，結束時整個刪除。需要 Node 22 以上。

## 指令

下表的 `driver` 代表 `node "<本 skill 目錄>\scripts\browser-driver.mjs"`。每個指令回傳一段 JSON，`ok` 為 false 時讀 `error`。

| 動作 | 指令 | 說明 |
|---|---|---|
| 開始 | `driver start --out "<報告目錄>\screenshots"` | 啟動瀏覽器。每次測試只開一個 |
| 開啟 | `driver open <url>`、`driver back`、`driver reload` | 進入頁面、上一頁、重新整理 |
| 列出元素 | `driver elements` | 列出可操作的欄位、按鈕、連結與建議的 selector |
| 點擊 | `driver click <selector>` | 按鈕、連結、勾選框 |
| 輸入 | `driver fill <selector> <值>` | 文字欄位與下拉選單；值給空字串代表清空 |
| 按鍵 | `driver press <Enter\|Tab\|Escape>` | 送出表單、切換焦點 |
| 等待 | `driver wait <selector\|毫秒>` | 等元素出現 |
| 讀取畫面內容 | `driver text` | 頁面上的可見文字 |
| 截圖 | `driver shot <檔名> [--full]` | 存成 PNG，回傳完整路徑；用 Read 看圖 |
| 讀取執行紀錄 | `driver console` | 上次讀取之後的 console error、warning、未捕捉例外 |
| 讀取網路紀錄 | `driver network` | 上次讀取之後狀態碼 400 以上或失敗的 request，以及被擋的導覽與對話框紀錄 |
| 結束 | `driver stop` | 關瀏覽器並刪除 profile |

## 使用規則

- selector 用 CSS selector，或 `text=登入` 這種依可見文字比對的寫法。不確定時先跑 `elements`。
- 密碼欄位只接受環境變數：`driver fill "#pwd" env:QA_PWD`，直接給值會被驅動程式拒絕，步驟檔也一樣。環境變數必須在啟動 Claude Code 之前就存在（使用者層級的環境變數，設完要重開 Claude Code），對話中途才設的讀不到。開始前用 `driver hasenv QA_PWD` 確認，它只回有或沒有，不會印出值。沒有的話請使用者設好再重開，不要請使用者把密碼貼進對話。
- 預設只能瀏覽本機。開發環境主機要在開始時加 `--allow <主機名>`（多個用逗號分隔），加之前先跟使用者確認該主機是開發環境。不在白名單的導覽會被擋下，並出現在 `network` 的 `notes`；頁面會停在錯誤頁，用 `back` 回去。白名單只管頁面與 iframe 的導覽，已允許的頁面自己發出的 API 請求不受限。
- 手機尺寸在開始時加 `--viewport 390x844`。想看著它操作時加 `--headed`。
- 原生對話框會自動處理並記在 `network` 的 `notes`：alert 按確定，confirm 與 prompt 按取消。要測「按確定」的分支時，在報告的未測範圍註明。
- 新開分頁會被自動關閉並留下紀錄，目前不支援跨分頁流程。
- 元素被點擊後換成另一個元素時（例如「加入」變成「移除」），再點同一個 selector 會回找不到元素，要重新列出元素。
- 連續多步且中間不需要判斷時，把步驟寫成 JSON 陣列存到報告目錄，用 `driver run <檔案>` 一次跑完，遇到第一個失敗就停。
- **測完一定要 `driver stop`**，中途放棄也要。忘了的話它閒置 15 分鐘會自己結束。

## 這個驅動程式測不到的

- 手機尺寸只是改變視窗大小，不是真的行動裝置：原生外掛（相機、生物辨識、推播）、實機效能、觸控手勢都測不到。
- Edge 以外的瀏覽器引擎。
