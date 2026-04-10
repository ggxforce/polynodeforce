@echo off
SETLOCAL EnableDelayedExpansion

echo.
echo =======================================================
echo   🚀 POLYMARKET BOT MONITORING SETUP (Windows)
echo =======================================================
echo.

:: 1. Check for Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo Please install Docker Desktop for Windows: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

:: 2. Check for Docker Compose
docker compose version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Compose is not available.
    echo Please ensure Docker Desktop is running.
    pause
    exit /b 1
)

:: 3. Setup Monitoring Stack
echo [1/3] Starting Monitoring Stack (Grafana, Prometheus, Loki)...
cd monitoring
docker compose up -d

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to start Docker containers.
    echo Make sure Docker Desktop is started and has enough resources.
    pause
    exit /b 1
)
cd ..

:: 4. Check .env for METRICS_PORT
echo [2/3] Checking configuration...
findstr /C:"METRICS_PORT" .env >nul
if %errorlevel% neq 0 (
    echo [WARNING] METRICS_PORT not found in .env. Defaulting to 9091.
    echo METRICS_PORT=9091 >> .env
)

:: 5. Summary
echo [3/3] Monitoring is ready!
echo.
echo -------------------------------------------------------
echo   📊 DASHBOARDS ACCESS:
echo -------------------------------------------------------
echo   Grafana:    http://localhost:3000 (Admin / admin)
echo   Prometheus: http://localhost:9090
echo   Loki/Logs:  Available via Grafana
echo   Bot Metrics: http://localhost:9091/metrics
echo -------------------------------------------------------
echo.
echo [TIP] Next Steps:
echo   1. Run the bot: 'npm run dev'
echo   2. Open Grafana and search for the 'Polymarket Copy Bot Overview' dashboard.
echo.
echo ✅ Done!
echo.

pause
