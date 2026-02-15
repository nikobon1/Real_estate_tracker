const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.err('Supabase creds missing');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testJoin() {
    console.log('Testing join query...');
    const { data, error } = await supabase
        .from('properties')
        .select(`
            id,
            title,
            price,
            price_history (
                price,
                recorded_at
            )
        `)
        .limit(5);

    if (error) {
        console.error('Error fetching with join:', error);
    } else {
        console.log('Fetch successful!');
        if (data.length > 0) {
            console.log('Sample item:', JSON.stringify(data[0], null, 2));
        } else {
            console.log('No data found.');
        }
    }
}

testJoin();
