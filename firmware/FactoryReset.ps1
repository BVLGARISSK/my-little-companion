param(
    [string]$PortName = 'COM5',
    [string]$ExpectedDeviceId = '',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'private'),
    [switch]$ConfirmReset
)
$ErrorActionPreference = 'Stop'
$taskSerial = [System.IO.Ports.SerialPort]::new($PortName,115200,'None',8,'One')
$taskSerial.ReadTimeout = 500
$taskSerial.DtrEnable = $false
$taskSerial.RtsEnable = $false
function Read-ResetReply([string]$Prefix, [int]$Seconds = 15) {
    $taskDeadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        try { $taskLine = $taskSerial.ReadLine().Trim() } catch [TimeoutException] { continue }
        if ($taskLine.StartsWith($Prefix)) { return ($taskLine.Substring($Prefix.Length) | ConvertFrom-Json) }
    }
    throw "No reply for $Prefix. Check USB connection and firmware."
}
try {
    $taskSerial.Open()
    $taskSerial.WriteLine('{"op":"STATUS","rid":601}')
    $taskStatus = Read-ResetReply '@REPLY,601,'
    if (!$taskStatus.ok -or !$taskStatus.factory_reset_usb) { throw 'This firmware does not support factory reset. Install v0.3.2-s3 or newer first.' }
    if ($taskStatus.device_id -notmatch '^mlc-s3-[0-9a-f]{6}$') { throw 'Unexpected device. Reset cancelled.' }
    if ($ExpectedDeviceId -and $taskStatus.device_id -cne $ExpectedDeviceId) { throw 'Device ID differs from the expected target. Reset cancelled.' }
    if (!$ConfirmReset) {
        Write-Host ("Target: " + $taskStatus.device_id + " on " + $PortName + " / works: " + $taskStatus.media_count)
        Write-Host 'Factory reset deletes ALL works, playlist, settings, and the current owner key.' -ForegroundColor Yellow
        Write-Host 'The old ordinary QR code will stop working. A new pairing link will be saved locally.'
        if ($taskStatus.admin_key_retained_on_factory_reset) { Write-Host 'The administrator key is retained by this reset.' }
        if ((Read-Host 'Type RESET to continue') -cne 'RESET') { Write-Host 'Cancelled.'; return }
    }
    $taskSerial.WriteLine('factory-reset ' + $taskStatus.device_id)
    $taskStarted = Read-ResetReply '@FACTORY_RESET,' 20
    if (!$taskStarted.ok -or $taskStarted.stage -ne 'restarting') { throw 'The device could not start factory reset.' }
    $taskFinished = Read-ResetReply '@FACTORY_RESET,' 30
    if (!$taskFinished.ok -or $taskFinished.stage -ne 'complete') { throw ('Factory reset failed at ' + $taskFinished.stage) }
    $taskSerial.WriteLine('{"op":"STATUS","rid":602}')
    $taskAfter = Read-ResetReply '@REPLY,602,'
    if (!$taskAfter.ok -or !$taskAfter.storage_ready -or $taskAfter.media_count -ne 0 -or $taskAfter.playlist_count -ne 0 -or $taskAfter.brightness -ne 160 -or $taskAfter.mode -ne 'auto') {
        throw 'Factory reset reply arrived, but default state verification failed.'
    }
    $taskSerial.WriteLine('pair')
    $taskPair = Read-ResetReply '@PAIR,'
    if ($taskPair.device_id -cne $taskStatus.device_id -or $taskPair.key -notmatch '^[0-9a-f]{64}$') { throw 'New pairing reply is invalid.' }
    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $taskPair | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'pairing-private.json') -Encoding utf8
    @"
Device: $($taskPair.device_id)
Open this NEW URL in iPhone Bluefy:
$($taskPair.url)

Owner key: $($taskPair.key)
Old ordinary pairing links/QR codes no longer authorize this device.
Keep this file private. Do not publish it on GitHub.
"@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'phone-pairing.txt') -Encoding utf8
    $taskAfter | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'factory-reset-status.json') -Encoding utf8
    Write-Host "Factory reset verified. NEW pairing details saved locally in $OutputDirectory."
} finally { if ($taskSerial.IsOpen) { $taskSerial.Close() }; $taskSerial.Dispose() }
