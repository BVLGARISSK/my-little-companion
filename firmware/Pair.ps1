param([string]$PortName = 'COM5', [string]$OutputDirectory = (Join-Path $PSScriptRoot 'private'), [switch]$Admin)
$ErrorActionPreference = 'Stop'
$taskSerial = [System.IO.Ports.SerialPort]::new($PortName,115200,'None',8,'One')
$taskSerial.ReadTimeout = 1000
$taskSerial.DtrEnable = $false
$taskSerial.RtsEnable = $false
try {
    $taskSerial.Open()
    $taskCommand = if ($Admin) { 'admin' } else { 'pair' }
    $taskPrefix = if ($Admin) { '@ADMIN,' } else { '@PAIR,' }
    $taskSerial.WriteLine($taskCommand)
    $taskPair = $null
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        try { $taskLine = $taskSerial.ReadLine().Trim() } catch [TimeoutException] { continue }
        if ($taskLine.StartsWith($taskPrefix)) { $taskPair = $taskLine.Substring($taskPrefix.Length) | ConvertFrom-Json; break }
    }
    if (!$taskPair) { throw 'No pairing reply. Check the COM port and installed firmware.' }
    if ($taskPair.device_id -notmatch '^mlc-s3-[0-9a-f]{6}$' -or $taskPair.key -notmatch '^[0-9a-f]{64}$') { throw 'Invalid pairing reply.' }
    $taskJsonName = if ($Admin) { 'admin-pairing-private.json' } else { 'pairing-private.json' }
    $taskTextName = if ($Admin) { 'admin-phone-pairing.txt' } else { 'phone-pairing.txt' }
    $taskKeyLabel = if ($Admin) { 'Administrator key (retained by ordinary factory reset)' } else { 'Owner key' }
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $taskPair | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory $taskJsonName) -Encoding utf8
    @"
Device: $($taskPair.device_id)
Open this URL in iPhone Bluefy:
$($taskPair.url)

$($taskKeyLabel): $($taskPair.key)
Keep this file private. Do not publish it on GitHub.
"@ | Set-Content -LiteralPath (Join-Path $OutputDirectory $taskTextName) -Encoding utf8
    $taskSerial.WriteLine('ble')
    Write-Host "Pairing details saved locally in $OutputDirectory. BLE window reopened."
} finally { if ($taskSerial.IsOpen) { $taskSerial.Close() }; $taskSerial.Dispose() }
