const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDebug() {
    // 1. Check if our local test insert worked
    const { data: testProp } = await supabase
        .from('properties')
        .select('*')
        .eq('id', 'TEST_CALC_SIZE_001')
        .single();

    console.log('--- Local Test Result ---');
    if (testProp) {
        console.log(`ID: ${testProp.id}`);
        console.log(`Price: ${testProp.price}`);
        console.log(`Size (Expect 100): ${testProp.size_m2}`);
    } else {
        console.log('Test property NOT found.');
    }

    // 2. Fetch recent debug logs to see REAL payload structure
    console.log('\n--- Real Webhook Payload samples ---');
    const { data: logs, error } = await supabase
        .from('debug_logs')
        .select('payload, created_at')
        .order('created_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error('Error fetching logs:', error);
    } else if (logs) {
        logs.forEach((log, i) => {
            console.log(`\nLog #${i + 1} (${log.created_at}):`);
            // Deep inspect the payload structure for size/area fields
            const p = log.payload;

            // Helper to recursively find keys related to "size", "area", "m2"
            function findRelKeys(obj, path = '') {
                if (!obj || typeof obj !== 'object') return;
                Object.keys(obj).forEach(key => {
                    const newPath = path ? `${path}.${key}` : key;
                    const lowKey = key.toLowerCase();
                    if (lowKey.includes('size') || lowKey.includes('area') || lowKey.includes('m2') || lowKey.includes('price')) {
                        console.log(`  Found potential field: ${newPath} = ${JSON.stringify(obj[key])}`);
                    }
                    if (typeof obj[key] === 'object') {
                        findRelKeys(obj[key], newPath);
                    }
                });
            }

            findRelKeys(p);
        });
    }
}

checkDebug();
