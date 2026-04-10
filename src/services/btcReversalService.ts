import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import Logger from '../utils/logger';
import fetchData from '../utils/fetchData';
import { ENV } from '../config/env';

const BTC_5M_QUERY = 'btc-updown-5m';

interface Market {
    condition_id: string;
    question: string;
    description: string;
    market_slug: string;
    tokens: { token_id: string; outcome: string }[];
    end_date_iso: string;
}

export const btcReversalService = async (clobClient: ClobClient) => {
    Logger.info('🚀 BTC 5m Reversal Strategy Active (Gamma API Mode)');
    Logger.info('Strategy: Bet $1 on the LOSING side 30s before expiration.');

    const tradedMarkets = new Set<string>();

    while (true) {
        try {
            // 1. Get the Event from Gamma API
            // This is the specific event for BTC 5m
            const gammaUrl = `https://gamma-api.polymarket.com/events?slug=btc-updown-5m`;
            const events = await fetchData(gammaUrl);

            if (!Array.isArray(events) || events.length === 0) {
                Logger.error('Could not find BTC 5m event on Gamma API. Retrying...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const event = events[0];
            const markets = event.markets || [];

            const now = new Date();
            // Filter outcomes that are not yet expired
            const activeMarkets = markets.filter((m: any) => 
                !m.closed && 
                new Date(m.endDate) > now
            );

            if (activeMarkets.length === 0) {
                process.stdout.write(`\r[WAITING] No active 5m intervals found in event...   `);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            // Sort by end date to find the current interval
            activeMarkets.sort((a: any, b: any) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
            
            const targetMarket = activeMarkets.find((m: any) => !tradedMarkets.has(m.id));
            
            if (!targetMarket) {
                process.stdout.write(`\r[WAITING] Next market cycle not yet available...   `);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const expiration = new Date(targetMarket.endDate);
            const msUntilExpiration = expiration.getTime() - Date.now();
            const secondsUntilExpiration = msUntilExpiration / 1000;

            if (secondsUntilExpiration > 40) {
                process.stdout.write(`\r[TRACKING] Interval: ${targetMarket.groupItemTitle || targetMarket.conditionId} | Ends in: ${Math.round(secondsUntilExpiration)}s   `);
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }

            // TRIGGER FLOW
            if (secondsUntilExpiration <= 40 && secondsUntilExpiration > 0) {
                Logger.clearLine();
                Logger.header(`🎯 TARGETING: ${targetMarket.groupItemTitle || 'BTC 5m Cycle'}`);
                Logger.info(`ID: ${targetMarket.id}`);
                
                // Parse tokens from target market
                // Gamma API tokens are in 'clobTokenIds' stringified array or 'tokens' object
                let tokens = targetMarket.tokens;
                if (!tokens && targetMarket.clobTokenIds) {
                    const ids = JSON.parse(targetMarket.clobTokenIds);
                    tokens = ids.map((id: string, index: number) => ({
                        token_id: id,
                        outcome: index === 0 ? 'UP' : 'DOWN' // Standard for BTC 5m
                    }));
                }

                if (!tokens || tokens.length < 2) {
                    Logger.error('Could not resolve tokens for market. Skipping...');
                    tradedMarkets.add(targetMarket.id);
                    continue;
                }

                // Wait for T-30s
                if (secondsUntilExpiration > 30) {
                    await new Promise(resolve => setTimeout(resolve, (secondsUntilExpiration - 30) * 1000));
                }

                Logger.info('Analyzing prices via CLOB...');
                const prices = await Promise.all(tokens.map(async (t: any) => {
                    const tid = t.token_id || t.tokenId;
                    try {
                        const book = await clobClient.getOrderBook(tid);
                        const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
                        const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
                        return { ...t, price: (bestAsk + bestBid) / 2, tokenId: tid };
                    } catch (e) { return { ...t, price: 0.5, tokenId: tid }; }
                }));

                prices.sort((a, b) => a.price - b.price);
                const losingSide = prices[0];
                
                Logger.info(`Status: ${prices.map(p => `${p.outcome || p.outcomeName}: $${p.price.toFixed(2)}`).join(' vs ')}`);
                Logger.success(`Selected Losing Side: ${losingSide.outcome || losingSide.outcomeName}`);

                if (ENV.DRY_MODE) {
                    Logger.info(`[DRY MODE] Would bet $1.00 on ${losingSide.outcome || losingSide.outcomeName}`);
                } else {
                    Logger.info('Placing $1.00 Market Order...');
                    const order_args = {
                        side: Side.BUY,
                        tokenID: losingSide.tokenId,
                        amount: 1.0,
                        price: 0.99,
                    };
                    const signedOrder = await clobClient.createMarketOrder(order_args);
                    const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
                    
                    if (resp.success) {
                        Logger.success('Order Success!');
                        tradedMarkets.add(targetMarket.id);
                    } else {
                        Logger.error(`Order Failed: ${JSON.stringify(resp)}`);
                    }
                }

                Logger.info('Cycle complete. Waiting for next market...');
                await new Promise(resolve => setTimeout(resolve, msUntilExpiration + 5000));
            }

        } catch (error) {
            Logger.clearLine();
            Logger.error(`Strategy Error: ${error instanceof Error ? error.message : error}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
};
