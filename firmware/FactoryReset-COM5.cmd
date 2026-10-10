@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0FactoryReset.ps1" -PortName COM5
pause
