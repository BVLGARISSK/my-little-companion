# C5 發布、更新與回滾

目前正式版 **0.7.11-c5**，基線 **0.7.10-c5**。下載：[GitHub Release c5-v0.7.11](https://github.com/BVLGARISSK/my-little-companion/releases/tag/c5-v0.7.11)。兩版都沒有小恐龍；0.7.10 保留固定字幕功能。

## 下載內容

|檔案|用途|
|---|---|
|`LittleCompanionC5-0.7.11-app.bin`|已驗證的目前 APP|
|`LittleCompanionC5-0.7.10-rollback-app.bin`|先前穩定基線 APP|
|`LittleCompanionC5-0.7.11-release-with-rollback.zip`|目前來源、APP、0.7.10 原始碼封存與 APP、工具鏈及公開文件|
|`SHA256SUMS.txt`|上述下載檔雜湊|

GitHub 自動產生的 Source code ZIP／tar.gz 只含儲存庫來源，不包含 BIN；需下載上表附件才有預編譯檔。

## 初次燒錄空白板

用 [C5 編譯說明](../firmware/c5/README.md) 的 Arduino IDE／CLI 正常編譯上傳，讓工具建立正確 bootloader、分區表與 APP。單獨的 `app.bin` 不能讓空白板完整開機。

## 更新已設定的 C5

APP-only 檔只適用 **XIAO ESP32-C5、8 MB、`default_8MB` 相同分區配置**。既有 APP 位址 `0x10000`，最大 `0x330000` bytes；NVS 在 `0x9000`、長度 `0x5000`，作品資料分區在 `0x670000`、長度 `0x180000`。不符此配置的裝置先用自己的分區表核對。

先保留手機作品備份與裝置私人備份，中斷手機藍牙，確認 USB 埠、板型與下載檔 SHA-256。以測過的 esptool 5.3.1 為例，將 `<PORT>` 換成實際埠：

```text
python -m esptool --chip esp32c5 --port <PORT> --baud 512000 write-flash 0x10000 LittleCompanionC5-0.7.11-app.bin
```

此命令只寫 APP；不要加 `erase-flash`，也不要把 APP 寫到 0x0。檔案沒有包含 bootloader、NVS、授權碼與作品，不適用 S3／C3。更新完成後確認版本、原 QR 授權與原作品。這台裝配實機曾發生 USB 重啟後不回覆；若出現，拔 USB、關閉電池電源至少 5 秒、確認 OLED 熄滅，再重新供電驗證。

## 回滾到 0.7.10

沿用相同條件與步驟，只將檔名換成 `LittleCompanionC5-0.7.10-rollback-app.bin`。只寫 `0x10000`，保留 NVS、作品分區與分區表。完整斷電再開機後確認版本與內容；個人備份仍需自行保存。

|APP|大小 bytes|SHA-256|
|---|---:|---|
|0.7.11|1070672|`ed1fe78d8c9e446c15d6dbb9d1af752285264563110a3d7205d8a3397b25f564`|
|0.7.10|1065872|`6e1d8ea3a4dee3f48f78b612ba4b7d541f8e96a3c44f545d9ca9b45c25a6370d`|

本次發布是整理與封存已完成驗證的版本，未重新燒錄。實機與量測限制見[目前驗證紀錄](current-verification.md)。裝置私密資料不可當作公開 Release 附件。
