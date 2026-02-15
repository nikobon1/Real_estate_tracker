const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSizes() {
    // Check last 20 items
    const { data, error } = await supabase
        .from('properties')
        .select('id, title, size_m2, price, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error("Error:", error);
    } else {
        console.log(`Checking last ${data.length} properties:`);
        data.forEach(p => {
            const hasSize = p.size_m2 > 0;
            console.log(`[${p.created_at.substring(0, 19)}] ${hasSize ? '✅' : '❌'} Size: ${p.size_m2} | Price: ${p.price} | ${p.title.substring(0, 30)}...`);
        });
    }
}

checkSizes();
