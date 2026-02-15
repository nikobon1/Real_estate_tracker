const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCoords() {
    const { data, error } = await supabase
        .from('properties')
        .select('id, location, title, city')
        .neq('id', 'TEST_999'); // Exclude our manual test

    if (error) {
        console.error('Error fetching properties:', error);
        return;
    }

    console.log(`Found ${data.length} real properties.`);

    const withLocation = data.filter(p => p.location !== null);
    console.log(`Properties with valid location: ${withLocation.length}`);

    if (withLocation.length > 0) {
        console.log('Sample location:', withLocation[0].location);
    } else {
        console.warn('WARNING: All real properties have NULL location!');
    }
}

checkCoords();
