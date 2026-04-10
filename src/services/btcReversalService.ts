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
    Logger.info('🚀 BTC 5m Reversal Strategy Active (Gamma Market Mode)');
    Logger.info('Targeting: btc-updown-5m intervals');

    const tradedMarkets = new Set<string>();

    while (true) {
        try {
            // 1. Fetch individual markets directly from Gamma API
            // We search for the pattern "btc-updown-5m"
            const gammaUrl = `https://gamma-api.polymarket.com/markets?active=true&search=btc-updown-5m&limit=20`;
            const markets = await fetchData(gammaUrl);

            if (!Array.isArray(markets) || markets.length === 0) {
                process.stdout.write(`\r[WAITING] Scanning for active btc-updown-5m intervals...   `);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const now = new Date();
            // Filter outcomes that are not yet expired/closed
            const activeIntervals = markets.filter((m: any) => 
                m.marketSlug && 
                m.marketSlug.includes('btc-updown-5m') &&
                !m.closed && 
                new Date(m.endDate) > now
            );

            if (activeIntervals.length === 0) {
                process.stdout.write(`\r[WAITING] Found ${markets.length} results, but none are active BTC 5m rounds.   `);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            // Sort by end date to find the current interval
            activeIntervals.sort((a: any, b: any) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
            
            const targetMarket = activeIntervals.find((m: any) => !tradedMarkets.has(m.id));
            
            if (!targetMarket) {
                process.stdout.write(`\r[WAITING] Waiting for next interval after ${activeIntervals[0].marketSlug}...   `);
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const expiration = new Date(targetMarket.endDate);
            const msUntilExpiration = expiration.getTime() - Date.now();
            const secondsUntilExpiration = msUntilExpiration / 1000;

            if (secondsUntilExpiration > 40) {
                process.stdout.write(`\r[TRACKING] Interval: ${targetMarket.marketSlug} | Ends in: ${Math.round(secondsUntilExpiration)}s   `);
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }

            // TRIGGER FLOW
            if (secondsUntilExpiration <= 40 && secondsUntilExpiration > 0) {
                Logger.clearLine();
                Logger.header(`🎯 TARGETING: ${targetMarket.marketSlug}`);
                
                let tokens = targetMarket.clobTokenIds ? JSON.parse(targetMarket.clobTokenIds) : [];
                if (tokens.length < 2) {
                    Logger.error('Invalid token data for market.');
                    tradedMarkets.add(targetMarket.id);
                    continue;
                }

                // Wait for T-30s
                if (secondsUntilExpiration > 30) {
                    await new Promise(resolve => setTimeout(resolve, (secondsUntilExpiration - 30) * 1000));
                }

                Logger.info('Fetching live prices...');
                const prices = await Promise.all([
                    clobClient.getOrderBook(tokens[0]),
                    clobClient.getOrderBook(tokens[1])
                ]).then(([book1, book2]) => {
                    const price1 = (parseFloat(book1.asks[0]?.price || '1') + parseFloat(book1.bids[0]?.price || '0')) / 2;
                    const price2 = (parseFloat(book2.asks[0]?.price || '1') + parseFloat(book2.bids[0]?.price || '0')) / 2;
                    return [
                        { tokenId: tokens[0], outcome: 'UP', price: price1 },
                        { tokenId: tokens[1], outcome: 'DOWN', price: price2 }
                    ];
                });

                prices.sort((a, b) => a.price - b.price);
                const losingSide = prices[0];
                
                Logger.info(`Prices: UP $${prices.find(p => p.outcome === 'UP')?.price.toFixed(2)} | DOWN $${prices.find(p => p.outcome === 'DOWN')?.price.toFixed(2)}`);
                Logger.success(`Decision: Bet on ${losingSide.outcome}`);

                if (ENV.DRY_MODE) {
                    Logger.info(`[DRY MODE] Would bet $1.00 on ${losingSide.outcome}`);
                } else {
                    const order_args = {
                        side: Side.BUY,
                        tokenID: losingSide.tokenId,
                        amount: 1.0,
                        price: 0.99,
                    };
                    const signedOrder = await clobClient.createMarketOrder(order_args);
                    const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
                    
                    if (resp.success) {
                        Logger.success('Order placed successfully!');
                        tradedMarkets.add(targetMarket.id);
                    } else {
                        Logger.error(`Order failed: ${JSON.stringify(resp)}`);
                    }
                }

                await new Promise(resolve => setTimeout(resolve, msUntilExpiration + 5000));
            }

        } catch (error) {
            Logger.clearLine();
            Logger.error(`Strategy Error: ${error instanceof Error ? error.message : error}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
};
