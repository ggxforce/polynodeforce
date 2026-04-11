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
    
    // Custom specific counters
    public tradeSizeCounter: Counter<string>;
    public tradeStatusCounter: Counter<string>;

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

        this.tradeSizeCounter = new Counter({
            name: 'bot_trade_sizes_total',
            help: 'Number of executed trades per fixed size bucket',
            labelNames: ['size'], // '1usd', '2usd', '3usd', '5usd', 'other'
            registers: [this.registry],
        });

        this.tradeStatusCounter = new Counter({
            name: 'bot_trade_status_custom',
            help: 'Total number of trades executed or skipped',
            labelNames: ['status'], // 'executed', 'skipped', 'failed'
            registers: [this.registry],
        });
    }

    public recordTrade(status: 'executed' | 'simulated' | 'failed' | 'completed', type: 'immediate' | 'aggregated' = 'immediate') {
        this.tradesTotal.inc({ status, type });
    }

    public recordTradeSize(amount: number) {
        if (amount >= 0.9 && amount <= 1.1) {
            this.tradeSizeCounter.inc({ size: '1usd' });
        } else if (amount >= 1.9 && amount <= 2.1) {
            this.tradeSizeCounter.inc({ size: '2usd' });
        } else if (amount >= 2.9 && amount <= 3.1) {
            this.tradeSizeCounter.inc({ size: '3usd' });
        } else if (amount >= 4.9 && amount <= 5.1) {
            this.tradeSizeCounter.inc({ size: '5usd' });
        } else {
            this.tradeSizeCounter.inc({ size: 'other' });
        }
    }

    public recordTradeStatus(status: 'executed' | 'skipped' | 'failed') {
        this.tradeStatusCounter.inc({ status });
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
