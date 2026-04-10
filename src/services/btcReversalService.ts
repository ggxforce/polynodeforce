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
    Logger.info('Starting BTC 5m Reversal Strategy...');
    Logger.info('Target: Bet $1 on the losing side 30s before expiration.');

    while (true) {
        try {
            // 1. Fetch active BTC 5m markets
            // We use the Gamma API or CLOB API to find active markets
            const markets: Market[] = await fetchData('https://clob.polymarket.com/markets');
            
            // Filter for BTC 5m markets that are NOT expired
            const now = new Date();
            const activeMarkets = markets.filter(m => 
                m.market_slug.includes(BTC_5M_QUERY) && 
                new Date(m.end_date_iso) > now
            );

            if (activeMarkets.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }

            // Sort by end date to find the one closing soonest
            activeMarkets.sort((a, b) => new Date(a.end_date_iso).getTime() - new Date(b.end_date_iso).getTime());
            
            const targetMarket = activeMarkets[0];
            const expiration = new Date(targetMarket.end_date_iso);
            const msUntilExpiration = expiration.getTime() - Date.now();
            const secondsUntilExpiration = msUntilExpiration / 1000;

            // If we are more than 40 seconds away, wait until 35 seconds before checking
            if (secondsUntilExpiration > 40) {
                const waitTime = Math.min((secondsUntilExpiration - 35) * 1000, 30000);
                // Logger.info(`Waiting for market ${targetMarket.market_slug} (Ends in ${Math.round(secondsUntilExpiration)}s)`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            // At 30-35 seconds, we start monitoring closely
            if (secondsUntilExpiration <= 35 && secondsUntilExpiration > 0) {
                Logger.info(`Target market detected: ${targetMarket.market_slug} (Ends in ${Math.round(secondsUntilExpiration)}s)`);
                
                // Wait exactly until 30 seconds
                if (secondsUntilExpiration > 30) {
                    await new Promise(resolve => setTimeout(resolve, (secondsUntilExpiration - 30) * 1000));
                }

                Logger.header(`🎯 EXECUTION TRIGGER: ${targetMarket.market_slug}`);

                // 2. Identify reaching side
                // Fetch current prices for tokens
                const prices = await Promise.all(targetMarket.tokens.map(async (t) => {
                    const book = await clobClient.getOrderBook(t.token_id);
                    const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
                    const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
                    const midPrice = (bestAsk + bestBid) / 2;
                    return { ...t, price: midPrice };
                }));

                // The "losing" side is the one with the lowest price (least probable according to market)
                prices.sort((a, b) => a.price - b.price);
                const losingSide = prices[0];
                
                Logger.info(`Losing side identified: ${losingSide.outcome} @ $${losingSide.price.toFixed(3)}`);

                // 3. Execute $1 trade
                if (ENV.DRY_MODE) {
                    Logger.info(`[DRY MODE] Would bet $1 on ${losingSide.outcome} for market ${targetMarket.market_slug}`);
                } else {
                    Logger.info(`Placing $1 order on ${losingSide.outcome}...`);
                    try {
                        const order_args = {
                            side: Side.BUY,
                            tokenID: losingSide.token_id,
                            amount: 1.0, 
                            price: 0.99, // High limit price for market-like execution
                        };
                        const signedOrder = await clobClient.createMarketOrder(order_args);
                        const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);
                        
                        if (resp.success) {
                            Logger.success(`Successfully bet $1 on ${losingSide.outcome}!`);
                        } else {
                            Logger.error(`Trade failed: ${JSON.stringify(resp)}`);
                        }
                    } catch (e) {
                        Logger.error(`Error during execution: ${e}`);
                    }
                }

                // Wait until the current market is definitely closed before searching again
                const bufferWait = msUntilExpiration + 5000;
                Logger.info(`Market execution finished. Waiting for next market cycle...`);
                await new Promise(resolve => setTimeout(resolve, Math.max(bufferWait, 10000)));
            }

        } catch (error) {
            Logger.error(`BTC Reversal Strategy Error: ${error}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
};
