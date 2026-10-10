# My Little Companion BLE protocol · mlc/1

這份契約由網頁與`firmware/LittleCompanionS3`共同使用。S3的實機紀錄見[firmware-verification.md](firmware-verification.md)。XIAO ESP32-C5尚未移植／實測，原作者OLED展示範例也不能直接使用這個協定。

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

1. 每台吊飾有獨立的 32-byte 隨機 key；印在小卡上，網頁沒有共用密碼。
2. 網頁產生 16-byte client nonce，CONTROL 傳 `{"op":"AUTH_CHALLENGE","client_nonce":"32 hex chars"}`。
3. 裝置以安全亂數回覆新的 32-byte server nonce：`{"ok":true,"server_nonce":"64 hex chars"}`。綁定目前 BLE 連線與 client nonce，只能使用一次。
4. HMAC-SHA256 的輸入為 UTF-8 `mlc/1:<device_id>:<client_nonce>:<server_nonce>`，nonce 固定小寫 hex。
5. CONTROL `{"op":"AUTH","client_nonce":"...","proof":"64 hex chars"}`。裝置用 constant-time compare 驗證後回覆 `{"ok":true}`。錯誤、中斷、逾時都銷毀 challenge。
6. 未授權只能讀 INFO、訂閱 EVENT、取得 challenge 和 AUTH。所有控制、上傳與刪除指令都要檢查目前連線已授權。

QR 小卡網址格式：`https://bvlgarissk.github.io/my-little-companion/#device=mlc-123&key=<64hex>`。只使用 fragment，不放 query；網頁讀取後立即清除 fragment。網址沒有實際 key，文件也不能放出廠 key。使用者明確勾選「記住」才寫入當前瀏覽器 IndexedDB，備份排除 key。

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
