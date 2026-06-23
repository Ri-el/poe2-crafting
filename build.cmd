@echo off
REM ============================================================
REM  One-click build for the PoE2 Jewel Crafting Simulator.
REM  Double-click this file to refresh the data\*.data.js wrappers
REM  (and regenerate mod data if raw PoE2DB dumps are present).
REM  Then just double-click index.html to play.
REM ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_data.ps1"
if errorlevel 1 (
  echo.
  echo Build FAILED - see the message above.
) else (
  echo.
  echo Done. You can now double-click index.html to play.
)
echo.
pause
