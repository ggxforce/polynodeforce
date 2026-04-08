#!/bin/bash

# Polymarket Bot - Ubuntu 22.04 Monitoring & Bot Setup
# This script installs Docker, Docker Compose, and sets up the monitor stack

echo "🚀 Starting Polymarket Bot Monitoring Setup..."

# 1. Update system
sudo apt-get update
sudo apt-get upgrade -y

# 2. Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# 3. Install Node.js if not present (using NodeSource for latest LTS)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 4. Install PM2 for bot management
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    sudo npm install -g pm2
fi

# 5. Start Monitoring Stack
echo "📊 Starting Monitoring Stack (Grafana, Prometheus, Loki)..."
cd monitoring
sudo docker compose up -d

# 6. Install Bot Dependencies
echo "⬢ Installing Bot dependencies..."
cd ..
npm install

# 7. Start Bot with PM2 (Automatic restart)
echo "🤖 Starting Bot with PM2..."
pm2 start npm --name "polymarket-bot" -- run dev
pm2 save
pm2 startup

echo "✅ Setup Complete!"
echo "-------------------------------------------------------"
echo "Grafana:    http://$(curl -s ifconfig.me):3000"
echo "Prometheus: http://$(curl -s ifconfig.me):9090"
echo "Metrics:    http://$(curl -s ifconfig.me):9091/metrics"
echo "-------------------------------------------------------"
echo "Use 'pm2 logs polymarket-bot' to see logs."
echo "Use 'pm2 status' to check bot status."
