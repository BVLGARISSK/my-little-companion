# My Little Companion BLE protocol · mlc/1

這份契約供手機網頁與 S3／C5 韌體共同使用。本公開儲存庫的 S3 程式位於 `firmware/LittleCompanionS3`，實機紀錄見 [firmware-verification.md](firmware-verification.md)。C5 程式與驗證紀錄另保留在本機交付套件。

## GATT

| 用途 | UUID | 權限 |
|---|---|---|
| Service | `c07e0001-7d3b-4f2f-a86e-5c87b6ab1d10` | 廣播 UUID |
| CONTROL | `c07e0002-7d3b-4f2f-a86e-5c87b6ab1d10` | Write with response |
| DATA | `c07e0003-7d3b-4f2f-a86e-5c87b6ab1d10` | Write without response |
| EVENT | `c07e0004-7d3b-4f2f-a86e-5c87b6ab1d10` | Notify |
| INFO | `c07e0005-7d3b-4f2f-a86e-5c87b6ab1d10` | Read，支援 long read |

INFO 為 UTF-8 JSON，建議 ≤512 bytes：

```json
{"protocol":"mlc/1","device_id":"mlc-123","name":"Little Companion","firmware":"0.3.0","max_write_bytes":20,"capabilities":["emotion","media","playlist","brightness"],"battery_mv":3980,"storage_total":3342336,"storage_free":2500000}
```

`battery_mv`、`battery_percent`、`storage_total`、`storage_free` 可缺省，網頁會顯示未知。`battery_percent` 必須有實测校準，不能虛構。`max_write_bytes` 是實際 ATT characteristic value 容量，包含以下 8-byte header；須 ≤ negotiated MTU −3 且 ≤244。若還沒取得可靠值，公布 20。INFO 読取之後若 MTU 尚未協商完成，20 仍合法。能力沒有實作就不要列入。

C5 0.4.2 新增 `battery_mv`、`battery_type: "lipo_1s"` 與能力 `battery_voltage`。電壓使用 XIAO 板上 GPIO6 ADC／GPIO26 量測開關，16 次取樣平均後乘 2 還原分壓，依據 [Seeed 官方文件](https://wiki.seeedstudio.com/xiao_esp32c5_getting_started/#check-the-battery-voltage)。韌體每 30 秒更新快照；BLE INFO 只讀該快照，不重新取樣、不喚醒 OLED、不重設 BLE 上傳閒置計時。INFO 仍使用 long read 且不超過 512 bytes。

網頁 1.0.14 只在 `battery_type` 明確為 `lipo_1s` 時，依通用 4.2 V 滿電鋰聚合物參考曲線估算百分比，取最接近的 5%，標示「約」。此估計只在網頁產生，不當作已校準的 `battery_percent` 傳回協定。參考節點（mV→%）為 3300→0、3500→5、3600→10、3700→20、3750→35、3800→50、3850→60、3900→70、3950→80、4000→85、4100→95、4200→100；中間線性內插。這是工程選用的粗略曲線，沒有這顆實際電池的放電校準，負載、溫度、充電與老化皆會影響結果，不代表精確容量或剩餘時間。

網頁在前景且已授權連線時每 30 秒讀取 INFO，切回前景也讀取；同步、授權、控制請求或另一筆讀取中會略過本次更新。INFO 回覆不取代授權流程所保留的裝置物件，斷線後的舊回覆不會套用到新連線。

C5 0.4.3／網頁 1.0.15 新增 `usb_host_connected`（boolean）、`charging_state`（目前固定 `"unknown"`）與能力 `usb_host_status`。USB 狀態使用目前 SDK 的 `usb_serial_jtag_is_connected()`，依主機 SOF 判斷 USB 資料連線，串口程式沒有開啟時也可以為 true；充電器／行動電源沒有 USB 主機 SOF 時為 false。主迴圈每 250 ms 更新，變化持續至少 500 ms 後才更新原子快照。這項資訊不代表 VBUS 供電、正在收發串口指令、電池正在充電或已充滿。INFO 讀取仍不改 OLED 與 BLE 閒置計時，網頁沿用 30 秒更新與前景切換更新。

網頁顯示「USB 資料連線中」或「未連接 USB 主機」；舊韌體缺少 boolean 時顯示「需要更新韌體」。充電欄位只依明確的充電晶片狀態：`charging`→「正在充電」、`not_charging`→「未在充電」，未知／缺少／無效資料→「目前無法讀取」。目前標準板接線沒有把充電晶片 NCHG 接到主控 GPIO，不能從電池電壓或 USB 連線推算正在充電，依據 [Seeed 官方電路圖](https://files.seeedstudio.com/wiki/XIAO_ESP32C5/res/Seeed_Studio_XIAO_ESP32C5.pdf)。本次沒有接線變更，沒有宣告實作充電辨識。

## CONTROL／EVENT 的共同 JSON 分包

所有整數 little-endian。每包必須 ≥9 bytes。

| Byte | 型別 | 內容 |
|---|---|---|
| 0 | u8 | version=1 |
| 1 | u8 | kind=1 指令；kind=2 回覆／事件 |
| 2–3 | u16 | request_id：1–65535，0 留給非同步事件 |
| 4–5 | u16 | 完整 UTF-8 JSON 長度，≤16384 |
| 6–7 | u16 | 此包在 JSON 中的 byte offset |
| 8… | bytes | JSON 的一段，必須按 offset 連續送達 |

每個分包 Write with response 成功只表示 ATT 接收成功。完整指令執行後，韌體必須從 EVENT 回送同一 request_id、kind=2 的完整結果：`{"ok":true,...}`；失敗為 `{"ok":false,"error":"CODE","message":"人類可讀原因"}`。Notify 同樣分包，最大值取實際 MTU 容量。每個 JSON 回覆的分包不可缺失或重排；網頁會拒絕並要求重新連線。一般完整指令回覆期限 12 秒，檔案提交／清單提交 30 秒；韌體應對照實際 Flash 延遲驗證。

重新連線要清除未完成 JSON、授權與舊連線 ACK 狀態。最多 8 個未完成訊息，15 秒回收。禁止跨連線共享 authorization flag。

## 授權

1. 每台吊飾有獨立的 32-byte 隨機一般 key；v0.3.3-s3 另有獨立的 32-byte 隨機管理員 key，網頁沒有共用密碼。一般 key 位於 `mlc-s3`，管理員 key 位於 `mlc-admin`；本機恢復出廠只清除前者與使用者資料，保留管理員 key。
2. 網頁產生 16-byte client nonce，CONTROL 傳 `{"op":"AUTH_CHALLENGE","client_nonce":"32 hex chars"}`。
3. 裝置以安全亂數回覆新的 32-byte server nonce：`{"ok":true,"server_nonce":"64 hex chars"}`。綁定目前 BLE 連線與 client nonce，只能使用一次。
4. HMAC-SHA256 的輸入為 UTF-8 `mlc/1:<device_id>:<client_nonce>:<server_nonce>`，nonce 固定小寫 hex。
5. CONTROL `{"op":"AUTH","client_nonce":"...","proof":"64 hex chars"}`。裝置對一般與管理員 key 分別計算 HMAC 並用 constant-time compare 驗證，回覆 `{"ok":true,"role":"owner"}` 或 `{"ok":true,"role":"admin"}`。網頁將舊版未回報 role 的成功授權視為 owner。錯誤、中斷、逾時都銷毀 challenge；挑戰最長 15 秒。
6. 未授權只能讀 INFO、訂閱 EVENT、取得 challenge 和 AUTH。所有控制、上傳與刪除指令都要檢查目前連線已授權。

QR 小卡網址格式：`https://bvlgarissk.github.io/my-little-companion/#device=mlc-123&key=<64hex>`。只使用 fragment，不放 query；網頁讀取後立即清除 fragment。網址沒有實際 key，文件也不能放出廠 key。使用者明確勾選「記住」才寫入當前瀏覽器 IndexedDB，備份排除 key。

兩種卡片使用相同網址格式；身分依裝置驗證結果決定。v0.3.4-s3 的管理員另可透過 BLE 恢復出廠並取得一般配對卡。管理員碼本身只經本機 USB `admin` 指令取得，BLE 不提供讀取管理員碼的指令。整片 Flash／NVS 擦除不在保留承諾內。

此機制用於裝置所有權驗證，不提供傳輸內容加密或對所有後續封包的端到端認證。正式送禮之前應驗證 BLE 加密鏈路／bonding 相容性，或增加經審核的 session frame 認證與加密；不要把 CRC32 說成安全簽章。

## 控制指令

| op | 欄位 | 能力 |
|---|---|---|
| SET_EMOTION | emotion=`neutral/happy/sad/surprised/sleepy/angry`，mode=`manual/auto` | emotion |
| SET_BRIGHTNESS | value=1–255 | brightness |
| PLAY_MEDIA | id=32 lowercase hex | media |
| PLAY_PLAYLIST | 無 | playlist |
| LIST_MEDIA | 無，回覆 items=`[{id,kind,name,length}]` | media |
| DELETE_MEDIA | id，若仍被清單引用就拒絕 | media |
| SET_PLAYLIST | playlist 見下 | playlist |
| FACTORY_RESET_PREPARE | 管理員；回覆 device_id、32 hex reset_id、expires_ms=60000 | factory_reset |
| FACTORY_RESET | 管理員；device_id 與同連線的單次 reset_id；回覆 stage=restarting | factory_reset |
| FACTORY_RESET_STATUS | 管理員；回覆 device_id、completed_reset_id、storage_ready、作品／清單數 | factory_reset |
| GET_OWNER_PAIRING | 管理員；回覆 device_id、nonce、ciphertext、tag，沒有明文 key | owner_pairing |

完整恢復出廠的網頁流程：先由使用者確認清除範圍，再 PREPARE，將裝置 ID 與 reset_id 存入瀏覽器（不含密鑰），最後 COMMIT。確認 token 在 60 秒後、AUTH 嘗試或斷線後失效，每次 COMMIT 嘗試也會消耗 token。未授權、普通 owner、錯誤裝置、無效 token、進行中的作品傳送均拒絕重設。重設要求寫入 NVS 後，不因手機斷線取消，也不會由網頁自動重試。

吊飾先回覆 restarting，再排空回覆佇列並重開機。`mlc-admin/reset_active` 保留獨立清除守衛，重設時只格式化媒體分區與清除 `mlc-s3`；一般碼、預設設定、儲存區與完成紀錄都建立後才清除守衛、開放 BLE。重新連線以管理員授權，網頁只在 completed_reset_id 與先前要求相同、device_id 相同、storage_ready=true 時宣告完成；斷線或 restarting 回覆本身不表示完成。管理員 key 保留，普通 owner key 更換。手機作品與播放清單草稿保留。

一般配對碼以 AES-256-GCM 加密回傳：key 為已驗證的此台管理員 key，nonce 是每次新產生的 12-byte 亂數，AAD 是 UTF-8 `mlc/1:owner-pairing:<device_id>`，明文為 32-byte owner key，ciphertext 為 32 bytes、tag 為 16 bytes，所有輸出皆 hex。瀏覽器使用 WebCrypto 驗證 tag 並解密，再在本機畫 QR；沒有呼叫第三方 QR 服務。此保護只適用一般碼回傳，其他 BLE 內容仍未加密。管理員 key 僅在已驗證連線的記憶體中保留，斷線即清除；一般卡網址及畫布也會清除。作品備份不包含 key、配對網址或重設紀錄。

每次 LIST_MEDIA 完整回覆不得超過 16384 bytes；韌體可限制裝置圖庫項目數與顯示名稱以維持此上限。若未來需分页，应升级契约与客户端。

## 媒體上傳

所有圖片、動畫使用 OLA1 容器，圖片一格。ID 固定 32 lowercase hex，不直接把使用者名稱當路徑。

1. `UPLOAD_BEGIN`：`{op,id,kind,name,length,crc32}`。`crc32` 是**整個 OLA 檔案**的 IEEE CRC32 unsigned u32。回覆 `{ok:true,transfer_id,offset,window_packets}`。
2. `transfer_id` 為 1–65535。`offset` 為已寫入且可確認的暫存檔 byte 數。只在相同媒體 ID、length、CRC 完全相符時續傳；不同資料不能沿用舊 offset。圖庫空間需考慮新舊檔案共存、暫存檔與預留空間，空間不足在 BEGIN 拒絕。
3. DATA 使用下面 header＋payload。網頁最多連送 `window_packets`（1–8）包，再等持久化 ACK。**最後一包即使不足一個 window，也必须立刻 ACK**。
4. EVENT request_id=0：`{"event":"upload_ack","transfer_id":1,"offset":1234}`，offset 只確認已持久化的連續前綴。不要在排入 RAM 佇列時就回報成功。
5. 遺漏 ACK，網頁 7 秒後查 `UPLOAD_STATUS {transfer_id}`。回覆 `{ok:true,offset}`；最多連續查詢重試 3 次。既有重複 offset 包需冪等處理／拒絕後給出可靠 offset，不可重複 append。
6. `UPLOAD_END {transfer_id}`。核對整檔長度／CRC、OLA 標頭與 payload CRC；完成後以 atomic rename／journal 更新作品與索引，才回 `{ok:true}`。舊作品在驗證前保留。重啟後要可恢復有效索引。
7. `UPLOAD_CANCEL {transfer_id}` 清除本次暫存工作，保留已提交作品。一般意外斷線保留確認過的 temp metadata，供相同 BEGIN 查詢續傳。

DATA header：

| Byte | 型別 | 內容 |
|---|---|---|
| 0 | u8 | version=1 |
| 1 | u8 | reserved=0 |
| 2–3 | u16 | transfer_id |
| 4–7 | u32 | 檔案 byte offset |
| 8… | bytes | 原始 OLA 檔案資料 |

預設20-byte application value，payload=12 bytes。若裝置公布上限 244，payload=236。Web Bluetooth 本身不提供通用 MTU 讀取方法，所以不能假設每支手機支援 200-byte payload。

## 播放清單

```json
{"version":1,"name":"My little day","mode":"loop","items":[{"type":"emotion","id":"happy","duration_ms":5000,"repeat":true,"enabled":true},{"type":"image","id":"0123456789abcdef0123456789abcdef","duration_ms":3000,"repeat":true,"enabled":true}]}
```

最多64項；mode=loop/shuffle/once；duration_ms 是1000–600000之間的整數。enabled=false 項目保留但跳過。媒體 ID 必須存在且類型相符。網頁目前建立的動畫 repeat=true，動畫在項目停留時間內循環；once 指整個清單播放一次。空清單／全部停用不允許同步。

網頁先同步清單引用的**所有作品（包括停用項目）**，全部成功才送 SET_PLAYLIST。韌體再做引用驗證，寫 temp、驗證、原子更新，最後回覆成功。任何失敗時保留舊清單，不要清空已完成媒體。網頁不會自動刪除未引用的吊飾作品。

## 韌體待驗收

- ESP32-S3 v0.3.1：開機5分鐘未連線則停止廣播；第一次連線後，以最後一次有效作品上傳（BEGIN／DATA／END）或SET_PLAYLIST起算10分鐘，沒有上傳則從第一次連線起算。一般控制、授權、UPLOAD_STATUS輪詢與重連不延長期限。到期斷線並停止廣播。
- 手機 lock／背景可能中斷 BLE，可在剩餘閒置時間重連並重新授權；HMAC challenge仍在15秒後過期。重新開機或本機`ble`可重開窗口。
- 小包／大包、隨機斷線、重複 DATA、丟 ACK、圖庫滿、上傳時斷電、清單提交時斷電。
- C5 Flash、LittleFS 與播放工作可並行，不因寫檔停止 OLED。LittleFS 不可在日常掛載失敗時自動格式化。
- 未來 OTA 另設 capability，簽章與板型／版本驗證在 C5 端執行，目前網頁不傳韌體。


## 運作 RAM 與作品容量

網頁 1.2.3 將作品檔案容量（`storage_total`／`storage_free`，來自 LittleFS）和運作 RAM 分開顯示。C5 0.6.1 在 INFO 增加 `memory` 能力；已授權客戶端使用 `GET_MEMORY`，回覆 `device_id`、`ram_scope: "internal_8bit_heap"`、`ram_total`、`ram_free`、`ram_largest_block` 和 `ram_sampled_ms`（位元組／開機毫秒）。

RAM 讀取使用 ESP-IDF 的 `MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT`：`heap_caps_get_total_size()` 回報可動態分配區域總量，`heap_caps_get_info()` 回報當下可用量及最大連續可用區塊。這是執行中的 heap 資料，排除了 Flash、外部 PSRAM 與已分配給程式的靜態區域。來源見 [Espressif 記憶體 API](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32c5/api-reference/system/mem_alloc.html)。

GET_MEMORY 在主迴圈處理，不改播放、亮度、靜止計時或 BLE 上傳閒置窗口。INFO 僅加上能力名稱，RAM 數據走原有可分片的 EVENT 回覆，避免 INFO 超過 512 bytes。網頁在授權後、每 30 秒前景更新、手動更新，以及作品傳送／清單同步／裝置作品刪除後讀取；忙碌時跳過。斷線會清除 RAM 顯示，延遲回覆不會套用到新連線；不支援的韌體顯示更新提示。
# C5 0.7.0 選用擴充

INFO 的 `extras` 與 `smart_sync` 能力表示下列命令可用。所有命令仍需一般或管理員 HMAC 授權；完整回覆走可分片 EVENT，INFO 保持 GATT 512 bytes 限制。新增能力不改既有 UUID／封包／授權流程。

|命令|欄位及用途|
|---|---|
|GET_EXTRAS|只讀取 settings／runtime，不喚醒 OLED、不重設靜止／BLE 窗口|
|SAVE_EXTRAS|settings：schema version=1；八種規則、姿勢、電壓與省電參數；先完整驗證與 NVS 寫入成功才替換|
|CALIBRATE_POSE|保持正向不動，記錄重力基準|
|TOUCH_LOCK|locked：boolean，鎖定／解除短按|
|SET_TIME|epoch_ms：UTC 毫秒，offset_min：-720～840；已運行計時器保留剩餘時間|
|CLOCK|enabled：boolean；關閉時恢復原播放，進行中的計時不取消|
|GAME|game：dice／maze／dodge／none|
|TIMER|action：start／pause／resume／cancel；start 含 mode=countdown／pomodoro、duration_s 1～86400、focus_s 60～7200、break_s 60～3600、long_break_s 60～7200、rounds 1～8|
|PLAN_SYNC|works：最多 32 筆含 id／kind／name／length／crc32／sha256／選用 subtitle；只讀取，回 items、needed_bytes、free_bytes、reserve_bytes、existing_works、new_works、max_works、fits、device_id|

UPLOAD_BEGIN 可選 `sha256` 和 `skip_if_match:true`；只有實際檔案 hash 與所有播放描述一致，才回 `skip:true,verified:true`，無 transfer_id、不需 DATA／END。一般上傳含 hash 時，UPLOAD_END 額外驗證 hash；失敗保留舊作品。設定規則引用的作品不能刪除，須先解除綁定。schema 與限制見 [日常玩法](daily-play.md) 及 web-app/js/experience-format.js。
