param([string]$PortName = 'COM5', [string]$InputDirectory = (Join-Path $PSScriptRoot 'binaries'))
$ErrorActionPreference = 'Stop'
$taskCli = Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
if (!(Test-Path -LiteralPath $taskCli)) { $taskCli = (Get-Command arduino-cli -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath (Join-Path $InputDirectory 'LittleCompanionS3.ino.bin'))) { throw 'Run Build.ps1 first, or select the directory containing the prebuilt firmware.' }
$taskBoard = 'esp32:esp32:esp32s3:FlashSize=16M,CDCOnBoot=default,PSRAM=disabled,UploadSpeed=115200'
Write-Host "Uploading to ESP32-S3 on $PortName. Close serial monitors first."
& $taskCli upload --port $PortName --fqbn $taskBoard --input-dir $InputDirectory
if ($LASTEXITCODE -ne 0) { throw 'Firmware upload failed.' }
Write-Host 'Upload complete. Look for Little Companion S3 within 5 minutes. After connecting, 10 minutes without an upload closes BLE.'
