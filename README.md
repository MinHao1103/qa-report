# qa-report：只測不修的 QA

給 Claude Code 用的 skill。給它網址和要檢查的事，它會開瀏覽器實際去看，交一份附截圖的報告。只看畫面，不讀原始碼，不改任何東西。

需要：Windows、Claude Code、Node 22 以上、Edge 或 Chrome。

## 教學：檢查網頁有沒有簡體字

### 第 1 步：下載

按綠色的 **Code** 按鈕，選 **Download ZIP**，解壓縮到 D 槽，得到 `D:\qa-report-main`。

### 第 2 步：安裝

1. 用檔案總管打開 `D:\qa-report-main`，在網址列輸入 `cmd` 按 Enter。
2. 輸入 `claude` 按 Enter。
3. 輸入：`請閱讀 INSTALL.md，幫我安裝這個 skill`
4. 看到「安裝完成」就好了。

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

skill 裝好之後，在電腦上任何資料夾啟動 Claude Code 都能用 `/qa-report`。報告會存在「你啟動 Claude Code 的那個資料夾」裡，所以建議準備一個專門放報告的資料夾，以後都從那裡啟動。

### 準備一個專用資料夾

1. 在你喜歡的位置建立一個資料夾，例如 `D:\QA-Workspace`。
2. 用檔案總管打開它，在網址列輸入 `cmd` 按 Enter，再輸入 `claude` 按 Enter。
3. 輸入指令。先用練習網頁試一次：

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
D:\QA-Workspace\
└─ reports\
   ├─ 20261117-103321-demo-page\
   │  ├─ 1_plan.md             測試前寫的計畫
   │  ├─ 2_screenshots\        截圖
   │  └─ 3_qa-report.html      報告，用瀏覽器打開
   └─ 20261118-141502-你的網站\
```

### 其他

- **要登入的網站**：它會跳出瀏覽器視窗讓你自己登入。
- **要參考的文件**：放進 `D:\QA-Workspace\docs\`，在指令裡提到檔名。
- **請只用測試帳號和測試資料**：畫面和截圖會送給 AI 判斷。
