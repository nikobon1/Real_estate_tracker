import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { IdealistaProperty } from '@/types/property';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('Received webhook body:', JSON.stringify(body, null, 2));

        // 0. Log to Supabase debug_logs
        await supabase.from('debug_logs').insert({
            event_type: 'webhook_received',
            payload: body
        });

        let items: IdealistaProperty[] = [];

        // Case 1: Apify "Run Succeeded" Webhook (Metadata only)
        if (body.resource && body.resource.defaultDatasetId) {
            const datasetId = body.resource.defaultDatasetId;
            console.log(`Received Apify Run Succeeded. Fetching dataset: ${datasetId}`);

            const response = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json`);
            if (!response.ok) {
                throw new Error(`Failed to fetch dataset from Apify: ${response.statusText}`);
            }
            items = await response.json();
        }
        // Case 2: Direct data payload (Array or Single Object)
        else if (Array.isArray(body)) {
            items = body;
        } else if (body.id) {
            items = [body];
        }

        if (items.length === 0) {
            return NextResponse.json({ message: 'No items found to process' }, { status: 200 });
        }

        // Log the first item sample to Supabase debug_logs so we can see the structure
        if (items.length > 0) {
            console.log('First item sample:', JSON.stringify(items[0], null, 2));
            await supabase.from('debug_logs').insert({
                event_type: 'dataset_item_sample',
                payload: items[0]
            });
        }

        const propertiesToUpsert = items.map(item => {
            // Helper to get nested or alternative fields
            // Mapping based on actual Apify dataset structure (idealista-scraper)
            const getField = (...keys: string[]) => {
                const itemAny = item as any;
                for (const key of keys) {
                    if (itemAny[key] !== undefined && itemAny[key] !== null) return itemAny[key];
                    // Support basic dot notation for one level deep (e.g. "basicInfo.title")
                    if (key.includes('.')) {
                        const [parent, child, subchild] = key.split('.');
                        if (subchild && itemAny[parent]?.[child]?.[subchild] !== undefined) return itemAny[parent][child][subchild];
                        if (itemAny[parent] && itemAny[parent][child] !== undefined) return itemAny[parent][child];
                    }
                }
                return null;
            };

            const itemAny = item as any;
            const lat = getField('latitude', 'point.lat', 'address.location.latitude', 'ubication.latitude');
            const lng = getField('longitude', 'point.lng', 'address.location.longitude', 'ubication.longitude');

            // Log resolving of lat/lng for debugging (flattened for readability)
            if (items.indexOf(item) < 5) {
                console.log(`[DEBUG ITEM ${items.indexOf(item)}] ID: ${itemAny.adid || itemAny.id}`);
                console.log(`[DEBUG ITEM ${items.indexOf(item)}] Raw Ubication:`, JSON.stringify(itemAny.ubication));
                console.log(`[DEBUG ITEM ${items.indexOf(item)}] Extracted: lat=${lat}, lng=${lng}`);
            }

            // Image handling: Try multimedia.images[0].url (Idealista structure)
            let imageUrl = null;
            if (itemAny.multimedia && itemAny.multimedia.images && Array.isArray(itemAny.multimedia.images) && itemAny.multimedia.images.length > 0) {
                imageUrl = itemAny.multimedia.images[0].url;
            } else {
                imageUrl = getField('thumbnail', 'mainImage.url');
            }

            return {
                id: String(getField('adid', 'id', 'propertyCode') || `unknown_${Math.random()}`),
                title: getField('suggestedTexts.title', 'title', 'basicInfo.title') || 'Untitled Property',
                const price = Number(getField('price', 'priceInfo.amount', 'priceInfo.price.amount')) || 0;
                const priceByArea = Number(getField('priceByArea', 'priceInfo.priceByArea', 'detail.priceByArea')) || 0;
                let sizeM2 = Number(getField('size', 'builtArea', 'basicInfo.builtArea', 'moreCharacteristics.constructedArea', 'moreCharacteristics.usableArea')) || 0;

                // Fallback: Calculate size from price and price/m2 if size is missing
                if(sizeM2 === 0 && price > 0 && priceByArea > 0) {
                    sizeM2 = Math.round(price / priceByArea);
    }

            return {
        id: String(getField('adid', 'id', 'propertyCode') || `unknown_${Math.random()}`),
        title: getField('suggestedTexts.title', 'title', 'basicInfo.title') || 'Untitled Property',
        price: price,
        currency: getField('priceInfo.currencySuffix', 'currency') || 'EUR',
        size_m2: sizeM2,
        rooms: Number(getField('rooms', 'basicInfo.rooms')) || 0,
        bathrooms: Number(getField('bathrooms', 'basicInfo.bathrooms')) || 0,
        location: (lat && lng) ? `POINT(${lng} ${lat})` : null,
        address: getField('address', 'address.userAddress', 'ubication.title', 'address.title') || null,
        province: getField('province', 'address.location.level2', 'ubication.administrativeAreaLevel2') || null,
        city: getField('municipality', 'city', 'address.location.level4') || null,
        url: getField('url', 'detailWebLink', 'suggestedTexts.url') || '',
        image_url: imageUrl,
        last_seen: new Date().toISOString(),
    };
});

// Filter out invalid items (e.g. missing price or ID) if necessary
const validProperties = propertiesToUpsert.filter(p => p.price > 0 && p.url);

if (validProperties.length === 0) {
    return NextResponse.json({ message: 'No valid properties to insert' }, { status: 200 });
}

// 1. Upsert Properties
const { error: propError } = await supabase
    .from('properties')
    .upsert(validProperties, { onConflict: 'id' });

if (propError) {
    console.error('Error inserting properties:', propError);
    return NextResponse.json({ error: propError.message }, { status: 500 });
}

// 2. Insert Price History
const historyRecords = validProperties.map(item => ({
    property_id: item.id,
    price: item.price,
    recorded_at: new Date().toISOString(),
}));

const { error: histError } = await supabase
    .from('price_history')
    .insert(historyRecords);

if (histError) {
    console.error('Error inserting history:', histError);
}

return NextResponse.json({ message: 'Success', count: validProperties.length }, { status: 200 });

    } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
}
