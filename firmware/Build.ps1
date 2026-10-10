param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'binaries'))
$ErrorActionPreference = 'Stop'
$taskCli = Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
if (!(Test-Path -LiteralPath $taskCli)) { $taskCli = (Get-Command arduino-cli -ErrorAction Stop).Source }
$taskBoard = 'esp32:esp32:esp32s3:FlashSize=16M,CDCOnBoot=default,PSRAM=disabled,UploadSpeed=115200'
& $taskCli lib install 'U8g2@2.36.19' 'NimBLE-Arduino@2.5.1' 'ArduinoJson@7.4.3'
if ($LASTEXITCODE -ne 0) { throw 'Library installation failed.' }
& $taskCli compile --fqbn $taskBoard --output-dir $OutputDirectory (Join-Path $PSScriptRoot 'LittleCompanionS3')
if ($LASTEXITCODE -ne 0) { throw 'Firmware compilation failed.' }
Write-Host "Firmware is ready in $OutputDirectory"
