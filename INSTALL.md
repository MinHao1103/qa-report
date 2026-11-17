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

3. **準備 QA 工作資料夾**：報告以後固定存在這裡。位置是本資料夾底下的 `QA-Workspace`。

   - 已經存在就直接沿用，不要動裡面的東西。
   - 不存在就建立，並在裡面建立 `reports` 與 `docs` 兩個子資料夾。
   - 把它的完整路徑寫進 `%USERPROFILE%\.claude\skills\qa-report\workspace-path.txt`，檔案只有這一行。skill 執行時靠這個檔案找到工作資料夾，所以這一步要在步驟 2 之後做，而且每次安裝都要重寫。

   ```powershell
   $ws = "<本資料夾的完整路徑>\QA-Workspace"
   New-Item -ItemType Directory -Force "$ws\reports", "$ws\docs"
   Set-Content -Path "$env:USERPROFILE\.claude\skills\qa-report\workspace-path.txt" -Value $ws -Encoding utf8
   ```

   建立失敗時（例如本資料夾不可寫入）停下來告訴使用者，不要改建在其他地方。

4. **確認裝好了**：
   - skill 的目的資料夾裡至少有這五個檔案：`SKILL.md`、`drivers\README.md`、`drivers\web.md`、`scripts\browser-driver.mjs`、`templates\report-template.md`。
   - 執行 `node "$env:USERPROFILE\.claude\skills\qa-report\scripts\browser-driver.mjs" status`。預期的結果是回傳的 JSON 裡 `error` 為 `no session running. run "start" first`，而且結束代碼是 1。這代表程式可以執行，不是安裝失敗，不要重試。
   - QA 工作資料夾存在，而且 `workspace-path.txt` 裡的路徑就是它。

5. **回報**：用一兩句話告訴使用者安裝完成，這個視窗可以關掉，並告訴他：

   - QA 工作資料夾的完整路徑，以及它是這次新建的還是原本就有的。報告以後都存在它底下的 `reports\`。
   - 建議以後從這個資料夾啟動 Claude Code。從其他資料夾啟動也能用，報告一樣存到這裡。
   - 安裝後不要搬動或改名本資料夾，搬了要重新安裝一次；更新時用新檔案覆蓋，不要整個刪掉，報告才不會不見。
   - 可以用練習網頁試一次。指令裡的路徑請換成本資料夾底下該檔案的完整路徑再告訴使用者：

     ```
     /qa-report <本資料夾的完整路徑>\examples\demo-page\index.html 檢查這個網頁有沒有簡體字
     ```

## 不要做的事

- 不要安裝任何 npm 套件或其他軟體，這個 skill 不需要。
- 不要修改本資料夾裡的任何檔案。唯一的例外是步驟 3 建立 `QA-Workspace` 資料夾。
- 不要動 `%USERPROFILE%\.claude\skills\` 底下其他的 skill。
- QA 工作資料夾已經存在時，不要刪除、搬移或覆蓋裡面的任何東西。
- 安裝時不要順便執行測試，等使用者自己下指令。
