@echo off
setlocal
REM ============================================================
REM start.bat — Servidor de desarrollo local para ABDNeuModMakr
REM (Hartmann Neuron Model Maker Modern Web Edition)
REM ============================================================

set "PORT=8388"
set "BRIDGE_PORT=7860"
set "URL=http://localhost:%PORT%"

echo ============================================================
echo   ABDNeuModMakr — Hartmann Spectral Reconstructor
echo   Puerto Web: %PORT% ^| Puerto Bridge IA: %BRIDGE_PORT%
echo ============================================================

REM 1. Cerrar procesos anteriores en el puerto 8388
echo [1/4] Verificando puerto web %PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo [INFO] Cerrando proceso previo en puerto %PORT% [PID %%a]
    taskkill /F /PID %%a >nul 2>&1
)

REM 2. Comprobar / Iniciar Companion Bridge en puerto 7860
echo [2/4] Verificando Companion Bridge en puerto %BRIDGE_PORT%...
set "BRIDGE_RUNNING=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%BRIDGE_PORT%" ^| findstr "LISTENING"') do (
    set "BRIDGE_RUNNING=1"
    echo [INFO] Companion Bridge ya activo en puerto %BRIDGE_PORT% [PID %%a]
)

if "%BRIDGE_RUNNING%"=="0" (
    where python >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [INFO] Arrancando Companion Bridge en segundo plano...
        start "ABD Neural Bridge" /min python bridge\server.py
    ) else (
        echo [WARN] Python no detectado en PATH. Companion Bridge no arrancado.
    )
)

REM 3. Abrir navegador
echo [3/4] Abriendo navegador en %URL%...
start "" "%URL%"

REM 4. Iniciar Vite dev server
echo [4/4] Iniciando Vite Dev Server...
echo ============================================================
echo   Web: %URL%
echo   Bridge: http://127.0.0.1:%BRIDGE_PORT%
echo   Pulsa Ctrl+C para detener el servidor
echo ============================================================

call npx -y vite --port %PORT%
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] El servidor se ha detenido o no se pudo iniciar.
    pause
)
