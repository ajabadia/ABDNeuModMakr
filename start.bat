@echo off
setlocal
REM ============================================================
REM start.bat — Servidor de desarrollo local para ABDNeuModMakr
REM (Hartmann Neuron Model Maker Modern Web Edition)
REM ============================================================

set "PORT=8388"
set "URL=http://localhost:%PORT%"

echo ============================================================
echo   ABDNeuModMakr — Hartmann Spectral Reconstructor
echo   Puerto: %PORT%
echo ============================================================

REM 1. Cerrar procesos anteriores en el puerto 8388
echo [1/3] Verificando puerto %PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo [INFO] Cerrando proceso previo en puerto %PORT% [PID %%a]
    taskkill /F /PID %%a >nul 2>&1
)

REM 2. Abrir navegador
echo [2/3] Abriendo navegador en %URL%...
start "" "%URL%"

REM 3. Iniciar Vite dev server
echo [3/3] Iniciando Vite Dev Server...
echo ============================================================
echo   URL: %URL%
echo   Pulsa Ctrl+C para detener el servidor
echo ============================================================

call npx -y vite --port %PORT%
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] El servidor se ha detenido o no se pudo iniciar.
    pause
)
