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

        // Log the first item to see structure in Vercel logs
        console.log('First item sample:', JSON.stringify(items[0], null, 2));

        const propertiesToUpsert = items.map(item => {
            // Helper to get nested or alternative fields
            const getField = (...keys: string[]) => {
                for (const key of keys) {
                    if (item[key] !== undefined && item[key] !== null) return item[key];
                    // Support basic dot notation for one level deep (e.g. "basicInfo.title")
                    if (key.includes('.')) {
                        const [parent, child] = key.split('.');
                        if (item[parent] && item[parent][child] !== undefined) return item[parent][child];
                    }
                }
                return null;
            };

            const lat = getField('latitude', 'address.location.latitude', 'point.lat');
            const lng = getField('longitude', 'address.location.longitude', 'point.lng');

            return {
                id: String(getField('id', 'adid', 'propertyCode') || `unknown_${Math.random()}`),
                title: getField('title', 'suggestedTexts.title', 'basicInfo.title') || 'Untitled Property',
                price: Number(getField('price', 'priceInfo.price.amount')) || 0,
                currency: getField('currency', 'priceInfo.price.currencySuffix') || 'EUR',
                size_m2: Number(getField('size', 'builtArea', 'basicInfo.builtArea')) || 0,
                rooms: Number(getField('rooms', 'basicInfo.rooms')) || 0,
                bathrooms: Number(getField('bathrooms', 'basicInfo.bathrooms')) || 0,
                location: (lat && lng) ? `POINT(${lng} ${lat})` : null,
                address: getField('address', 'address.userAddress') || null,
                province: getField('province', 'address.location.level2') || null,
                city: getField('city', 'address.location.level4') || null,
                url: getField('url', 'detailWebLink', 'suggestedTexts.url') || '',
                image_url: getField('thumbnail', 'mainImage.url', 'images.0.url') || null,
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
