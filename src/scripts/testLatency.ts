import createClobClient from '../utils/createClobClient';

const testLatency = async () => {
    try {
        console.log('--- Testing Latency to Polymarket ---');
        console.log('Initializing CLOB client...');
        const clobClient = await createClobClient();
        console.log('Client ready. Sending ping requests...');

        const pings = 5;
        let totalLatency = 0;

        for (let i = 1; i <= pings; i++) {
            const start = Date.now();
            try {
                // Ping the markets endpoint
                await fetch('https://clob.polymarket.com/markets?limit=1');
                const end = Date.now();
                const latency = end - start;
                totalLatency += latency;
                console.log(`Ping ${i}/${pings}: ${latency}ms`);
            } catch (err) {
                console.log(`Ping ${i}/${pings}: Failed to reach endpoint.`);
            }
            // Add a small delay between pings
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const avgLatency = Math.round(totalLatency / pings);
        console.log('--- Latency Test Completed ---');
        console.log(`Average Latency: ${avgLatency}ms`);

        if (avgLatency > 500) {
            console.log('[WARNING] High latency detected. Trade execution might be delayed.');
        } else {
            console.log('[SUCCESS] Latency is within acceptable ranges for trading.');
        }

    } catch (error) {
        console.error('[ERROR] Latency test failed:', error);
    }
};

testLatency();
