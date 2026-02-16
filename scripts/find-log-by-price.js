const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findPropertyLog() {
    // Search in debug_logs for payload containing the price 832000
    // We can't do deep JSON filtering easily, so we fetch recent logs and filter in JS

    console.log("Searching for property with price 832000 OR title containing 'boavista' in recent logs...");

    const { data: logs, error } = await supabase
        .from('debug_logs')
        .select('payload, created_at')
        .order('created_at', { ascending: false })
        .limit(100); // Check 100 recent logs

    if (error) {
        console.error('Error fetching logs:', error);
        return;
    }

    let found = false;
    logs.forEach(log => {
        if (found) return;
        const p = log.payload;

        // Check price
        let price = -1;
        if (p.priceInfo && p.priceInfo.amount) price = p.priceInfo.amount;
        else if (p.price) price = p.price;

        // Check title
        let title = "";
        if (p.suggestedTexts && p.suggestedTexts.title) title = p.suggestedTexts.title;
        else if (p.basicInfo && p.basicInfo.title) title = p.basicInfo.title;
        else if (p.title) title = p.title;

        if (price === 832000 || (title && title.toLowerCase().includes('boavista'))) {
            console.log(`\n!!! FOUND OBJECT !!!`);
            console.log(`Title: ${title} | Price: ${price} | Date: ${log.created_at}`);
            console.log('--- Payload Structure ---');
            console.log(JSON.stringify(p, null, 2));
            found = true;
        }
    });

    if (!found) {
        console.log("Still not found in last 100 logs. Printing structure of ANY recent real item (price > 1000)...");
        // Fallback: print first real item
        const realItem = logs.find(l => {
            const p = l.payload;
            const price = (p.priceInfo?.amount || p.price);
            return price > 1000 && !p.id?.startsWith('TEST');
        });

        if (realItem) {
            console.log(`Fallback Item: ${realItem.created_at}`);
            console.log(JSON.stringify(realItem.payload, null, 2));
        }
    }
}

findPropertyLog();
