
import { ENV } from './config/env';
import createClobClient from './utils/createClobClient';
import { btcReversalService } from './services/btcReversalService';
import Logger from './utils/logger';
import { performHealthCheck, logHealthCheck } from './utils/healthCheck';
import { initTelemetry } from './utils/telemetry';

const gracefulShutdown = async (signal: string) => {
    Logger.separator();
    Logger.info(`Received ${signal}, shutting down BTC Reversal Strategy...`);
    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const main = async () => {
    try {
        console.log("\n🚀 STARTING BTC 5M REVERSAL STRATEGY\n");
        
        initTelemetry();
        
        // Initial health check
        const healthResult = await performHealthCheck();
        logHealthCheck(healthResult);

        Logger.info('Initializing CLOB client...');
        const clobClient = await createClobClient();
        Logger.success('CLOB client ready');

        // Start the reversal service
        await btcReversalService(clobClient);

    } catch (error) {
        Logger.error(`Fatal error: ${error}`);
        process.exit(1);
    }
};

main();
