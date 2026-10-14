# 字幕作品協定

網頁 1.1.0 與 C5 0.5.0 使用既有 mlc/1 授權、UPLOAD_BEGIN／DATA／UPLOAD_END、PLAY_MEDIA 與播放清單，新增能力 `subtitle` 和媒體種類 `subtitle`。S3 或舊 C5 未宣告此能力時，網頁拒絕字幕傳輸。

## 文字與點陣

文字、符號、字型與排版都在瀏覽器處理，沒有文字或字型下載 API。瀏覽器以系統字型產生單色圖，字形以手機預覽為準；不支援的字形可能顯示替代字。字體 8～32 px，最多 160 個 Unicode code point，可換行。支援橫排與中文直排（上到下、右到左），黑體／明體／等寬、粗體、左右／置中對齊。

點陣分割成 128×64 的 OLA 圖塊，橫向先排列，再向下排列。每塊 1024 bytes，row-major、每 byte 低位為較左像素。OLA1 標頭仍為寬 128、高 64；一塊 fps=1，多塊 fps=5。這裡的 fps 只是既有檔案格式相容欄位，圖塊不按動畫播放。最多 32 塊／32768 bytes payload，含標頭最多 32789 bytes。

固定字幕範圍 128×viewport_h；水平捲動寬度≤4096、高度≤viewport_h；垂直捲動寬度≤128、高度≤2048。表情模式 viewport_h=font_px+4（12～36），其他模式=64。固定字幕放不下時會要求縮小字體或捲動，不靜默裁掉文字。

## 傳輸與儲存

UPLOAD_BEGIN 保留 id、kind、name、length、crc32，字幕另帶以下 `subtitle` runtime 物件：

```json
{"version":1,"width":128,"height":64,"viewport_h":64,"face":false,"keep_awake":false,"motion":"fixed","direction":"forward","speed":30,"emotion":"happy"}
```

`motion` 為 fixed／horizontal／vertical，`direction` 為 forward（左／上）或 reverse（右／下），`speed` 為整數 1～120 像素／秒；emotion 沿用六種表情。缺省 keep_awake 視為 false，其他欄位須完整且型別正確。韌體驗證範圍、方向、圖塊數與 length，一次上傳暫存與已提交資料分開。續傳時除了既有 CRC／大小／種類，也要比較全部 runtime 設定；改變速度、表情或方向不能沿用舊設定。

UPLOAD_END 仍核對整個 OLA 檔案 CRC 與 payload CRC，且再次比較圖塊數，之後才提交 library journal。每台裝置仍最多 32 件作品，字幕與照片／動畫共用此配額。

瀏覽器作品另保留 text、font_px、font_family、bold、writing、align 以便複製到編輯器。裝置只存 runtime 設定及點陣，不需中文字庫。完整手機備份會包含字幕；單件字幕匯出為 `.subtitle.json`，保留點陣與設定，匯入時產生新 id，保留原作品。

網頁 1.3.1 新增 `offset_x`／`offset_y`，只保存在瀏覽器的編輯資料，舊作品缺省值為 0。固定字幕可上下／左右偏移，水平跑馬燈只能上下偏移，垂直跑馬燈只能左右偏移。編輯器依實際點亮像素計算可移動範圍並限制偏移，避免新增裁切；表情＋字幕仍限制在下方字幕區。偏移直接寫入點陣圖塊，`subtitleRuntime` 不傳送這兩個欄位，裝置不再位移一次，既有字幕韌體無需更新。預覽、縮圖、備份、智慧同步及裝置播放均使用同一份已偏移點陣；作品變更位置後需要重新傳送。

網頁 1.3.2 將非垂直捲動字幕的上下原點改為實際點亮字形置中，整數取整後兩側空白最多相差 1 px。瀏覽器編輯資料新增 `position_version`（1=舊行高原點，2=字形原點），未提供時驗證為 1。新建立作品使用 2；舊資料重編時換算 offset_y，保留原像素位置並標記 2，避免再次換算。`subtitleRuntime` 不傳送 position_version，韌體、OLA 格式與已存點陣不變。

## 播放

PLAY_MEDIA 可直接播放字幕，並沿用 NVS 的最後播放作品記錄。重開機時從儲存檔載入，因此手機可斷線。播放清單項目新增 type=subtitle，其 id 須引用同種已上傳作品。手機新加入捲動字幕時預設計算一個完整週期的 duration_ms，受既有 1000～600000 ms 範圍限制。

韌體只在開始播放時讀取點陣，最多配置 32 KiB；換作品前先成功載入、驗證新的點陣，失敗保留舊畫面。顯示採既有 33 ms 更新與差分傳輸。表情＋字幕將表情等比例縮到上方，文字限制在下方 viewport；眨眼與搖晃表情保留，短按不會中止字幕。

捲動距離為 floor(elapsed_ms×speed／1000)，一個週期為圖長＋viewport 長＋16 px 空白。repeat=false 時只走完一次並停在末尾。OLED 關屏會暫停捲動／清單計時，喚醒後續播。keep_awake=true 只讓正在播放的這件字幕保持亮屏，不延長 BLE 5／10 分鐘連線窗口；預設 false 沿用 MPU6050 的 60 秒靜止關屏。

## 回滾相容性

0.4.3 以前韌體無字幕能力。回滾前先切回一般表情或不含字幕的舊播放清單；只回滾程式不刪檔案與授權碼，但舊韌體不能正確播放字幕點陣圖塊。原照片／動畫與一般表情的協定和接線不變。
