# OLA1 · 固定 128×64 單色影格

所有整數 little-endian。未壓縮，沒有可变時間戳。每張影格 1024 bytes。

| Offset | 長度 | 內容 |
|---|---|---|
| 0 | 4 | ASCII `OLA1` |
| 4 | 1 | version=1 |
| 5 | 2 | width=128 |
| 7 | 2 | height=64 |
| 9 | 2 | frame_count=1–100 |
| 11 | 1 | 圖片=1 FPS；多格動畫=5、8、10 FPS |
| 12 | 1 | encoding=0，完整未壓縮影格 |
| 13 | 4 | payload_length=frame_count×1024 |
| 17 | 4 | payload CRC32（IEEE，unsigned） |
| 21 | N | 依序連接各影格 |

第 `(x,y)` 個像素：`byte=y×16+floor(x/8)`；`bit=x%8`；1=OLED亮、0=暗。因此先左到右，再上到下，每byte LSB first，可搭配 U8g2 的 XBM 畫法。韌體不可直接把這種 row-major bitmap memcpy 到 page-oriented OLED framebuffer，必須按像素格式轉換或用正確的 drawXBMP。

總檔案長度必須恰好 `21+payload_length`。拒絕未知 magic／版本、錯誤寬高、0或>100影格、未支援fps／encoding、長度不符或CRC錯誤。

圖片實際大小1045bytes。10秒10FPS動畫=102421bytes。動畫時長=frame_count/fps，最後一格時間因取樣對齊可能讓實際作品長度比裁切秒數多不到一個影格週期。

`tests/media.test.mjs` 含 golden header 和位元排列範例。`UPLOAD_BEGIN.crc32` 是整個檔案CRC，和offset17的payload CRC不同，韌體都應驗證。
