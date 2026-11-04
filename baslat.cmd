@echo off
rem Emret Agency uygulamasini baslatir. Bu pencere uygulama acikken acik
rem kalmalidir; kapatirsaniz uygulama da kapanir.
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Bagimliliklar kurulu degil. Once kurulum.cmd dosyasini calistirin.
  echo Ayrintilar: docs\KURULUM.md
  pause
  exit /b 1
)

title Emret Agency - kapatmayin
npm run dev
