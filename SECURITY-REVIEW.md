# qa-report 資安複核說明

本工具會控制受測環境並處理測試帳號登入，公司專案使用前請通過 Code Review / 資安複核。本文件整理複核時需要的資訊，狀態為「待複核」。

skill 的流程與平台無關，可執行的部分只有驅動程式。目前唯一的驅動程式是網頁驅動程式，本文件「它會做什麼」以下的內容都是針對它。之後每新增一個驅動程式，都要比照本文件另外送審。

## 送審範圍

| 檔案 | 性質 | 說明 |
|---|---|---|
| `skill\SKILL.md` | 純文字 prompt | 無可執行內容 |
| `skill\drivers\README.md`、`skill\drivers\web.md` | 純文字說明 | 無可執行內容 |
| `skill\templates\report-template.md` | 純文字範本 | 無可執行內容 |
| `skill\scripts\browser-driver.mjs` | 可執行腳本（網頁驅動程式） | 單一檔案，約 1000 行，可逐行審閱 |

## 它會做什麼

- 啟動本機已安裝的 Edge（找不到時用 Chrome），預設無視窗模式。
- 透過 DevTools 協定操作頁面：開網址、點擊、輸入、讀頁面文字、截圖、讀 console 與 network 事件。
- 在系統暫存目錄建立一次性的 session 目錄（含瀏覽器 profile），結束時刪除。
- 把截圖寫到啟動時以 `--out` 指定的目錄。skill 會指定為報告目錄下的 `2_screenshots\`，報告目錄預設在本機的 QA 工作資料夾（位置見「待確認事項」）。

## 它不會做什麼

| 項目 | 說明 |
|---|---|
| 不安裝任何東西 | 無 npm 套件、無執行檔下載、無瀏覽器擴充套件 |
| 不開 TCP port | 與瀏覽器走行程間管道，已實測無監聽中的 socket |
| 不讀使用者既有的瀏覽器資料 | 不使用預設 profile，不匯入 cookie、密碼、歷史紀錄 |
| 不主動對外連線 | 腳本本身沒有任何網路呼叫；只有被操作的頁面會連線 |
| 不回傳使用統計 | 無 telemetry、無更新檢查 |
| 不註冊 hook 或開機啟動 | 只在被呼叫時執行 |
| 不常駐 | 背景行程在 `stop` 或閒置 15 分鐘後結束 |

## 複核時請特別看的地方

| 風險點 | 現行做法 | 位置 |
|---|---|---|
| 程式控制瀏覽器 | 使用 `--remote-debugging-pipe`，非 `--remote-debugging-port` | `BrowserSession.launch` |
| 可瀏覽的範圍 | 主機白名單，預設僅 `localhost`、`127.0.0.1`、`[::1]`；攔截所有 Document 類請求；本機檔案只允許開啟 `.html`／`.htm`，其他類型一律拒絕 | `isAllowed`、`onRequestPaused`、`toUrl` |
| 密碼處理 | 預設由使用者在瀏覽器視窗自行登入，密碼不經過工具；自動填入時僅接受以 `--typed` 明確標示的對話輸入；步驟檔不能填密碼欄位；指令檔讀取後立即刪除 | `handle` 的 `fill`、`buildCommand`、`serve` |
| 輸出中的機敏資訊 | 網址去除 query；密碼欄位值不輸出 | `stripUrl`、`PAGE_ELEMENTS` |
| 行程間溝通 | 以 session 目錄內的檔案交換指令與結果，位於使用者的暫存目錄 | `dispatch`、`serve` |
| 殘留資料 | 結束時刪除整個 session 目錄；異常結束時下次啟動會清掉 | `serve` 的 `finally`、`readCurrent`、`stop` |
| 行程殘留 | 瀏覽器結束即中止所有等待中的指令；`stop` 逾時會強制終止 | `CdpPipe.close`、`stop` |

## 已知的殘餘風險

- **白名單不涵蓋子資源**：已允許的頁面自己發出的 API、圖片、腳本請求不受限。
- **頁面內容會送進模型**：頁面文字與截圖是 Claude 判斷的依據。對策是 skill 規定只用測試帳號與測試資料，並限本機或開發環境。
- **密碼會短暫寫入暫存檔**：自動填入密碼時，指令檔由背景行程讀取後立即刪除，存在時間為毫秒級，位置在使用者自己的暫存目錄。
- **對話中給的密碼會留在對話紀錄**：使用 `--typed` 時密碼會出現在對話與指令列，並送進模型。僅限測試帳號，正式或真實帳號不得使用。
- **「只測不修」非硬限制**：由 prompt 規則約束，技術上未封鎖檔案寫入。
- **端點防護反應未知**：尚未在公司配發的電腦上執行過。

## 待確認事項

- 公司對「以程式控制瀏覽器」是否有既有規範：未找到規範，請資安單位補充。
- 開發環境主機是否允許加入白名單，以及允許的清單。
- 兩種登入做法（使用者自行登入、對話中給測試密碼）各自是否符合規定，或需改接公司的密碼管理機制。
- QA 報告與截圖的存放位置與保存期限。現行做法：固定存在本機的 QA 工作資料夾底下的 `reports\`，位置是使用者解壓縮的 `qa-report-main` 資料夾底下的 `QA-Workspace`，由安裝步驟建立，並把完整路徑記在 `%USERPROFILE%\.claude\skills\qa-report\workspace-path.txt`；這個檔案不存在或資料夾已不在時，改存到啟動 Claude Code 的資料夾；使用者另外指定位置時依使用者的。工具不會自動刪除舊報告，也不設保存期限。請確認這個位置是否符合規定（例如是否需改放加密磁碟或指定的共用位置），以及保存期限與清除方式。

## 驗證方式

複核人員可自行重現下列檢查：

```powershell
# 啟動一個 session
node skill\scripts\browser-driver.mjs start --out "$env:TEMP\qa-shots"

# 確認啟動參數中沒有偵錯 port
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
  Where-Object { $_.CommandLine -like '*qa-report-driver*' } |
  Select-Object -First 1 -ExpandProperty CommandLine

# 確認白名單生效（預期回傳 host not in allowlist）
node skill\scripts\browser-driver.mjs open https://example.com/

# 結束並確認暫存目錄已清空
node skill\scripts\browser-driver.mjs stop
Get-ChildItem "$env:TEMP\qa-report-driver" -ErrorAction SilentlyContinue
```
