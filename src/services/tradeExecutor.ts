import { ClobClient } from '@polymarket/clob-client';
import chalk from 'chalk';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { ENV } from '../config/env';
import { getUserActivityModel } from '../models/userHistory';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';
import postOrder from '../utils/postOrder';
import Logger from '../utils/logger';
import { calculateOrderSize } from '../config/copyStrategy';
import { metrics } from '../utils/metrics';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const RETRY_LIMIT = ENV.RETRY_LIMIT;
const PROXY_WALLET = ENV.PROXY_WALLET;
const TRADE_AGGREGATION_ENABLED = ENV.TRADE_AGGREGATION_ENABLED;
const TRADE_AGGREGATION_WINDOW_SECONDS = ENV.TRADE_AGGREGATION_WINDOW_SECONDS;
const TRADE_AGGREGATION_MIN_TOTAL_USD = 1.0; // Polymarket minimum

// Create activity models for each user
const userActivityModels = USER_ADDRESSES.map((address) => ({
    address,
    model: getUserActivityModel(address),
}));

interface TradeWithUser extends UserActivityInterface {
    userAddress: string;
}

interface AggregatedTrade {
    userAddress: string;
    conditionId: string;
    asset: string;
    side: string;
    slug?: string;
    eventSlug?: string;
    trades: TradeWithUser[];
    totalUsdcSize: number;
    averagePrice: number;
    firstTradeTime: number;
    lastTradeTime: number;
}

// Cache for positions to avoid redundant API calls within a single execution cycle
const positionsCache: Map<string, { data: any; timestamp: number }> = new Map();

const getCachedPositions = async (address: string): Promise<UserPositionInterface[]> => {
    const now = Date.now();
    const cached = positionsCache.get(address);
    if (cached && now - cached.timestamp < 5000) { // 5-second cache
        return cached.data;
    }
    const data = await fetchData(`https://data-api.polymarket.com/positions?user=${address}`);
    positionsCache.set(address, { data, timestamp: now });
    return data;
};

// Buffer for aggregating trades
const tradeAggregationBuffer: Map<string, AggregatedTrade> = new Map();

const readTempTrades = async (): Promise<TradeWithUser[]> => {
    const allTrades: TradeWithUser[] = [];

    for (const { address, model } of userActivityModels) {
        // Only get trades that haven't been processed yet (bot: false AND botExcutedTime: 0)
        // This prevents processing the same trade multiple times
        const trades = await model
            .find({
                $and: [{ type: 'TRADE' }, { bot: false }, { botExcutedTime: 0 }],
            })
            .exec();

        const tradesWithUser = trades.map((trade) => ({
            ...(trade.toObject() as UserActivityInterface),
            userAddress: address,
        }));

        allTrades.push(...tradesWithUser);
    }

    return allTrades;
};

/**
 * Generate a unique key for trade aggregation based on user, market, side
 */
const getAggregationKey = (trade: TradeWithUser): string => {
    return `${trade.userAddress}:${trade.conditionId}:${trade.asset}:${trade.side}`;
};

/**
 * Add trade to aggregation buffer or update existing aggregation
 */
const addToAggregationBuffer = (trade: TradeWithUser): void => {
    const key = getAggregationKey(trade);
    const existing = tradeAggregationBuffer.get(key);
    const now = Date.now();

    if (existing) {
        // Update existing aggregation
        existing.trades.push(trade);
        existing.totalUsdcSize += trade.usdcSize;
        // Recalculate weighted average price
        const totalValue = existing.trades.reduce((sum, t) => sum + t.usdcSize * t.price, 0);
        existing.averagePrice = totalValue / existing.totalUsdcSize;
        existing.lastTradeTime = now;
    } else {
        // Create new aggregation
        tradeAggregationBuffer.set(key, {
            userAddress: trade.userAddress,
            conditionId: trade.conditionId,
            asset: trade.asset,
            side: trade.side || 'BUY',
            slug: trade.slug,
            eventSlug: trade.eventSlug,
            trades: [trade],
            totalUsdcSize: trade.usdcSize,
            averagePrice: trade.price,
            firstTradeTime: now,
            lastTradeTime: now,
        });
    }
};

/**
 * Check buffer and return ready aggregated trades
 * Trades are ready if:
 * 1. Total size >= minimum (EXECUTE IMMEDIATELY)
 * 2. OR Time window has passed since first trade (Check if meets minimum then)
 */
const getReadyAggregatedTrades = (): AggregatedTrade[] => {
    const ready: AggregatedTrade[] = [];
    const now = Date.now();
    const windowMs = TRADE_AGGREGATION_WINDOW_SECONDS * 1000;

    for (const [key, agg] of tradeAggregationBuffer.entries()) {
        const timeElapsed = now - agg.firstTradeTime;
        const timeSinceLastTrade = now - agg.lastTradeTime;

        // NEW LOGIC:
        // 1. Immediate Execution: reached minimum AND (either window passed OR short settling time passed)
        // We wait at least 2 seconds after the LAST trade to catch rapid-fire orders
        const isMinReached = agg.totalUsdcSize >= TRADE_AGGREGATION_MIN_TOTAL_USD;
        const isSettled = timeSinceLastTrade >= 2000; // 2 seconds settling time

        if (isMinReached && isSettled) {
            Logger.info(
                `🚀 Aggregation threshold reached ($${agg.totalUsdcSize.toFixed(2)}). Executing immediately...`
            );
            ready.push(agg);
            tradeAggregationBuffer.delete(key);
            continue;
        }

        // 2. Fallback: Window has passed
        if (timeElapsed >= windowMs) {
            if (agg.totalUsdcSize >= TRADE_AGGREGATION_MIN_TOTAL_USD) {
                ready.push(agg);
            } else {
                // Window passed but total too small - mark individual trades as skipped
                Logger.info(
                    `Trade aggregation window passed: $${agg.totalUsdcSize.toFixed(2)} total from ${agg.trades.length} trades still below minimum ($${TRADE_AGGREGATION_MIN_TOTAL_USD}) - skipping`
                );

                // Mark all trades in this aggregation as processed (bot: true)
                for (const trade of agg.trades) {
                    const UserActivity = getUserActivityModel(trade.userAddress);
                    UserActivity.updateOne({ _id: trade._id }, { bot: true }).exec();
                }
            }
            // Remove from buffer
            tradeAggregationBuffer.delete(key);
        }
    }

    return ready;
};

const doTrading = async (clobClient: ClobClient, trades: TradeWithUser[]) => {
    if (trades.length === 0) return;

    // Calculate minimum trader order size that would produce at least $0.65 copy (rounded to $1).
    // For FIXED strategy, the minimum valid size is $0.65.
    const strategy = ENV.COPY_STRATEGY_CONFIG.strategy;
    const minViableTraderSize = strategy === 'FIXED' 
        ? 0.65 
        : 0.65 / (ENV.COPY_STRATEGY_CONFIG.copySize / 100);

    const viableTrades: TradeWithUser[] = [];
    const skippedIds: any[] = [];

    for (const trade of trades) {
        const tradeAgeSeconds = Math.floor(Date.now() / 1000) - trade.timestamp;

        // Skip stale trades (> 60s old) or trades too small to ever produce a viable order
        if (tradeAgeSeconds > 60 || (trade.side === 'BUY' && trade.usdcSize < minViableTraderSize)) {
            skippedIds.push(trade._id);
            metrics.recordTradeStatus('skipped');
        } else {
            viableTrades.push(trade);
        }
    }

    // Batch-mark all skipped trades as processed in ONE database call per user
    if (skippedIds.length > 0) {
        const addressGroups = new Map<string, any[]>();
        for (const trade of trades) {
            if (skippedIds.includes(trade._id)) {
                const group = addressGroups.get(trade.userAddress) || [];
                group.push(trade._id);
                addressGroups.set(trade.userAddress, group);
            }
        }
        for (const [addr, ids] of addressGroups) {
            const UserActivity = getUserActivityModel(addr);
            await UserActivity.updateMany({ _id: { $in: ids } }, { bot: true, botExcutedTime: 1 });
        }
    }

    if (viableTrades.length === 0) return;

    // Show header with accurate count (only viable trades)
    Logger.header(
        `⚡ ${viableTrades.length} TRADE${viableTrades.length > 1 ? 'S' : ''} TO COPY${skippedIds.length > 0 ? ` (${skippedIds.length} dust skipped)` : ''}`
    );

    // ── STEP 2: Fetch shared data ONCE for all viable trades ──
    const my_balance = await getMyBalance(PROXY_WALLET);
    const firstTrade = viableTrades[0];
    const [my_positions, user_positions] = await Promise.all([
        getCachedPositions(PROXY_WALLET),
        getCachedPositions(firstTrade.userAddress)
    ]);
    const user_balance = user_positions.reduce((total, pos) => {
        return total + (pos.currentValue || 0);
    }, 0);

    // ── STEP 3: Execute viable trades in parallel batches of 3 ──
    const batchSize = 3;
    for (let i = 0; i < viableTrades.length; i += batchSize) {
        const batch = viableTrades.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (trade) => {
            const UserActivity = getUserActivityModel(trade.userAddress);
            await UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: 1 } });

            const my_position = my_positions.find(
                (position: UserPositionInterface) => position.conditionId === trade.conditionId
            );
            const user_position = user_positions.find(
                (position: UserPositionInterface) => position.conditionId === trade.conditionId
            );

            await postOrder(
                clobClient,
                trade.side === 'BUY' ? 'buy' : 'sell',
                my_position,
                user_position,
                trade,
                my_balance,
                user_balance,
                trade.userAddress
            );
        }));
        
        // Small pause between batches to avoid rate limits
        if (i + batchSize < viableTrades.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
};

/**
 * Execute aggregated trades
 */
const doAggregatedTrading = async (clobClient: ClobClient, aggregatedTrades: AggregatedTrade[]) => {
    for (const agg of aggregatedTrades) {
        Logger.clearLine();
        Logger.aggregatedTrade(agg.userAddress, agg.side, {
            count: agg.trades.length,
            asset: agg.asset,
            side: agg.side,
            amount: agg.totalUsdcSize,
            avgPrice: agg.averagePrice,
            slug: agg.slug,
            eventSlug: agg.eventSlug,
        });

        // Mark all individual trades as being processed
        for (const trade of agg.trades) {
            const UserActivity = getUserActivityModel(trade.userAddress);
            await UserActivity.updateOne({ _id: trade._id }, { bot: true, botExcutedTime: 1 }).exec();
        }

        const [my_positions, user_positions] = await Promise.all([
            getCachedPositions(PROXY_WALLET),
            getCachedPositions(agg.userAddress)
        ]);
        const my_position = my_positions.find(
            (position: UserPositionInterface) => position.conditionId === agg.conditionId
        );
        const user_position = user_positions.find(
            (position: UserPositionInterface) => position.conditionId === agg.conditionId
        );

        // Get USDC balance
        const my_balance = await getMyBalance(PROXY_WALLET);

        // Calculate trader's total portfolio value from positions
        const user_balance = user_positions.reduce((total, pos) => {
            return total + (pos.currentValue || 0);
        }, 0);

        Logger.balance(my_balance, user_balance, agg.userAddress);

        // Create a synthetic trade object for postOrder using aggregated values
        const syntheticTrade: any = {
            ...agg.trades[0], // Use first trade as template
            usdcSize: agg.totalUsdcSize,
            price: agg.averagePrice,
            side: agg.side as 'BUY' | 'SELL',
            bot: false,
            botExcutedTime: 0,
            isAggregated: true // Flag to skip re-calculating size
        };

        // Execute the aggregated trade
        await postOrder(
            clobClient,
            agg.side === 'BUY' ? 'buy' : 'sell',
            my_position,
            user_position,
            syntheticTrade,
            my_balance,
            user_balance,
            agg.userAddress
        );

        Logger.separator();
    }
};

// Track if executor should continue running
let isRunning = true;

/**
 * Stop the trade executor gracefully
 */
export const stopTradeExecutor = () => {
    isRunning = false;
    Logger.info('Trade executor shutdown requested...');
};

const tradeExecutor = async (clobClient: ClobClient) => {
    Logger.success(`Trade executor ready for ${USER_ADDRESSES.length} trader(s)`);
    if (TRADE_AGGREGATION_ENABLED) {
        Logger.info(
            `Trade aggregation enabled: ${TRADE_AGGREGATION_WINDOW_SECONDS}s window, $${TRADE_AGGREGATION_MIN_TOTAL_USD} minimum`
        );
    }

    let lastCheck = Date.now();
    while (isRunning) {
        try {
            const trades = await readTempTrades();

            if (TRADE_AGGREGATION_ENABLED) {
                // Process with aggregation logic
                if (trades.length > 0) {
                    // Pre-filter: skip dust trades and stale trades BEFORE any API calls
                    const strategy = ENV.COPY_STRATEGY_CONFIG.strategy;
                    const minViableTraderSize = strategy === 'FIXED' 
                        ? 0.65 
                        : 0.65 / (ENV.COPY_STRATEGY_CONFIG.copySize / 100);
                    
                    const viableTrades: TradeWithUser[] = [];
                    const dustIds: any[] = [];
                    
                    for (const trade of trades) {
                        const tradeAgeSeconds = Math.floor(Date.now() / 1000) - trade.timestamp;
                        if (tradeAgeSeconds > 60 || (trade.side === 'BUY' && trade.usdcSize < minViableTraderSize)) {
                            dustIds.push(trade._id);
                            metrics.recordTradeStatus('skipped');
                        } else {
                            viableTrades.push(trade);
                        }
                    }

                    // Batch-mark dust/stale trades as processed
                    if (dustIds.length > 0) {
                        for (const { address, model } of userActivityModels) {
                            await model.updateMany({ _id: { $in: dustIds } }, { bot: true, botExcutedTime: 1 });
                        }
                    }

                    // Only fetch balance once for all viable trades
                    if (viableTrades.length > 0) {
                        const my_balance = await getMyBalance(PROXY_WALLET);
                        
                        for (const trade of viableTrades) {
                            const UserActivity = getUserActivityModel(trade.userAddress);
                            const orderCalc = calculateOrderSize(
                                ENV.COPY_STRATEGY_CONFIG,
                                trade.usdcSize,
                                my_balance,
                                0 
                            );
                            const userOrderSize = orderCalc.finalAmount;

                            if (trade.side === 'BUY' && userOrderSize < TRADE_AGGREGATION_MIN_TOTAL_USD) {
                                trade.usdcSize = userOrderSize; 
                                addToAggregationBuffer(trade);
                                await UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: 1 } });
                            } else {
                                Logger.clearLine();
                                Logger.header(`⚡ IMMEDIATE TRADE (Fresh entry)`);
                                await doTrading(clobClient, [trade]);
                            }
                        }
                    }
                    lastCheck = Date.now();
                }

                // Check for ready aggregated trades
                const readyAggregations = getReadyAggregatedTrades();
                if (readyAggregations.length > 0) {
                    Logger.clearLine();
                    // Special banner for aggregated execution
                    console.log(chalk.cyanBright.bold('\n  🚀 TRIGGERING AGGREGATED EXECUTION (' + readyAggregations.length + ' groups ready)'));
                    
                    await doAggregatedTrading(clobClient, readyAggregations);
                    lastCheck = Date.now();
                }

                // Update waiting message
                if (trades.length === 0 && readyAggregations.length === 0) {
                    if (Date.now() - lastCheck > 300) {
                        const bufferedCount = tradeAggregationBuffer.size;
                        if (bufferedCount > 0) {
                            Logger.waiting(
                                USER_ADDRESSES.length,
                                `${bufferedCount} trade group(s) pending`
                            );
                        } else {
                            Logger.waiting(USER_ADDRESSES.length);
                        }
                        lastCheck = Date.now();
                    }
                }
            } else {
                // Original non-aggregation logic
                if (trades.length > 0) {
                    Logger.clearLine();
                    // doTrading handles pre-filtering, batching, and execution
                    await doTrading(clobClient, trades);
                    lastCheck = Date.now();
                } else {
                    // Update waiting message every 300ms for smooth animation
                    if (Date.now() - lastCheck > 300) {
                        Logger.waiting(USER_ADDRESSES.length);
                        lastCheck = Date.now();
                    }
                }
            }
        } catch (error) {
            Logger.error(`Trade executor loop error: ${error}`);
        }

        if (!isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    Logger.info('Trade executor stopped');
};

export default tradeExecutor;
