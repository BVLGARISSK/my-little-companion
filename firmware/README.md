# ESP32-S3 小伴韌體

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

## 編譯與上傳

Arduino IDE可直接開啟`LittleCompanionS3/LittleCompanionS3.ino`。已使用的環境為 ESP32 core 3.3.12、U8g2 2.36.19、NimBLE-Arduino 2.5.1、ArduinoJson 7.4.3。

板型選`ESP32S3 Dev Module`、Flash Size `16MB`、Partition Scheme `Default 4MB with spiffs`、USB CDC On Boot `Disabled`、PSRAM `Disabled`、Upload Speed `115200`。若換成其他開發板或USB接口，需按實際硬體修改。

PowerShell可執行：

```powershell
.\Build.ps1
.\Upload.ps1 -PortName COM5
.\Pair.ps1 -PortName COM5
```

`Build.ps1`需要電腦先安裝Arduino ESP32 core 3.3.12；它會安裝上述三個固定版本程式庫。`Upload.ps1`不會執行整片Flash erase。燒錄前請備份目前Flash並關閉所有序列監控工具。

Windows亦可雙擊`Upload-COM5.cmd`燒錄已編譯的`binaries/`，或雙擊`Pair-COM5.cmd`重新取得私人配對網址並開啟搜尋窗口。若COM埠改變，請改用PowerShell指定`-PortName`。原始碼ZIP需先編譯；另外交付的本機韌體套件已包含實機使用的預編譯檔。

## 手機控制

在iPhone **Bluefy** 開啟 `Pair.ps1`產生的配對網址，開啟S3後5分鐘內按「連接小夥伴」，選`Little Companion S3`。網址片段帶入授權碼，網頁會清除片段並自動授權；只有勾選「記住」才保存授權碼。

作品 → 加入照片 → 存進作品集 → 點作品 → 傳送給小伴 → 在小伴播放。動畫與像素画用同一條路徑。播放清單按「同步給小伴」會先傳所有被引用作品，再提交清單。傳完可讓手機斷線。

Safari仍可製作作品；BLE需要支援Web Bluetooth的瀏覽器。不同瀏覽器的草稿用JSON備份移轉。

## USB診斷

序列速率115200、換行送出：`status`查看OLED地址／畫面CRC／儲存狀態，以及`ble_window_state`（discovery／upload_idle／closed）、`window_ms_left`與`uptime_ms`；`pair`取得私人配對資訊；`ble`重新開放5分鐘搜尋，若已連線則重設10分鐘上傳閒置計時；`rotate`／`normal`旋轉OLED。

測試介面亦接受一行JSON，附`rid`並使用同一套AUTH及控制指令，回覆`@REPLY,<rid>,<json>`。USB另外提供`STATUS`與`UPLOAD_DATA {transfer_id,offset,hex}`，僅供本機診斷；它的授權狀態與BLE分開。

## 驗證界線

實機證據見`../docs/firmware-verification.md`。HMAC驗證装置控制權；本版未增加BLE bonding／加密，CRC32只用於傳輸完整性。電池量測、低電量保護、電池充電、OTA與原LeroyD網站的Wi-Fi／天氣等功能未實作，因此不會宣告相關能力。

API參考：[NimBLE官方範例](https://github.com/h2zero/NimBLE-Arduino/blob/master/examples/NimBLE_Server/NimBLE_Server.ino)、[Espressif Arduino文件](https://docs.espressif.com/projects/arduino-esp32/en/latest/)。
