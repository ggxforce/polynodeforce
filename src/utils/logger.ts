import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import winston from 'winston';
import LokiTransport from 'winston-loki';
import { ENV } from '../config/env';

class Logger {
    private static logsDir = path.join(process.cwd(), 'logs');
    private static winstonLogger: winston.Logger;

    static {
        this.ensureLogsDir();
        this.initializeWinston();
    }

    private static ensureLogsDir(): void {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    private static initializeWinston() {
        const transports: winston.transport[] = [
            new winston.transports.File({ 
                filename: path.join(this.logsDir, 'bot-combined.log'),
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                )
            }),
            new winston.transports.File({ 
                filename: path.join(this.logsDir, 'bot-error.log'), 
                level: 'error',
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                )
            })
        ];

        if (ENV.LOKI_URL) {
            transports.push(new LokiTransport({
                host: ENV.LOKI_URL,
                labels: { app: 'polymarket-bot' },
                json: true,
                format: winston.format.json(),
                replaceTimestamp: true,
                onConnectionError: (err) => console.error('Loki connection error:', err)
            }));
        }

        this.winstonLogger = winston.createLogger({
            level: 'info',
            transports
        });
    }

    private static writeToWinston(level: string, message: string, meta?: any) {
        this.winstonLogger.log(level, this.stripAnsi(message), meta);
    }

    private static getLogFileName(): string {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.logsDir, `bot-${date}.log`);
    }

    private static writeToFile(message: string): void {
        try {
            const logFile = this.getLogFileName();
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] ${message}\n`;
            fs.appendFileSync(logFile, logEntry, 'utf8');
        } catch (error) {
            // Silently fail
        }
    }

    private static stripAnsi(str: string): string {
        return str.replace(/\u001b\[\d+m/g, '');
    }

    private static formatAddress(address: string): string {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    private static maskAddress(address: string): string {
        return `${address.slice(0, 6)}${'*'.repeat(34)}${address.slice(-4)}`;
    }

    static header(title: string) {
        console.log('\n' + chalk.cyan('━'.repeat(70)));
        console.log(chalk.cyan.bold(`  ${title}`));
        console.log(chalk.cyan('━'.repeat(70)) + '\n');
        this.writeToWinston('info', `HEADER: ${title}`);
    }

    static info(message: string) {
        console.log(chalk.blue('[INFO]'), message);
        this.writeToWinston('info', message);
    }

    static success(message: string) {
        console.log(chalk.green('[SUCCESS]'), message);
        this.writeToWinston('info', `SUCCESS: ${message}`);
    }

    static warning(message: string) {
        console.log(chalk.yellow('[WARNING]'), message);
        this.writeToWinston('warn', message);
    }

    static error(message: string, error?: any) {
        console.log(chalk.red('[ERROR]'), message);
        if (error) console.error(error);
        this.writeToWinston('error', message, { error: error?.message || error });
    }

    static aggregatedTrade(traderAddress: string, action: string, details: any) {
        console.log('\n' + chalk.cyanBright('━'.repeat(70)));
        console.log(chalk.cyanBright.bold('📦 --- AGGREGATED TRADE READY ---'));
        console.log(chalk.gray(`Trader: ${this.formatAddress(traderAddress)}`));
        console.log(chalk.gray(`Action: ${chalk.white.bold(action)} (Combined ${details.count} trades)`));
        if (details.asset) {
            console.log(chalk.gray(`Asset:  ${this.formatAddress(details.asset)}`));
        }
        if (details.side) {
            const sideColor = details.side === 'BUY' ? chalk.green : chalk.red;
            console.log(chalk.gray(`Side:   ${sideColor.bold(details.side)}`));
        }
        if (details.amount) {
            console.log(chalk.gray(`Total Amount: ${chalk.yellow(`$${details.amount.toFixed(2)}`)}`));
        }
        if (details.avgPrice) {
            console.log(chalk.gray(`Avg Entry:    ${chalk.cyan(details.avgPrice.toFixed(4))}`));
        }
        if (details.eventSlug || details.slug) {
            const slug = details.eventSlug || details.slug;
            const marketUrl = `https://polymarket.com/event/${slug}`;
            console.log(chalk.gray(`Market:       ${chalk.blue.underline(marketUrl)}`));
        }
        console.log(chalk.cyanBright('━'.repeat(70)) + '\n');

        this.writeToWinston('info', 'AGGREGATED_TRADE', { traderAddress, action, ...details });
    }

    static trade(traderAddress: string, action: string, details: any) {
        console.log('\n' + chalk.magenta('─'.repeat(70)));
        console.log(chalk.magenta.bold('--- NEW TRADE DETECTED ---'));
        console.log(chalk.gray(`Trader: ${this.formatAddress(traderAddress)}`));
        console.log(chalk.gray(`Action: ${chalk.white.bold(action)}`));
        if (details.asset) {
            console.log(chalk.gray(`Asset:  ${this.formatAddress(details.asset)}`));
        }
        if (details.side) {
            const sideColor = details.side === 'BUY' ? chalk.green : chalk.red;
            console.log(chalk.gray(`Side:   ${sideColor.bold(details.side)}`));
        }
        if (details.amount) {
            console.log(chalk.gray(`Amount: ${chalk.yellow(`$${details.amount}`)}`));
        }
        if (details.price) {
            console.log(chalk.gray(`Price:  ${chalk.cyan(details.price)}`));
        }
        if (details.eventSlug || details.slug) {
            const slug = details.eventSlug || details.slug;
            const marketUrl = `https://polymarket.com/event/${slug}`;
            console.log(chalk.gray(`Market: ${chalk.blue.underline(marketUrl)}`));
        }
        if (details.transactionHash) {
            const txUrl = `https://polygonscan.com/tx/${details.transactionHash}`;
            console.log(chalk.gray(`TX:     ${chalk.blue.underline(txUrl)}`));
        }
        console.log(chalk.magenta('─'.repeat(70)) + '\n');

        this.writeToWinston('info', 'TRADE_DETECTED', { traderAddress, action, ...details });
    }

    static balance(myBalance: number, traderBalance: number, traderAddress: string) {
        console.log(chalk.gray('Capital (USDC + Positions):'));
        console.log(
            chalk.gray(`  Your total capital:   ${chalk.green.bold(`$${myBalance.toFixed(2)}`)}`)
        );
        console.log(
            chalk.gray(
                `  Trader total capital: ${chalk.blue.bold(`$${traderBalance.toFixed(2)}`)} (${this.formatAddress(traderAddress)})`
            )
        );
        this.writeToWinston('info', 'BALANCE_CHECK', { myBalance, traderBalance, traderAddress });
    }

    static orderResult(success: boolean, message: string, details?: any) {
        if (success) {
            console.log(chalk.green('[SUCCESS]'), chalk.green.bold('Order executed:'), message);
            this.writeToWinston('info', `ORDER_SUCCESS: ${message}`, details);
        } else {
            console.log(chalk.red('[ERROR]'), chalk.red.bold('Order failed:'), message);
            this.writeToWinston('error', `ORDER_FAILED: ${message}`, details);
        }
    }

    static monitoring(traderCount: number) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(
            chalk.dim(`[${timestamp}]`),
            chalk.cyan('[MONITORING]'),
            chalk.yellow(`${traderCount} trader(s)`)
        );
    }

    static startup(traders: string[], myWallet: string) {
        console.log('\n');
        console.log(chalk.cyan('  ____       _        ____                 '));
        console.log(chalk.cyan(' |  _ \\ ___ | |_   _ / ___|___  _ __  _   _ '));
        console.log(chalk.cyan.bold(" | |_) / _ \\| | | | | |   / _ \\| '_ \\| | | |"));
        console.log(chalk.magenta.bold(' |  __/ (_) | | |_| | |__| (_) | |_) | |_| |'));
        console.log(chalk.magenta(' |_|   \\___/|_|\\__, |\\____\\___/| .__/ \\__, |'));
        console.log(chalk.magenta('               |___/            |_|    |___/ '));
        console.log(chalk.gray('               Copy the best, automate success\n'));

        console.log(chalk.cyan('━'.repeat(70)));
        console.log(chalk.cyan('--- Tracking Traders ---'));
        traders.forEach((address, index) => {
            console.log(chalk.gray(`   ${index + 1}. ${address}`));
        });
        console.log(chalk.cyan(`\n--- Your Wallet ---`));
        console.log(chalk.gray(`   ${this.maskAddress(myWallet)}\n`));
        
        this.writeToWinston('info', 'BOT_STARTUP', { traders, myWallet });
    }

    static dbConnection(traders: string[], counts: number[]) {
        console.log('\n' + chalk.cyan('--- Local Tracking Status ---'));
        traders.forEach((address, index) => {
            const countStr = chalk.yellow(`${counts[index]} trades`);
            console.log(chalk.gray(`   ${this.formatAddress(address)}: ${countStr}`));
        });
        console.log('');
    }

    static separator() {
        console.log(chalk.dim('─'.repeat(70)));
    }

    private static spinnerFrames = ['-', '\\', '|', '/'];
    private static spinnerIndex = 0;

    static waiting(traderCount: number, extraInfo?: string) {
        const timestamp = new Date().toLocaleTimeString();
        const spinner = this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length];
        this.spinnerIndex++;

        const message = extraInfo
            ? `${spinner} Waiting for trades from ${traderCount} trader(s)... (${extraInfo})`
            : `${spinner} Waiting for trades from ${traderCount} trader(s)...`;

        process.stdout.write(chalk.dim(`\r[${timestamp}] `) + chalk.cyan(message) + '  ');
    }

    static clearLine() {
        process.stdout.write('\r' + ' '.repeat(100) + '\r');
    }

    static myPositions(
        wallet: string,
        count: number,
        topPositions: any[],
        overallPnl: number,
        totalValue: number,
        initialValue: number,
        currentBalance: number
    ) {
        console.log('\n' + chalk.magenta.bold('--- YOUR POSITIONS ---'));
        console.log(chalk.gray(`   Wallet: ${this.formatAddress(wallet)}`));
        console.log('');

        const balanceStr = chalk.yellow.bold(`$${currentBalance.toFixed(2)}`);
        const totalPortfolio = currentBalance + totalValue;
        const portfolioStr = chalk.cyan.bold(`$${totalPortfolio.toFixed(2)}`);

        console.log(chalk.gray(`   Available Cash:    ${balanceStr}`));
        console.log(chalk.gray(`   Total Portfolio:   ${portfolioStr}`));

        if (count === 0) {
            console.log(chalk.gray(`\n   No open positions`));
        } else {
            const countStr = chalk.green(`${count} position${count > 1 ? 's' : ''}`);
            const pnlColor = overallPnl >= 0 ? chalk.green : chalk.red;
            const pnlSign = overallPnl >= 0 ? '+' : '';
            const profitStr = pnlColor.bold(`${pnlSign}${overallPnl.toFixed(1)}%`);
            const valueStr = chalk.cyan(`$${totalValue.toFixed(2)}`);
            const initialStr = chalk.gray(`$${initialValue.toFixed(2)}`);

            console.log('');
            console.log(chalk.gray(`   Open Positions:    ${countStr}`));
            console.log(chalk.gray(`      Invested:          ${initialStr}`));
            console.log(chalk.gray(`      Current Value:     ${valueStr}`));
            console.log(chalk.gray(`      Profit/Loss:       ${profitStr}`));

            if (topPositions.length > 0) {
                console.log(chalk.gray(`\n   Top Positions:`));
                topPositions.forEach((pos: any) => {
                    const pnlColor = pos.percentPnl >= 0 ? chalk.green : chalk.red;
                    const pnlSign = pos.percentPnl >= 0 ? '+' : '';
                    const avgPrice = pos.avgPrice || 0;
                    const curPrice = pos.curPrice || 0;
                    console.log(
                        chalk.gray(
                            `      • ${pos.outcome} - ${pos.title.slice(0, 45)}${pos.title.length > 45 ? '...' : ''}`
                        )
                    );
                    console.log(
                        chalk.gray(
                            `        Value: ${chalk.cyan(`$${pos.currentValue.toFixed(2)}`)} | PnL: ${pnlColor(`${pnlSign}${pos.percentPnl.toFixed(1)}%`)}`
                        )
                    );
                    console.log(
                        chalk.gray(
                            `        Bought @ ${chalk.yellow(`${(avgPrice * 100).toFixed(1)}¢`)} | Current @ ${chalk.yellow(`${(curPrice * 100).toFixed(1)}¢`)}`
                        )
                    );
                });
            }
        }
        console.log('');
        
        this.writeToWinston('info', 'MY_POSITIONS_SUMMARY', { 
            wallet, count, overallPnl, totalValue, initialValue, currentBalance, totalPortfolio 
        });
    }

    static tradersPositions(
        traders: string[],
        positionCounts: number[],
        positionDetails?: any[][],
        profitabilities?: number[]
    ) {
        console.log('\n' + chalk.cyan("--- TRADERS YOU'RE COPYING ---"));
        traders.forEach((address, index) => {
            const count = positionCounts[index];
            const countStr =
                count > 0
                    ? chalk.green(`${count} position${count > 1 ? 's' : ''}`)
                    : chalk.gray('0 positions');

            let profitStr = '';
            if (profitabilities && profitabilities[index] !== undefined && count > 0) {
                const pnl = profitabilities[index];
                const pnlColor = pnl >= 0 ? chalk.green : chalk.red;
                const pnlSign = pnl >= 0 ? '+' : '';
                profitStr = ` | ${pnlColor.bold(`${pnlSign}${pnl.toFixed(1)}%`)}`;
            }

            console.log(chalk.gray(`   ${this.formatAddress(address)}: ${countStr}${profitStr}`));
        });
        console.log('');
        
        this.writeToWinston('info', 'TRADERS_SUMMARY', { traders, positionCounts, profitabilities });
    }
}

export default Logger;
