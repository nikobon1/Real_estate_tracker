// Native fetch is available in modern Node.js

async function testWebhook() {
    const payload = {
        resource: { defaultDatasetId: null }, // Not used for direct payload
        id: 'TEST_CALC_SIZE_001',
        title: 'Test Property for Size Calculation',
        priceInfo: {
            amount: 500000,
            currencySuffix: 'EUR',
            priceByArea: 5000 // Expect size = 100
        },
        // Intentionally missing size fields
        rubbish: {},
        url: 'https://test.com/calc-size',
        address: { title: 'Test Address' }
    };

    console.log('Sending payload:', JSON.stringify(payload, null, 2));

    try {
        const response = await fetch('http://localhost:3000/api/webhooks/apify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log('Response:', response.status, text);
    } catch (e) {
        console.error('Error:', e);
    }
}

testWebhook();
