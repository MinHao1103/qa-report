# qa-report：只測不修的 QA

給 Claude Code 用的 skill。給它網址和要檢查的事，它會開瀏覽器實際去看，交一份附截圖的報告。只看畫面，不讀原始碼，不改任何東西。

需要：Windows、Claude Code、Node 22 以上、Edge 或 Chrome。

## 教學：檢查網頁有沒有簡體字

### 第 1 步：下載

按綠色的 **Code** 按鈕，選 **Download ZIP**，解壓縮後把 `qa-report-main` 資料夾放到 C 槽或 D 槽。下面的說明以放在 D 槽為例，也就是 `D:\qa-report-main`；放在 C 槽的話，路徑裡的 `D:` 請自行換成 `C:`。

### 第 2 步：安裝

1. 用檔案總管打開 `D:\qa-report-main`，在網址列輸入 `cmd` 按 Enter。如果打開後裡面只有另一個 `qa-report-main` 資料夾，請再點進去，要在看得到 `INSTALL.md` 的那一層。
2. 輸入 `claude` 按 Enter。
3. 輸入：`請閱讀 INSTALL.md，幫我安裝這個 skill`
4. 看到「安裝完成」就好了。它會順便在 `qa-report-main` 裡面建好放報告的資料夾 `QA-Workspace`，並告訴你位置。

![安裝示意圖](docs/images/install.png)

### 第 3 步：看一下要檢查的網頁

練習用的網頁是 `D:\qa-report-main\examples\demo-page\index.html`：

![練習用的網頁](docs/images/demo-page.png)

裡面有 4 處簡體字：

| 位置 | 網頁上寫的 | 繁體應該是 |
|---|---|---|
| 選單第四項 | **联**系我們 | 聯繫我們 |
| 「關於我們」第二段 | 免費無線**网络** | 免費無線網路 |
| 「菜單」最後一列 | 本月**优**惠 | 本月優惠 |
| 最下方的按鈕 | 立即注**册** | 立即註冊 |

## 要用的時候

報告固定存在安裝時建好的 `D:\qa-report-main\QA-Workspace` 裡。建議以後都從這個資料夾啟動 Claude Code；從其他資料夾啟動也能用 `/qa-report`，報告一樣會存到這裡。

安裝後請不要搬動或改名 `qa-report-main`，搬了就要重新安裝一次。之後要更新 skill 時，用新下載的檔案覆蓋就好，不要把整個 `qa-report-main` 刪掉，否則裡面的報告會一起不見。

### 開始測試

1. 用檔案總管打開 `D:\qa-report-main\QA-Workspace`，在網址列輸入 `cmd` 按 Enter，再輸入 `claude` 按 Enter。
2. 輸入指令。先用練習網頁試一次：

   ```
   /qa-report D:\qa-report-main\examples\demo-page\index.html 檢查這個網頁有沒有簡體字
   ```

   之後把網址和後面那句話換成你要的：

   ```
   /qa-report https://你的網站 檢查這個網頁有沒有簡體字
   /qa-report https://你的網站 測一下聯絡表單
   ```

### 看報告

點它回覆的連結：

![報告頁面](docs/images/report.png)

每測一次，`reports` 底下會多一個以日期時間開頭的資料夾，裡面的檔案照產生順序編號：

```
D:\qa-report-main\QA-Workspace\
└─ reports\
   ├─ 20261117-103321-demo-page\
   │  ├─ 1_plan.md             測試前寫的計畫
   │  ├─ 2_screenshots\        截圖
   │  └─ 3_qa-report.html      報告，用瀏覽器打開
   └─ 20261118-141502-你的網站\
```

### 其他

- **要登入的網站**：它會跳出瀏覽器視窗讓你自己登入。
- **要參考的文件**：放進 `D:\qa-report-main\QA-Workspace\docs\`，在指令裡提到檔名。
- **請只用測試帳號和測試資料**：畫面和截圖會送給 AI 判斷。
