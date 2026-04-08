import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

class MetricsService {
    public registry: Registry;
    
    // Trade counters
    public tradesTotal: Counter<string>;
    
    // Performance metrics
    public tradeLatency: Histogram<string>;
    
    // Financial metrics
    public botBalance: Gauge<string>;
    public botPnL: Gauge<string>;
    public totalPortfolioValue: Gauge<string>;
    public openPositionsCount: Gauge<string>;

    constructor() {
        this.registry = new Registry();
        collectDefaultMetrics({ register: this.registry });

        this.tradesTotal = new Counter({
            name: 'bot_trades_total',
            help: 'Total number of trades processed by the bot',
            labelNames: ['status', 'type'], // status: executed, simulated, failed, completed. type: immediate, aggregated
            registers: [this.registry],
        });

        this.tradeLatency = new Histogram({
            name: 'bot_trade_latency_seconds',
            help: 'Latency of trade execution in seconds',
            labelNames: ['action'],
            buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
            registers: [this.registry],
        });

        this.botBalance = new Gauge({
            name: 'bot_usdc_balance',
            help: 'Current USDC balance of the bot wallet',
            registers: [this.registry],
        });

        this.botPnL = new Gauge({
            name: 'bot_pnl_percentage',
            help: 'Current P/L percentage of the bot',
            registers: [this.registry],
        });

        this.totalPortfolioValue = new Gauge({
            name: 'bot_portfolio_value_usd',
            help: 'Total value of the bot portfolio (USDC + positions)',
            registers: [this.registry],
        });

        this.openPositionsCount = new Gauge({
            name: 'bot_open_positions_count',
            help: 'Number of currently open positions',
            registers: [this.registry],
        });
    }

    public recordTrade(status: 'executed' | 'simulated' | 'failed' | 'completed', type: 'immediate' | 'aggregated' = 'immediate') {
        this.tradesTotal.inc({ status, type });
    }

    public recordLatency(action: string, seconds: number) {
        this.tradeLatency.observe({ action }, seconds);
    }

    public updateFinancials(balance: number, pnl: number, totalValue: number, positionsCount: number) {
        this.botBalance.set(balance);
        this.botPnL.set(pnl);
        this.totalPortfolioValue.set(totalValue);
        this.openPositionsCount.set(positionsCount);
    }

    public async getMetrics() {
        return await this.registry.metrics();
    }

    public getContentType() {
        return this.registry.contentType;
    }
}

export const metrics = new MetricsService();
