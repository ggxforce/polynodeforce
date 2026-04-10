#!/bin/bash

# Polymarket Bot - Linux Monitoring Setup
# This script starts the Docker stack for Prometheus, Loki, and Grafana

echo -e "\n\033[1;36m=======================================================\033[0m"
echo -e "\033[1;36m  🚀 POLYMARKET BOT MONITORING SETUP (Linux/VPS)\033[0m"
echo -e "\033[1;36m=======================================================\033[0m\n"

# 1. Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "\033[0;31m[ERROR] Docker is not installed. Please install it first.\033[0m"
    echo "Tip: sudo apt-get update && sudo apt-get install docker.io"
    exit 1
fi

# 2. Check for Docker Compose
if ! docker compose version &> /dev/null; then
    echo -e "\033[0;31m[ERROR] Docker Compose (v2) is not installed.\033[0m"
    echo "Tip: sudo apt-get install docker-compose-plugin"
    exit 1
fi

# 3. Ensure provisioning directories exist (already created by assistant usually, but safety first)
mkdir -p monitoring/grafana/provisioning/dashboards
mkdir -p monitoring/grafana/provisioning/datasources

# 4. Start Monitoring Stack
echo -e "\033[0;34m[1/3] Starting containers...\033[0m"
cd monitoring
sudo docker compose up -d

if [ $? -ne 0 ]; then
    echo -e "\033[0;31m[ERROR] Failed to start Docker containers.\033[0m"
    exit 1
fi
cd ..

# 5. Check .env if bot is running on the host
echo -e "\033[0;34m[2/3] Checking environment configuration...\033[0m"
if [ ! -f .env ]; then
    echo -e "\033[0;33m[WARNING] .env file not found in root. Please create it from .env.example\033[0m"
else
    if ! grep -q "METRICS_PORT" .env; then
        echo "METRICS_PORT=9091" >> .env
        echo "Added METRICS_PORT=9091 to .env"
    fi
fi

# 6. Summary
IP=$(curl -s ifconfig.me || echo "localhost")
echo -e "\033[0;32m[3/3] Monitoring is ready!\033[0m\n"
echo -e "-------------------------------------------------------"
echo -e "  📊 DASHBOARDS ACCESS:"
echo -e "-------------------------------------------------------"
echo -e "  Grafana:    http://${IP}:3000 (Admin / admin)"
echo -e "  Prometheus: http://${IP}:9090"
echo -e "  Bot Metrics: http://${IP}:9091/metrics"
echo -e "-------------------------------------------------------\n"
echo -e "\033[1;33m[TIP] Next Steps:\033[0m"
echo "  1. Run the bot: 'npm run dev' or use PM2"
echo "  2. Open Grafana and find the 'Polymarket Copy Bot Overview' dashboard."
echo -e "\n\033[1;32m✅ Setup Complete!\033[0m\n"
