const https = require('https');

const data = JSON.stringify({
    id: "TEST_999",
    title: "Test Apartment from Script",
    price: 350000,
    currency: "EUR",
    size: 120,
    rooms: 3,
    bathrooms: 2,
    latitude: 38.71,
    longitude: -9.15,
    url: "https://idealista.pt/test-999",
    thumbnail: "https://via.placeholder.com/150"
});

const options = {
    hostname: 'realestatetracker.vercel.app',
    port: 443,
    path: '/api/webhooks/apify',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    },
    timeout: 30000 // 30s timeout
};

const req = https.request(options, res => {
    console.log(`statusCode: ${res.statusCode}`);

    res.on('data', d => {
        process.stdout.write(d);
    });
});

req.on('error', error => {
    console.error('Error:', error.message);
});

req.on('timeout', () => {
    console.error('Request timed out');
    req.destroy();
});

req.write(data);
req.end();
