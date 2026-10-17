param(
    [string]$ArduinoCli = '',
    [string]$ConfigFile = '',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'binaries'),
    [switch]$InstallDependencies,
    [switch]$ShowCommand
)
$ErrorActionPreference = 'Stop'
$taskToolchain = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') -Raw | ConvertFrom-Json
if (!$ArduinoCli) {
    $taskFound = Get-Command arduino-cli -ErrorAction SilentlyContinue
    if ($taskFound) { $ArduinoCli = $taskFound.Source }
    else { $ArduinoCli = Join-Path $env:LOCALAPPDATA 'Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe' }
}
if (!(Test-Path -LiteralPath $ArduinoCli)) { throw 'arduino-cli was not found. Install Arduino IDE or pass -ArduinoCli.' }
$taskGlobal = @()
if ($ConfigFile) {
    $taskGlobal = @('--config-file', (Resolve-Path -LiteralPath $ConfigFile).Path)
}
$taskCompile = @('compile', '--jobs', '2', '--fqbn', $taskToolchain.fqbn,
    '--output-dir', $OutputDirectory, (Join-Path $PSScriptRoot 'LittleCompanionC5'))
if ($ShowCommand) {
    Write-Output ([pscustomobject]@{ Executable = $ArduinoCli; Arguments = @($taskGlobal) + @($taskCompile) } | ConvertTo-Json -Depth 4)
    return
}
if ($InstallDependencies) {
    & $ArduinoCli @taskGlobal core update-index --additional-urls $taskToolchain.board_manager_url
    if ($LASTEXITCODE -ne 0) { throw 'Board index update failed.' }
    & $ArduinoCli @taskGlobal core install $taskToolchain.core --additional-urls $taskToolchain.board_manager_url
    if ($LASTEXITCODE -ne 0) { throw 'ESP32 core installation failed.' }
    foreach ($taskLibrary in $taskToolchain.libraries) {
        & $ArduinoCli @taskGlobal lib install $taskLibrary
        if ($LASTEXITCODE -ne 0) { throw "Library installation failed: $taskLibrary" }
    }
}
& $ArduinoCli @taskGlobal @taskCompile
if ($LASTEXITCODE -ne 0) { throw 'C5 firmware compilation failed.' }
Write-Host "C5 firmware is ready in $OutputDirectory"
