import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { IdealistaProperty } from '@/types/property';

export async function POST(request: Request) {
    try {
        const body = await request.json();

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

        const propertiesToUpsert = items.map(item => ({
            id: item.id || `unknown_${Math.random()}`, // Fallback if ID is missing
            title: item.title || 'Untitled',
            price: item.price || 0,
            currency: item.currency || 'EUR',
            size_m2: item.size || 0,
            rooms: item.rooms || 0,
            bathrooms: item.bathrooms || 0,
            location: (item.latitude && item.longitude) ? `POINT(${item.longitude} ${item.latitude})` : null,
            address: item.address || null,
            province: item.province || null,
            city: item.city || null,
            url: item.url || '',
            image_url: item.thumbnail || null,
            last_seen: new Date().toISOString(),
        }));

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
