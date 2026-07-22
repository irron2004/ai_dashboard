@echo off
setlocal

REM Opens the rebuilt native Windows dashboard package.
set "APP_EXE=%~dp0apps\desktop\dist-windows-open\win-unpacked\Agent Project Console.exe"

if not exist "%APP_EXE%" (
  echo Agent Project Console.exe was not found.
  echo Expected: %APP_EXE%
  echo.
  echo Rebuild it from WSL with:
  echo   pnpm --filter @apc/desktop build
  echo   pnpm --filter @apc/desktop exec electron-builder --win --dir --config.directories.output=dist-windows-open --config.win.signAndEditExecutable=false
  echo.
  pause
  exit /b 1
)

start "" "%APP_EXE%"
