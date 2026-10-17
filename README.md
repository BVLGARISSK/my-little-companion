# 小伴 · My Little Companion

用手機製作表情、照片、動畫與字幕，再透過藍牙傳給 OLED 吊飾。作品存在吊飾中，離開手機仍能播放。

**[開啟控制網頁](https://quadcopteronline.org/) · [使用說明書](https://quadcopteronline.org/manual/) · [韌體與回滾下載](https://github.com/BVLGARISSK/my-little-companion/releases/tag/c5-v0.7.11)**

## 目前版本

整理日期：2026-10-18。這個儲存庫包含正式網頁、已驗證的 C5 韌體原始碼、舊 S3 韌體、接線文件及操作卡。

|項目|版本／狀態|
|---|---|
|目前主控|Seeed Studio XIAO ESP32-C5，8 MB Flash，無 PSRAM|
|C5 韌體|**0.7.11-c5**，字幕喚醒與偶發停頓修正；不含小恐龍|
|控制網頁|**1.4.4**，配對網址交接與記住授權碼|
|線上說明書|**1.7**，固定網址，可持續更新|
|顯示與感測器|SH1106 128 × 64 I²C OLED、MPU6050、TTP223 觸摸模組|
|回滾基線|0.7.10-c5，保留固定字幕功能|

版本與實測界線見[目前驗證紀錄](docs/current-verification.md)；過去功能紀錄見[版本摘要](CHANGELOG.md)。這次整理沒有改動網站功能，也沒有重新燒錄吊飾。

## 手機開始使用

1. 開啟吊飾，掃描這台吊飾隨附的**專屬配對 QR**。公開說明書 QR 只開說明書，不含授權碼。
2. iPhone 用 Bluefy 開啟配對網址。若先進入 Safari，按「複製配對網址」，將完整網址貼到 Bluefy 網址列。Android 使用支援 Web Bluetooth 的瀏覽器。
3. 開機 5 分鐘內按「尋找小夥伴」，選 `Little Companion C5`。也可長按觸摸區 2 秒重新開放搜尋。
4. QR 中的授權碼會自動填入；成功授權且保留「記住」選項後，儲存在目前瀏覽器。下次開控制網頁並連線即可沿用。Safari、Bluefy、不同手機的儲存各自獨立。
5. 製作作品、加入清單，再按「同步給小伴」。新手機授權後可在「播放」按「讀取吊飾清單」，取得裝置作品目錄與清單；原始照片、影片及可編輯草稿仍需用 JSON 備份移轉。

連線後 10 分鐘沒有上傳作品或同步清單，藍牙會關閉。短按操作依模式而異；[完整操作說明](https://quadcopteronline.org/manual/)與[日常玩法](docs/daily-play.md)有詳細規則。

## 已有功能

- 六種表情、眨眼、傾斜眼神、拿起招呼、搖晃暈眩與安裝方向校正。
- 照片裁切與二值化、縮放與位置、背景填補、像素畫板、GIF／影片抽格與動畫預覽。
- 固定字幕、水平／垂直跑馬燈、中文直排、表情＋字幕；字型、大小、速度、對齊與位置微調。
- **固定播放一則字幕**，不被短按或動作插播切走；也可把字幕加入輪播清單。退出固定播放使用網頁「停止固定播放」或「回到播放清單」。
- 混合播放清單、排序／停用／秒數、循環／隨機／一次、讀取吊飾清單、SHA-256 智慧同步。
- 多擊換作品、短按鎖定、動作綁定、骰子／傾斜迷宮／傾斜躲障礙、時鐘／倒數／番茄鐘。
- 自訂省電方案、調暗、OLED 關屏、淺眠及條件式深眠；電池電壓與估計百分比、USB 資料連線狀態、作品空間與運作 RAM。
- 一般／管理員授權、管理員恢復出廠、取得朋友配對卡；本機 IndexedDB 草稿、OLA 與 JSON 備份。

## 找檔案

|路徑|內容|
|---|---|
|[web-app/](web-app/)|正式網站與 [manual/](web-app/manual/) 線上說明書|
|[firmware/c5/](firmware/c5/)|目前 C5 原始碼、固定版本工具鏈與編譯工具|
|[firmware/README.md](firmware/README.md)|舊 ESP32-S3 程式與工具，保留作為歷史基線|
|[docs/hardware-c5.md](docs/hardware-c5.md)|C5、SH1106、MPU6050、TTP223 接線|
|[docs/release-c5.md](docs/release-c5.md)|下載、初次燒錄、現有板更新與回滾條件|
|[print/operation-card/](print/operation-card/)|A4 雙面四角 4 張操作卡、5 mm 留邊版、SVG 與列印說明|
|[tests/](tests/)／[tools/](tools/)|網頁測試、檢查及本機伺服器|

## 本機開發

網頁使用 Node.js 20 以上。部署用的 GIF decoder 與 QR generator 已放在 `web-app/vendor/`，不依賴外部 QR 服務。

```powershell
npm ci
npm test
npm run check
npm start
```

開啟 http://127.0.0.1:4173/ 。也可使用 `Start-Web.cmd`。ES modules 需透過 HTTP／HTTPS 開啟；照片與影片解碼能力取決於瀏覽器。網頁測試涵蓋格式、協定與模擬 BLE，不能取代手機與吊飾實測。

C5 程式用 **Arduino C++** 撰寫，入口為 [LittleCompanionC5.ino](firmware/c5/LittleCompanionC5/LittleCompanionC5.ino)，主迴圈與 BLE 在 [Companion.cpp](firmware/c5/LittleCompanionC5/Companion.cpp)。編譯見 [C5 開發說明](firmware/c5/README.md)。

## 資料與目前限制

網站與儲存庫是公開的；相片、影片、草稿及授權碼不會由本程式上傳到 GitHub。作品保存在目前瀏覽器與吊飾，不是雲端相簿；請另外保留 JSON／OLA 備份。一般卡可交給朋友，管理員卡需自行保管。完整恢復出廠會重建一般碼，保留該板管理員碼；全片清除或更換主控不保證保留。

**公開檔案不包含實際授權碼、私人配對 QR、NVS、整片 Flash 備份或使用者作品。** 每塊新板自行產生憑證，不能靠公開原始碼取得別人的密鑰。HMAC 授權不等於傳輸內容加密。

充電狀態訊號尚未接入，因此無法判斷「正在充電」；USB 欄位表示資料主機連線。電池百分比為電壓估計，整機電流及續航尚未量測。OTA 尚未實作。Service Worker 離線開啟取決於瀏覽器快取支援。小恐龍 0.7.8／0.7.9 已回滾，現行版沒有此遊戲。

## 發布與授權

推送 `main` 後，GitHub Actions 執行 `npm test`、`npm run check` 並將 `web-app/` 部署到 GitHub Pages。Cloudflare 管理網域；設定見[自訂域名](docs/custom-domain.md)。說明書固定網址與 QR 維護見[說明書更新](docs/manual-updates.md)。韌體二進位與回滾包放在 GitHub Releases，避免把裝置備份混入 Git。

程式採 [MIT](LICENSE) 授權；第三方套件保留各自授權。QR generator 與 GIF decoder 的聲明見 `web-app/vendor/`；Arduino 函式庫依其原始專案授權使用。
