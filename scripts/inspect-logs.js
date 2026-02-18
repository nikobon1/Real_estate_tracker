const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectLogs() {
    const { data, error } = await supabase
        .from('debug_logs')
        .select('*')
        .eq('event_type', 'dataset_item_sample')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error("Error fetching logs:", error);
        return;
    }

    if (data && data.length > 0) {
        const payload = data[0].payload;
        console.log("Latest Payload Sample:");
        console.log(JSON.stringify(payload, null, 2));

        // specific checks for construction year keywords
        const payloadStr = JSON.stringify(payload).toLowerCase();
        if (payloadStr.includes('year') || payloadStr.includes('ano') || payloadStr.includes('construction') || payloadStr.includes('construcao')) {
            console.log("\n--- Potential Keys Found ---");
            // Simple grep-like check for curiosity, but full JSON is better
        }
    } else {
        console.log("No debug logs found.");
    }
}

inspectLogs();
