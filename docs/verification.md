# 網頁驗證紀錄 · 2026-10-10

## 已完成

- Node.js 測試17項全通過：IEEE CRC32 golden value、row-major LSB位元排列、OLA golden header與損毀拒絕、透明像素／反相、整數倍放大、備份格式、UTF-8分包重組／遺漏拒絕、DATA offset、HMAC nonce綁定、清單引用與型別檢查、mock BLE的早到ACK／授權拒絕／斷線／取消，以及慢速CONTROL分包後才啟動回覆期限、無回覆仍會逾時。
- JavaScript語法、HTML ID、靜態資源與離線殼檔案檢查通過。
- GitHub Actions在Linux Node22執行相同測試並部署GitHub Pages。
- Codex in-app browser：桌面與390×844手機尺寸版面檢查。
- 用滑鼠拖畫線条、複製影格、儲存作品，重新整理後作品仍可讀取。
- 測試PNG照片匯入、抖色、存入作品集。
- 測試含多個disposal模式的GIF：0.6秒來源轉為5格、8FPS作品，成功保存。
- 測試自行產生的H.264 MP4：2秒來源轉為16格、8FPS、16KiB payload，成功保存。
- 播放清單新增、手機預覽；JSON備份匯入確認、原有作品保留與匯出下載。
- 瀏覽器測試沒有觀察到JavaScript error／warning。

測試檔案為自行生成的圖形與色條；没有處理使用者相簿。UI草稿不會放入Git儲存庫。

## 尚待實機驗收

- 真實iPhone／Bluefy的BLE裝置搜尋、GATT接收、MTU容量、授權、速度與背景／鎖屏中斷。
- C5韌體、SH1106顯示、Flash／LittleFS斷電保存、斷線續傳、容量不足及180秒廣播窗口。
- Bluefy的影片解碼／Service Worker與無網路啟動；HEVC／HDR沒有保證。
- 實機電量、充電、續航與天線／外殼。
- OTA簽章、低電量保護與Bootloader Rollback；網頁目前未啟用OTA。

另已加入ESP32-S3的SH1106韌體，USB與Windows真實BLE驗證見[韌體實機紀錄](firmware-verification.md)。上述C5仍未移植／驗收。

Mock BLE只證明網頁封包與狀態機的特定測試通過，不能代替真實無線傳輸。手機尺寸截圖只驗證响应式版面，不能當成iPhone實機證據。
