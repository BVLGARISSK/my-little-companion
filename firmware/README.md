# ESP32-S3 小伴韌體

> 此目錄保留舊 ESP32-S3 版本。現行 XIAO ESP32-C5 0.7.11 原始碼與工具在 [c5/](c5/)，請勿把 S3 接腳或 BIN 套用到 C5。


沿用已驗證的 16MB Flash ESP32-S3 與 SH1106 128×64 I²C OLED：SDA GPIO8、SCL GPIO9、VCC 3V3、GND GND，100kHz。USB 使用原板的 UART 連接方式，CDCOnBoot=Disabled，PSRAM 不啟用。

## 功能

- 六種與網頁對應的表情、眨眼、眼睛移動，手動／每六秒自動換表情。
- mlc/1 GATT、每台獨立隨機授權碼、HMAC-SHA256 單次挑戰、跨連線清除授權。
- 開機 5 分鐘開放 BLE 搜尋；未連線就停止廣播。首次連線後改成 10 分鐘上傳閒置計時，成功開始／接收／完成作品上傳或同步播放清單會重設計時。授權、查詢、切換表情或亮度不延長期限。
- 手機中途斷線，可在剩餘上傳閒置時間內重連續傳；重連本身不重設計時。到期會斷線並停止廣播，OLED繼續播放；重新開機或本機 `ble` 指令可再次開放。
- 接收 1～100 格 OLA，5／8／10FPS；CRC32、順序檢查、8包 ACK、断線保存暫存檔、同內容續傳、取消。
- 圖片與動畫寫進 LittleFS；圖庫最多 32 個作品，每次上傳預留 64KiB。沿用既有 default 分割表，只使用前4MiB，媒體區0x290000～0x3EFFFF（原始分割區1.375MiB）。16MB的其餘空間保留。
- 圖庫與播放清單各保留兩份帶序號／CRC的日誌，先寫新媒體再提交索引。驗證失敗保留舊作品。日常掛載失敗不格式化；只有逐位元確認**整個分割區都是0xFF**的首次空白區才初始化。
- 清單支援表情、圖片、動畫、loop／shuffle／once、秒數、停用與動畫repeat；被清單引用的作品拒絕刪除或換成不同類型。
- 亮度、播放模式、手動表情／媒體、清單可在重開機後恢復。
- v0.3.2-s3 新增本機 USB 恢復出廠：清除全部作品、清單、使用者設定與原一般密鑰，重開機產生新一般密鑰；舊的一般配對網址／QR 失效。普通 RESET 按鍵只重新開機。
- v0.3.3-s3 新增每台裝置獨立隨機的管理員授權碼，另存 `mlc-admin` NVS namespace；一般恢復出廠會保留它。一般使用者與管理員都能操作目前的表情、亮度、作品與清單，AUTH 回覆分別為 `role: owner`／`role: admin`。

## 編譯與上傳

Arduino IDE可直接開啟`LittleCompanionS3/LittleCompanionS3.ino`。已使用的環境為 ESP32 core 3.3.12、U8g2 2.36.19、NimBLE-Arduino 2.5.1、ArduinoJson 7.4.3。

板型選`ESP32S3 Dev Module`、Flash Size `16MB`、Partition Scheme `Default 4MB with spiffs`、USB CDC On Boot `Disabled`、PSRAM `Disabled`、Upload Speed `115200`。若換成其他開發板或USB接口，需按實際硬體修改。

PowerShell可執行：

```powershell
.\Build.ps1
.\Upload.ps1 -PortName COM5
.\Pair.ps1 -PortName COM5
.\Pair.ps1 -PortName COM5 -Admin
```

`Build.ps1`需要電腦先安裝Arduino ESP32 core 3.3.12；它會安裝上述三個固定版本程式庫。`Upload.ps1`不會執行整片Flash erase。燒錄前請備份目前Flash並關閉所有序列監控工具。

Windows亦可雙擊`Upload-COM5.cmd`燒錄已編譯的`binaries/`，或雙擊`Pair-COM5.cmd`重新取得私人配對網址並開啟搜尋窗口。若COM埠改變，請改用PowerShell指定`-PortName`。原始碼ZIP需先編譯；另外交付的本機韌體套件已包含實機使用的預編譯檔。

## 手機控制

在iPhone **Bluefy** 開啟 `Pair.ps1`產生的配對網址，開啟S3後5分鐘內按「連接小夥伴」，選`Little Companion S3`。網址片段帶入授權碼，網頁會清除片段並自動授權；只有勾選「記住」才保存授權碼。

作品 → 加入照片 → 存進作品集 → 點作品 → 傳送給小伴 → 在小伴播放。動畫與像素画用同一條路徑。播放清單按「同步給小伴」會先傳所有被引用作品，再提交清單。傳完可讓手機斷線。

Safari仍可製作作品；BLE需要支援Web Bluetooth的瀏覽器。不同瀏覽器的草稿用JSON備份移轉。

## USB診斷

序列速率115200、換行送出：`status`查看OLED地址／畫面CRC／儲存狀態，以及`ble_window_state`（discovery／upload_idle／closed）、`window_ms_left`與`uptime_ms`；`pair`取得一般私人配對資訊；`admin`取得此台管理員資訊；`ble`重新開放5分鐘搜尋，若已連線則重設10分鐘上傳閒置計時；`rotate`／`normal`旋轉OLED。

測試介面亦接受一行JSON，附`rid`並使用同一套AUTH及控制指令，回覆`@REPLY,<rid>,<json>`。USB另外提供`STATUS`與`UPLOAD_DATA {transfer_id,offset,hex}`，僅供本機診斷；它的授權狀態與BLE分開。

## 恢復出廠與取消舊授權

接 USB 後雙擊 `FactoryReset-COM5.cmd`，輸入大寫 `RESET` 確認。它只支援 v0.3.2-s3 以上，會核對裝置狀態、清除吊飾內全部作品／清單／使用者設定、使原一般密鑰失效，並將新配對網址存到本機 `private/`。手機瀏覽器內的草稿不受影響。新網址可重新製作 QR Code；之前印出的**一般 QR** 無法再控制這台吊飾。v0.3.3-s3 的管理員 QR 仍有效。

v0.3.4-s3 也可直接在手機網頁操作：掃描管理員 QR、用 Bluefy 連線，到「裝置 → 交接與恢復出廠 → 完整恢復出廠」，確認清除範圍。吊飾重開機後，請在 5 分鐘內重新用管理員卡連線。網頁核對完成紀錄後顯示新的朋友配對 QR，可儲存 PNG 或複製網址。一般授權不能重設，也不能讀取配對碼；管理員卡保留，舊一般卡失效。未重設時也可使用「取得朋友配對 QR」讀取目前的一般卡。

其他 COM 埠可執行 `FactoryReset.ps1 -PortName COM6`。USB 序列命令為 `factory-reset <device_id>`；缺少或填錯 ID 不會重設。重設意圖及独立守衛先存入 NVS，斷電後會在開放 BLE 前繼續完成清除；清除失敗不宣告成功。BLE 重設另外需要管理員 HMAC、正確裝置 ID 和 60 秒內單次確認 token。

## 管理員碼與一般配對卡

給朋友使用一般 QR 卡；管理員 QR 卡由裝置管理者自行保管。兩者使用同一控制網址與 HMAC 單次挑戰，網頁只依裝置 AUTH 的成功回覆顯示「管理員已授權」，不依網址宣告權限。沒有全機共用或硬編碼的管理員密碼。

接 USB 後雙擊 `AdminPair-COM5.cmd`，或執行 `Pair.ps1 -PortName COM5 -Admin`，可取得管理員網址，儲存為本機 `private/admin-pairing-private.json` 與 `admin-phone-pairing.txt`；不覆蓋一般配對檔。管理員碼不透過 BLE 查詢、不放進 GitHub、也不包含在瀏覽器作品備份。

保留範圍是本專案的恢復出廠流程與一般重開機／不擦除 NVS 的韌體更新；整片 Flash／NVS 擦除或更換主板後不保留。v0.3.4-s3 的一般配對碼經 AES-GCM 加密回傳給管理員，由瀏覽器在本機解密並畫 QR，不回傳管理員碼。OTA 尚未實作。

## 驗證界線

實機證據見`../docs/firmware-verification.md`。HMAC驗證装置控制權；本版未增加BLE bonding／加密，CRC32只用於傳輸完整性。電池量測、低電量保護、電池充電、OTA與原LeroyD網站的Wi-Fi／天氣等功能未實作，因此不會宣告相關能力。

API參考：[NimBLE官方範例](https://github.com/h2zero/NimBLE-Arduino/blob/master/examples/NimBLE_Server/NimBLE_Server.ino)、[Espressif Arduino文件](https://docs.espressif.com/projects/arduino-esp32/en/latest/)。
