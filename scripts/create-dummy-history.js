const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function createDummyData() {
    const dummyId = 'DUMMY_CHART_TEST_002';

    // 1. Upsert Property
    const { error: propError } = await supabase
        .from('properties')
        .upsert({
            id: dummyId,
            title: 'Test Property with Price History (Lisbon Center)',
            price: 550000,
            currency: 'EUR',
            size_m2: 120,
            rooms: 3,
            bathrooms: 2,
            location: 'POINT(-9.139 38.722)', // Lisbon center
            url: 'https://example.com',
            image_url: 'https://images.idealista.com/inmuebles/2/1/a/8/21a8c0d9-7e4e-4f1a-9f1a-1a2b3c4d5e6f.jpg' // Placeholder if broken, reusing format
        });

    if (propError) console.error('Prop Error:', propError);
    else console.log('Dummy property created.');

    // 2. Insert History
    // Delete old history for this dummy first
    await supabase.from('price_history').delete().eq('property_id', dummyId);

    const history = [
        { property_id: dummyId, price: 480000, recorded_at: new Date(Date.now() - 90 * 86400000).toISOString() }, // 3 months ago
        { property_id: dummyId, price: 495000, recorded_at: new Date(Date.now() - 60 * 86400000).toISOString() }, // 2 months ago
        { property_id: dummyId, price: 510000, recorded_at: new Date(Date.now() - 30 * 86400000).toISOString() }, // 1 month ago
        { property_id: dummyId, price: 530000, recorded_at: new Date(Date.now() - 7 * 86400000).toISOString() },  // 1 week ago
        { property_id: dummyId, price: 550000, recorded_at: new Date().toISOString() },                         // Now
    ];

    const { error: histError } = await supabase
        .from('price_history')
        .insert(history);

    if (histError) console.error('History Error:', histError);
    else console.log('Dummy history inserted (5 points).');
}

createDummyData();
