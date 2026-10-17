# XIAO ESP32-C5 韌體 0.7.11-c5

本目錄是已在實機驗證的 Arduino C++ 原始碼，不含小恐龍。舊 S3 程式仍在上層 `LittleCompanionS3/`，兩者腳位與建置選項不同。

## 工具鏈

|項目|已使用版本／設定|
|---|---|
|Board|Seeed Studio XIAO ESP32-C5|
|ESP32 Arduino core|3.3.12|
|U8g2|2.36.19|
|NimBLE-Arduino|2.5.1|
|ArduinoJson|7.4.3|
|CPU／Flash／PSRAM|160 MHz／8 MB／Disabled|
|USB CDC On Boot|Enabled（`cdc`）|
|Partition Scheme|8M with spiffs（`default_8MB`；執行時以 LittleFS 使用資料分區）|
|Upload Speed|512000|

完整 FQBN 與版本固定於 [toolchain.json](toolchain.json)。接線見 [硬體說明](../../docs/hardware-c5.md)。

## 使用 Arduino IDE

1. 在 Boards Manager URLs 加入 `https://espressif.github.io/arduino-esp32/package_esp32_index.json`，安裝 ESP32 core 3.3.12。
2. 安裝上述三個指定版本函式庫。
3. 開啟 `LittleCompanionC5/LittleCompanionC5.ino`，選擇 XIAO_ESP32C5 並套用表中選項。
4. 編譯後選擇實際 USB 埠上傳。現有吊飾更新前保留備份，Erase All Flash Before Sketch Upload 設為 Disabled；不同分區配置先不要直接覆寫。

## 使用 PowerShell／Arduino CLI

在儲存庫根目錄執行：

```powershell
# 首次準備環境：下載指定版本 core 與函式庫，然後編譯
.irmware\c5\Build.ps1 -InstallDependencies

# 已安裝依賴時只編譯
.irmware\c5\Build.ps1

# 僅顯示將使用的 CLI／FQBN／參數，不編譯、不安裝
.irmware\c5\Build.ps1 -ShowCommand
```

可用 `-ArduinoCli` 指定執行檔、`-ConfigFile` 指定自己的 Arduino CLI YAML、`-OutputDirectory` 指定輸出。預設輸出 `firmware/c5/binaries/`，由 Git 忽略。此工具只安裝／編譯，不會自動燒錄或清除裝置。

0.7.11 原建置時 Arduino CLI 依賴掃描曾停住；實際發布 BIN 使用其官方 compile database、同 FQBN／SDK 的核心與函式庫快取，以及官方連結／映像配方完成。這次整理只驗證來源與既有建置紀錄，未重新執行完整韌體編譯；不能把新的腳本語法檢查視為重建成功。發布 BIN 的 SHA-256 與實機已寫入的版本相同，詳見 [驗證紀錄](../../docs/current-verification.md)。

## 檔案導覽

- `Companion.cpp`：BLE GATT、授權、上傳、播放控制、省電及主迴圈。
- `Display.cpp`／`DisplayExtras.cpp`：SH1106、表情、字幕與遊戲畫面。
- `Hardware.cpp`：MPU6050、觸摸、電池 ADC 與 USB 資料主機偵測。
- `Experience.cpp`／`ExtrasSettings.cpp`：互動、遊戲、計時與設定。
- `Storage.cpp`／`StorageSync.cpp`：LittleFS 作品、清單與雜湊。
- `*Checks.cpp`：隨原始碼編譯的政策／格式斷言，不代表實機完整覆蓋。
- `source-manifest.json`：公開 LF 來源與原建置 CRLF 來源的 SHA-256；僅換行格式不同，供核對封存來源。

## 初次配對與恢復

新板首次啟動會在 NVS 產生每台獨立的一般與管理員密鑰。以 USB 序列監控視窗 115200、Newline 傳送 `pair` 可取得一般配對網址；`admin` 取得管理員網址。這些輸出含完整控制憑證，請只留在本機，不要貼到公開 issue、截圖或提交到 Git。

`status` 讀取診斷；`ble` 重新開放藍牙窗口。網頁恢復出廠需管理員授權與確認，會刪除作品、設定與一般碼，但保留該板管理員碼。保留 NVS 的 APP 更新不需更換原配對卡；換主板或 erase-flash 不適用此保留規則。

下載已編譯檔、APP-only 更新與回滾見 [發布與回滾](../../docs/release-c5.md)。不要把目前板上的整片 Flash 複製給另一台。
