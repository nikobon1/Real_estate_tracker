import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { IdealistaProperty } from '@/types/property';

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Apify sends a list of items or a single item depending on configuration
        // We expect an array of items here for batch processing, or a single item
        const items: IdealistaProperty[] = Array.isArray(body) ? body : [body];

        if (items.length === 0) {
            return NextResponse.json({ message: 'No items received' }, { status: 200 });
        }

        const propertiesToUpsert = items.map(item => ({
            id: item.id,
            title: item.title,
            price: item.price,
            currency: item.currency || 'EUR',
            size_m2: item.size,
            rooms: item.rooms,
            bathrooms: item.bathrooms,
            // Create a PostGIS point: ST_SetSRID(ST_MakePoint(lng, lat), 4326)
            // Supabase JS client doesn't support raw PostGIS calls easily in simple inserts, 
            // so we might need to use a raw query or a stored procedure if we want to be pure.
            // However, for simplicity with the JS client, we can insert raw GeoJSON or WKT if the column type supports it.
            // But standard 'geometry' column requires WKB or specific format.
            // Let's rely on a customized RPC or try to insert as a string if Supabase handles it (Supabase often handles GeoJSON automatically if configured).
            // Actually, standard practice for Supabase Client + PostGIS is to use an RPC or specific format.
            // Let's try sending it as a GeoJSON object which Supabase/PostgREST often understands.
            location: `POINT(${item.longitude} ${item.latitude})`,
            address: item.address || null,
            province: item.province || null,
            city: item.city || null,
            url: item.url,
            image_url: item.thumbnail || null,
            last_seen: new Date().toISOString(),
        }));

        // 1. Upsert Properties
        const { error: propError } = await supabase
            .from('properties')
            .upsert(propertiesToUpsert, { onConflict: 'id' });

        if (propError) {
            console.error('Error inserting properties:', propError);
            return NextResponse.json({ error: propError.message }, { status: 500 });
        }

        // 2. Insert Price History
        // We only want to insert history if the price has changed or it's a new record.
        // For simplicity in this MVP, we insert a history record for every scrape.
        // We can optimize this later to check for changes.
        const historyRecords = items.map(item => ({
            property_id: item.id,
            price: item.price,
            recorded_at: new Date().toISOString(),
        }));

        const { error: histError } = await supabase
            .from('price_history')
            .insert(historyRecords);

        if (histError) {
            console.error('Error inserting history:', histError);
            // We don't fail the whole request property insertion was successful
        }

        return NextResponse.json({ message: 'Success', count: items.length }, { status: 200 });

    } catch (error) {
        console.error('Webhook error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
