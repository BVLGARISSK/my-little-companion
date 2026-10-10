param([string]$PortName = 'COM5', [string]$OutputDirectory = (Join-Path $PSScriptRoot 'private'))
$ErrorActionPreference = 'Stop'
$taskSerial = [System.IO.Ports.SerialPort]::new($PortName,115200,'None',8,'One')
$taskSerial.ReadTimeout = 1000
$taskSerial.DtrEnable = $false
$taskSerial.RtsEnable = $false
try {
    $taskSerial.Open()
    $taskSerial.WriteLine('pair')
    $taskPair = $null
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        try { $taskLine = $taskSerial.ReadLine().Trim() } catch [TimeoutException] { continue }
        if ($taskLine.StartsWith('@PAIR,')) { $taskPair = $taskLine.Substring(6) | ConvertFrom-Json; break }
    }
    if (!$taskPair) { throw 'No pairing reply. Check the COM port and installed firmware.' }
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $taskPair | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'pairing-private.json') -Encoding utf8
    @"
Device: $($taskPair.device_id)
Open this URL in iPhone Bluefy:
$($taskPair.url)

Owner key: $($taskPair.key)
Keep this file private. Do not publish it on GitHub.
"@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'phone-pairing.txt') -Encoding utf8
    $taskSerial.WriteLine('ble')
    Write-Host "Pairing details saved locally in $OutputDirectory. BLE window reopened."
} finally { if ($taskSerial.IsOpen) { $taskSerial.Close() }; $taskSerial.Dispose() }
