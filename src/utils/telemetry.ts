import express from 'express';
import { metrics } from './metrics';
import { ENV } from '../config/env';
import Logger from './logger';
import getMyBalance from './getMyBalance';
import fetchData from './fetchData';

const app = express();
const port = ENV.METRICS_PORT;

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    initialValue: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    totalBought: number;
    realizedPnl: number;
}

export const initTelemetry = () => {
    // Metrics endpoint for Prometheus
    app.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', metrics.getContentType());
            res.end(await metrics.getMetrics());
        } catch (err) {
            res.status(500).end(err);
        }
    });

    app.listen(port, () => {
        Logger.success(`Telemetry server started on port ${port} (endpoint: /metrics)`);
    });

    // Periodically update financial metrics (every 2 minutes)
    setInterval(updateFinancialMetrics, 120 * 1000);
    // Initial update
    updateFinancialMetrics();
};

async function updateFinancialMetrics() {
    try {
        // 1. USDC Balance
        const balance = await getMyBalance(ENV.PROXY_WALLET);
        
        // 2. Open Positions
        const positionsUrl = `https://data-api.polymarket.com/positions?user=${ENV.PROXY_WALLET}`;
        const positions: Position[] = await fetchData(positionsUrl);

        let totalValue = 0;
        let totalInitialValue = 0;
        let totalUnrealizedPnl = 0;
        let totalRealizedPnl = 0;

        if (positions && positions.length > 0) {
            positions.forEach((pos) => {
                totalValue += pos.currentValue || 0;
                totalInitialValue += pos.initialValue || 0;
                totalUnrealizedPnl += pos.cashPnl || 0;
                totalRealizedPnl += pos.realizedPnl || 0;
            });
        }

        const totalPortfolio = balance + totalValue;
        const pnlPercentage = totalInitialValue > 0 ? (totalUnrealizedPnl / totalInitialValue) * 100 : 0;

        metrics.updateFinancials(
            balance,
            pnlPercentage,
            totalPortfolio,
            positions ? positions.length : 0
        );

        Logger.info(`Metrics updated: Balance $${balance.toFixed(2)}, Portfolio $${totalPortfolio.toFixed(2)}, PnL ${pnlPercentage.toFixed(2)}%`);
    } catch (err) {
        Logger.error('Failed to update financial metrics for telemetry', err);
    }
}
