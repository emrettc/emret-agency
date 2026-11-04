@echo off
rem Emret Agency kurulumu: gereksinimleri denetler, paketleri kurar.
rem Yerel model de kurmak icin: kurulum.cmd -Yerel
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kurulum.ps1" %*
pause
