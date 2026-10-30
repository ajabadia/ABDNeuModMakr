@echo off
title ABDSynths NEURON MODELmaker — Local AI Companion Bridge
color 0b

echo ========================================================
echo   ABDSynths NEURON MODELmaker — Local AI Companion Bridge
echo ========================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python no se encontro en el PATH del sistema.
    echo Por favor instala Python 3.10+ desde python.org y vuelve a intentarlo.
    pause
    exit /b 1
)

echo Iniciando servidor de aceleracion local en http://127.0.0.1:7860 ...
echo.
python "%~dp0server.py" %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo El servidor finalizo con codigo %ERRORLEVEL%.
    pause
)
