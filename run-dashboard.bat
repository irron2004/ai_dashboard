@echo off
REM Double-click to launch the AI Dashboard desktop app.
REM It runs inside WSL (Linux/Electron build) and the window appears via WSLg.
title AI Dashboard
wsl.exe -e bash /mnt/c/Users/irron/Desktop/my/ruahverce/ai_dashboard-main/run-desktop.sh
