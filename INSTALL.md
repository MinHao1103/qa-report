# 安裝步驟（給 Claude 讀的）

使用者請你安裝 qa-report skill 時，照下面的步驟做。這份文件所在的資料夾就是 repo 的根目錄，下面稱為「本資料夾」。

## 步驟

1. **檢查環境**，有任何一項不符就停下來告訴使用者缺什麼，不要自己安裝：
   - 作業系統是 Windows。
   - `node --version` 是 22 以上。
   - 電腦上有 Edge 或 Chrome。檢查下列路徑，有任何一個存在就算通過：
     - `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
     - `C:\Program Files\Microsoft\Edge\Application\msedge.exe`
     - `C:\Program Files\Google\Chrome\Application\chrome.exe`
     - `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`

2. **複製 skill**：把本資料夾底下 `skill\` 裡的所有內容，複製到 `%USERPROFILE%\.claude\skills\qa-report\`。目的資料夾不存在就建立；已經有舊版就直接覆蓋。

   ```powershell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills\qa-report"
   Copy-Item "<本資料夾的完整路徑>\skill\*" "$env:USERPROFILE\.claude\skills\qa-report" -Recurse -Force
   ```

   來源請用本資料夾的完整路徑，不要用相對路徑，因為執行指令時的所在位置不一定是本資料夾。

3. **確認裝好了**：
   - 目的資料夾裡至少有這五個檔案：`SKILL.md`、`drivers\README.md`、`drivers\web.md`、`scripts\browser-driver.mjs`、`templates\report-template.md`。
   - 執行 `node "$env:USERPROFILE\.claude\skills\qa-report\scripts\browser-driver.mjs" status`。預期的結果是回傳的 JSON 裡 `error` 為 `no session running. run "start" first`，而且結束代碼是 1。這代表程式可以執行，不是安裝失敗，不要重試。

4. **回報**：用一兩句話告訴使用者安裝完成，並告訴他接下來可以在同一個視窗輸入：

   ```
   /qa-report examples\demo-page\index.html 檢查這個網頁有沒有簡體字
   ```

   這個相對路徑只有在 Claude Code 是從本資料夾啟動時才有效；不是的話，請把路徑換成本資料夾底下該檔案的完整路徑再告訴使用者。

   如果輸入後沒有反應，請他把 Claude Code 關掉重開一次。

## 不要做的事

- 不要安裝任何 npm 套件或其他軟體，這個 skill 不需要。
- 不要修改本資料夾裡的任何檔案。
- 不要動 `%USERPROFILE%\.claude\skills\` 底下其他的 skill。
- 安裝時不要順便執行測試，等使用者自己下指令。
