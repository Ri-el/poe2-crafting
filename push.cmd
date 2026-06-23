@echo off
REM ============================================================
REM  One-click upload of THIS folder to GitHub (Ri-el/poe2-crafting).
REM  Your local copy is the source of truth; this replaces the old
REM  version on GitHub. Run from home (needs internet + Git).
REM ============================================================
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Get it from https://git-scm.com/download/win
  pause
  exit /b 1
)

echo This will push EVERYTHING in this folder to:
echo     https://github.com/Ri-el/poe2-crafting  (branch: main)
echo and overwrite the old version there.
echo.
pause

if not exist ".git" (
  git init
  git branch -M main
  git remote add origin https://github.com/Ri-el/poe2-crafting.git
)

git add -A
git commit -m "Update: file:// build, bug fixes, and mod-pool scaffolding for all item categories"
git push -u origin main --force

echo.
echo Done (or read any message above).
pause
