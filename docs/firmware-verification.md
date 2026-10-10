# ESP32-S3 實機驗證 · 2026-10-10

## v0.3.1-s3 連線窗口更新

- 正式參數：開機搜尋5分鐘；第一次連線或最後一次有效作品上傳／清單同步後10分鐘，無上傳則斷線並停止廣播。
- 新版已寫入COM5，寫入區段hash校驗通過；程式702041 bytes，靜態RAM37188 bytes。沒有擦除NVS或LittleFS。
- 使用正式時間參數實測：未連線窗口歸零後停止廣播，再用Windows BLE掃描5秒，未找到裝置。
- 真實HMAC授權與作品上傳成功，BEGIN／DATA／END後閒置窗口重設為10分鐘；無效上傳要求不延長期限。
- 中途實體斷線再連接、重新授權，截止時間保持不變。其後每約30秒查詢LIST_MEDIA，截止時間仍保持不變。
- 等待完整10分鐘無上傳，實機主動斷線並停止廣播；再次掃描5秒未找到裝置。關閉BLE後OLED仍繼續更新。
- 測試只新增自行產生的測試作品，完成後移除。比對更新前的作品清單雜湊，原有8個作品、亮度、播放模式與原授權碼均保留。
- C++編譯期斷言涵蓋5分鐘邊界、接近期限才連線、上傳延長／重連不延長、millis溢位及本機重開窗口；5項通過。網頁24項測試通過。

原始倒數紀錄與更新前資料快照只留在本機私人資料夾。以上BLE測試使用Windows，並未替代iPhone／Bluefy的實機驗收。

## v0.3.0-s3 初次開發與驗證

## 裝置與環境

- 同一塊先前OLED展示用的ESP32-S3，COM5、revision0.2、16MB Quad Flash；偵測到8MB內建PSRAM，本版不依賴PSRAM。
- SH1106 128×64、I²C 0x3C、SDA GPIO8、SCL GPIO9、100kHz。
- 使用者確認新版實際畫面：「有，顯示和動畫正常」。
- Arduino CLI1.5.1、Arduino ESP32 core3.3.12、U8g2 2.36.19、NimBLE-Arduino2.5.1、ArduinoJson7.4.3。
- 最終程式701601 bytes／1310720 bytes，靜態RAM37188 bytes／327680 bytes。FQBN：`esp32:esp32:esp32s3:FlashSize=16M,CDCOnBoot=default,PSRAM=disabled,UploadSpeed=115200`。

## 備份與燒錄

改寫前已讀取前4MiB Flash（4194304 bytes）並保存SHA256，涵蓋所有本次寫入的開機、分割表、NVS、程式及LittleFS區域；不是完整16MB備份。備份只留在本機，沒有上傳GitHub。

確認原媒體分割區0x290000～0x3EFFFF的每個byte都是0xFF。保留原default分割表，首次格式化空白LittleFS。後續燒錄沒有擦除NVS或LittleFS，也沒有執行整片Flash erase。最終燒錄成功，各寫入區段校驗通過。

## 已通過的實機測試

- OLED位址回應、持續更新影格，使用者確認實際畫面和動畫。
- USB診斷使用與BLE共用的指令處理器及獨立授權狀態；真實HMAC-SHA256挑戰驗證成功。
- 由網頁`encodeOLA()`生成測試圖片／16格8FPS動畫，寫入真實LittleFS。
- 播放圖片時，比對韌體輸出的影格CRC與網頁打包資料，完全一致。
- 刻意送錯整檔CRC，UPLOAD_END拒絕提交，舊作品仍可播放。
- 混合表情、圖片、動畫的播放清單正常運行；錯誤表情清單被拒絕。
- 拒絕刪除仍被清單引用的作品；亮度越界被拒絕，正常值可調整。
- Windows Bleak 2.1.1實際搜尋GATT服務、讀取INFO、訂閱通知、HMAC授權、nonce重放拒絕。
- 真實BLE 20-byte CONTROL及DATA分包傳圖成功；協商的較大封包為244 bytes。
- 實體BLE連線斷開後確認授權清除；重新連線／授權後，相同動畫從已確認offset續傳成功。
- 真實BLE LIST_MEDIA保留中文名稱。
- 保持已授權BLE連線至搜尋窗口開啟190秒後，仍可控制表情；斷線後再掃描8秒，沒有重新廣播。未受外部重置干擾的完整重測通過。
- 使用esptool唯讀chip-id命令觸發實際重開機；原授權碼、作品索引、照片影格CRC、16格動畫、混合清單與亮度均恢復。測試結束已切回自動表情、亮度160。

測試作品為本地自行產生的表情點陣，沒有處理私人相簿。原始USB／BLE紀錄、Flash備份、私人配對資訊只留在本機輸出資料夾。

## 仍需驗收

- 真實iPhone／Bluefy的裝置搜尋、授權、傳圖速度、背景／鎖屏行為及影片解碼；Windows BLE成功不能代替iPhone驗收。
- 隨機上傳中斷電、索引提交時斷電、儲存區滿、長時間Flash磨耗與穩定性。
- 電池、充電、低電量、續航、BLE bonding／加密。
- 安全OTA、簽章、Bootloader Rollback；本版沒有宣告OTA能力。

網頁單元測試17項通過，含慢速CONTROL分包後才啟動回覆期限的回歸測試。本機網頁裝置頁載入正常，未觀察到JavaScript warning／error。
