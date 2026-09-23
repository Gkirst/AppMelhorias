@echo off
setlocal
cd /d "%~dp0.."

if exist ".local-tools\jdk-21.0.12.1+1\bin\java.exe" (
  set "JAVA_HOME=%CD%\.local-tools\jdk-21.0.12.1+1"
  set "PATH=%CD%\.local-tools\jdk-21.0.12.1+1\bin;%PATH%"
)

where java >nul 2>&1
if errorlevel 1 (
  echo Java 21 nao encontrado. Veja docs\TESTE-LOCAL-FIREBASE.md.
  pause
  exit /b 1
)

call npm run emulators
pause
