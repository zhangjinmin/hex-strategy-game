@echo off
setlocal
cd /d "%~dp0"
title LOGH Strategy - Release Builder

set "VERSION=0.1.0"
set "BIN=build\bin"
set "EXE=LOGH-Strategy.exe"
set "ZIP=LOGH-Strategy-v0.1.0-win-x64.zip"

echo ==========================================================
echo   LOGH Strategy : Windows release builder (v%VERSION%)
echo ==========================================================
echo.

REM Building while wails dev is up kills its Vite child process (project note).
tasklist /FI "IMAGENAME eq LOGH-Strategy-dev.exe" 2>nul | findstr /I "LOGH-Strategy-dev.exe" >nul
if not errorlevel 1 (
  echo [ERROR] wails dev is running. Stop it first (Ctrl+C in its window).
  echo Building while dev is up breaks the Vite child and HMR.
  goto :fail
)

where wails >nul 2>&1
if errorlevel 1 (
  echo [ERROR] wails CLI not found in PATH. Install with:
  echo   go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
  goto :fail
)

REM Wails resolves makensis via PATH; NSIS is installed but not on PATH.
set "PATH=%PATH%;C:\Program Files (x86)\NSIS"

REM A stale oversized build\windows\icon.ico makes NSIS fail with
REM "invalid icon file size". Removing it lets Wails regenerate a valid
REM multi-size icon from build\appicon.png during the build.
for %%F in ("build\windows\icon.ico") do if %%~zF GTR 1000000 del /q "build\windows\icon.ico"

REM go:embed all:frontend/dist needs at least one file to compile.
if not exist "frontend\dist" mkdir "frontend\dist"
if not exist "frontend\dist\.gitkeep" type nul > "frontend\dist\.gitkeep"

echo [1/3] Building frontend + Go binary (with NSIS installer)...
echo       -clean also removes the stale LOGH-Strategy-dev.exe
call wails build -clean -trimpath -nsis
if errorlevel 1 (
  echo [WARN] NSIS packaging failed. Retrying without installer...
  call wails build -trimpath
  if errorlevel 1 goto :fail
)

if not exist "%BIN%\%EXE%" (
  echo [ERROR] Expected binary not found: %BIN%\%EXE%
  goto :fail
)

echo [2/3] Creating upload-friendly zip (avoids SmartScreen on bare .exe)...
powershell -NoProfile -Command "Compress-Archive -Path '%BIN%\%EXE%' -DestinationPath '%BIN%\%ZIP%' -Force"
if errorlevel 1 (
  echo [WARN] Zip creation failed; the plain exe is still usable.
) else (
  echo       Created %BIN%\%ZIP%
)

if exist "%BIN%\LOGH-Strategy-amd64-installer.exe" (
  echo       NSIS installer OK
) else (
  echo [WARN] NSIS installer missing - check makensis and build\windows\icon.ico
)

echo [3/3] Release assets in %BIN%:
dir /b "%BIN%"
echo.
echo ==========================================================
echo  Build OK - upload the .zip and the installer
echo ==========================================================
echo   WebView2 : built into Win11; other machines fetch it on first run.
echo              For fully offline installs rebuild with: wails build -webview2 embed
echo   Releases : https://github.com/zhangjinmin/hex-strategy-game/releases/new
echo   Tag      : v%VERSION%  (push local commits first - see project notes)
echo.
goto :done

:fail
echo.
echo Build failed. See messages above.
pause
exit /b 1

:done
echo.
pause
exit /b 0
