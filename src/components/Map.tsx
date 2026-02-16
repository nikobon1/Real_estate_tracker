"use client";

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

// 1. Get and sanitize token at MODULE LEVEL (synchronously)
// This ensures the token is set before any component rendering occurs.
let token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
if (token.startsWith('pk.pk.')) {
    token = token.substring(3);
}
mapboxgl.accessToken = token;

export default function MapComponent() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [lng, setLng] = useState(-9.139); // Lisbon
    const [lat, setLat] = useState(38.722);
    const [zoom, setZoom] = useState(12);
    const [properties, setProperties] = useState<any[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [mapLoaded, setMapLoaded] = useState(false);

    // 1. Fetch properties from Supabase
    useEffect(() => {
        const fetchProperties = async () => {
            const { data, error } = await supabase
                .from('properties')
                .select(`
                    *,
                    price_history (
                        price,
                        recorded_at
                    )
                `);

            if (error) {
                console.error("Error fetching properties:", error);
            } else {
                console.log("Fetched properties:", data?.length);
                if (data && data.length > 0) {
                    console.log("First property sample (check location format):", data[0]);
                }
                setProperties(data || []);
            }
        };

        fetchProperties();
    }, []);

    // 2. Initialize Mapbox
    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (!mapContainer.current) return;

        // Double check token existence (though it should be set globally now)
        if (!mapboxgl.accessToken) {
            console.error("Mapbox Access Token is missing");
            setErrorMsg("Mapbox Token is missing in .env.local");
            return;
        }

        console.log("Initializing Mapbox with token:", mapboxgl.accessToken.substring(0, 8) + "...");

        try {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/streets-v11', // changed to standard style for reliability
                center: [lng, lat],
                zoom: zoom,
                attributionControl: false
            });

            map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

            map.current.on('error', (e) => {
                console.error("Mapbox error:", e);
                setErrorMsg(`Map Error: ${e.error?.message || JSON.stringify(e)}`);
            });

            map.current.on('load', () => {
                if (!map.current) return;
                setMapLoaded(true); // Signal that map is ready

                // Add empty source first
                map.current.addSource('properties', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                    cluster: true,
                    clusterMaxZoom: 14,
                    clusterRadius: 50
                });

                // Clusters Layer
                map.current.addLayer({
                    id: 'clusters',
                    type: 'circle',
                    source: 'properties',
                    filter: ['has', 'point_count'],
                    paint: {
                        'circle-color': ['step', ['get', 'point_count'], '#51bbd6', 100, '#f1f075', 750, '#f28cb1'],
                        'circle-radius': ['step', ['get', 'point_count'], 20, 100, 30, 750, 40]
                    }
                });

                // Cluster Count Layer
                map.current.addLayer({
                    id: 'cluster-count',
                    type: 'symbol',
                    source: 'properties',
                    filter: ['has', 'point_count'],
                    layout: {
                        'text-field': '{point_count_abbreviated}',
                        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                        'text-size': 12
                    }
                });

                // Unclustered Points Layer
                map.current.addLayer({
                    id: 'unclustered-point',
                    type: 'circle',
                    source: 'properties',
                    filter: ['!', ['has', 'point_count']],
                    paint: {
                        'circle-color': [
                            'case',
                            ['==', ['get', 'size_m2'], 0], '#9ca3af',   // Grey (Unknown size)
                            ['<', ['get', 'price_per_m2'], 3000], '#22c55e', // Green (Cheap < 3k)
                            ['<', ['get', 'price_per_m2'], 5000], '#eab308', // Yellow (Medium 3k-5k)
                            '#ef4444' // Red (Expensive > 5k)
                        ],
                        'circle-radius': 8,
                        'circle-stroke-width': 1,
                        'circle-stroke-color': '#fff'
                    }
                });

                // Click on Cluster -> Zoom
                map.current.on('click', 'clusters', (e) => {
                    const features = map.current?.queryRenderedFeatures(e.point, { layers: ['clusters'] });
                    const clusterId = features?.[0].properties?.cluster_id;
                    (map.current?.getSource('properties') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(
                        clusterId,
                        (err, zoom) => {
                            if (err || !map.current) return;
                            map.current.easeTo({
                                center: (features?.[0].geometry as any).coordinates,
                                zoom: zoom || 14
                            });
                        }
                    );
                });

                // Click on Point -> Popup
                map.current.on('click', 'unclustered-point', (e) => {
                    if (!e.features || !e.features[0]) return;
                    const feature = e.features[0];
                    const coordinates = (feature.geometry as any).coordinates.slice();
                    const props = feature.properties as any;

                    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                    }

                    // Price formatting
                    const priceFormatted = new Intl.NumberFormat('de-DE').format(props.price);

                    // Logic for Size display
                    const size = props.size_m2;
                    const sizeDisplay = size > 0 ? `${size} m²` : `<span class="text-gray-400 italic">N/A</span>`;
                    const pricePerM2Display = size > 0
                        ? `${(props.price / size).toFixed(0)} ${props.currency}/m²`
                        : ``;

                    // --- GENERATE PRICE HISTORY CHART ---
                    let chartHtml = '';
                    let history = [];
                    try {
                        history = JSON.parse(props.price_history_json || '[]');
                    } catch (e) {
                        console.error("Error parsing price history", e);
                    }

                    // Always add current price as the last point if not present (or simply use history + current)
                    // For now, let's assume history contains all we need. If empty, we use current price.
                    if (history.length === 0) {
                        history.push({ price: props.price, recorded_at: new Date().toISOString() });
                    }

                    // Sort by date
                    history.sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

                    // Find Min/Max for dynamic scaling
                    const prices = history.map((h: any) => h.price);
                    const minPrice = Math.min(...prices);
                    const maxPrice = Math.max(...prices);
                    const range = maxPrice - minPrice;
                    // If flat line (range 0), use a default height of 50%.

                    const bars = history.map((h: any, index: number) => {
                        const date = new Date(h.recorded_at);
                        const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
                        const priceStr = new Intl.NumberFormat('de-DE', { notation: "compact", maximumFractionDigits: 1 }).format(h.price);

                        // Calculate height percentage. 
                        // Baseline 20% height + 80% * (val - min) / range
                        let heightPercent = 50;
                        if (range > 0) {
                            heightPercent = 20 + 70 * ((h.price - minPrice) / range);
                        }

                        // Color logic: Green = current/latest, Gray = past
                        const isLast = index === history.length - 1;
                        const barColorClass = isLast ? 'bg-green-500' : 'bg-gray-300';

                        return `
                            <div class="flex flex-col items-center justify-end h-full w-full group relative">
                                <span class="text-[10px] text-gray-600 mb-1 font-mono bg-white/80 px-1 rounded opacity-0 group-hover:opacity-100 absolute bottom-full transition-opacity whitespace-nowrap z-10 shadow-sm border border-gray-100 pointer-events-none">
                                    ${new Intl.NumberFormat('de-DE').format(h.price)} €
                                </span>
                                <span class="text-[9px] text-gray-500 mb-0.5 leading-none">${priceStr}</span>
                                <div class="${barColorClass} w-3/4 rounded-t transition-all duration-300 hover:bg-green-600" style="height: ${heightPercent}%"></div>
                                <span class="text-[9px] text-gray-400 mt-1 leading-none text-center transform -rotate-0">${dateStr}</span>
                            </div>
                        `;
                    }).join('');


                    chartHtml = `
                        <div class="mt-3 pt-3 border-t border-gray-100">
                            <h4 class="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Price History</h4>
                            <div class="w-full h-24 bg-slate-50 flex items-end justify-between px-2 pb-1 rounded border border-slate-100 gap-1 overflow-x-auto scrollbar-thin">
                                ${bars}
                            </div>
                        </div>
                    `;

                    new mapboxgl.Popup({
                        maxWidth: '400px', // Wider popup
                        closeButton: true,
                        closeOnClick: true
                    })
                        .setLngLat(coordinates)
                        .setHTML(`
                            <div class="p-0 text-black w-[300px] sm:w-[340px]">
                                ${props.image_url ? `<div class="relative w-full h-40"><img src="${props.image_url}" class="w-full h-full object-cover rounded-t" /></div>` : ''}
                                <div class="p-4">
                                    <h3 class="font-bold text-base mb-1 leading-snug line-clamp-2 text-gray-800">${props.title}</h3>
                                    <div class="text-2xl font-bold text-green-600 mb-2">
                                        ${priceFormatted} ${props.currency}
                                    </div>
                                    <div class="grid grid-cols-2 gap-y-2 gap-x-4 text-xs text-gray-600 mb-2">
                                        <div class="flex items-center"><span class="font-bold mr-1 text-gray-800">${sizeDisplay}</span></div>
                                        <div class="flex items-center">${pricePerM2Display ? `<span class="font-medium bg-gray-100 px-1 rounded">${pricePerM2Display}</span>` : ''}</div>
                                        <div class="flex items-center"><span class="font-bold mr-1 text-gray-800">${props.rooms || '--'}</span> Rooms</div>
                                        <div class="flex items-center"><span class="font-bold mr-1 text-gray-800">${props.bathrooms || '--'}</span> Baths</div>
                                    </div>
                                    
                                    ${chartHtml}

                                    <a href="${props.url}" target="_blank" class="mt-4 block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-2.5 px-4 rounded-md transition-colors shadow-sm hover:shadow">
                                        View on Idealista
                                    </a>
                                </div>
                            </div>
                        `)
                        .addTo(map.current!);
                });

                // Hover effects
                map.current.on('mouseenter', 'clusters', () => map.current!.getCanvas().style.cursor = 'pointer');
                map.current.on('mouseleave', 'clusters', () => map.current!.getCanvas().style.cursor = '');
                map.current.on('mouseenter', 'unclustered-point', () => map.current!.getCanvas().style.cursor = 'pointer');
                map.current.on('mouseleave', 'unclustered-point', () => map.current!.getCanvas().style.cursor = '');
            });

        } catch (err: any) {
            console.error("Error initializing map:", err);
            setErrorMsg(`Init Error: ${err.message}`);
        }

        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []);

    // 3. Update Map Data when properties change OR map is ready
    useEffect(() => {
        if (!map.current || !mapLoaded || !map.current.getSource('properties')) return;

        console.log(`Updating map data. Properties: ${properties.length}, MapLoaded: ${mapLoaded}`);

        const features = properties
            .map(p => {
                let lng, lat;

                // Handle WKT string: "POINT(-9.15 38.71)"
                if (typeof p.location === 'string' && p.location.startsWith('POINT')) {
                    const matches = p.location.match(/POINT\(([^ ]+) ([^ ]+)\)/);
                    if (matches) {
                        lng = parseFloat(matches[1]);
                        lat = parseFloat(matches[2]);
                    }
                }
                // Handle GeoJSON format (Supabase might return this)
                else if (typeof p.location === 'object' && p.location !== null && p.location.coordinates) {
                    lng = p.location.coordinates[0];
                    lat = p.location.coordinates[1];
                }

                if (lng === undefined || lat === undefined) {
                    // console.warn(`Property ${p.id} skipped: No valid location.`, p);
                    return null;
                }

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: {
                        id: p.id,
                        title: p.title,
                        price: p.price,
                        currency: p.currency,
                        size_m2: p.size_m2,
                        price_per_m2: p.size_m2 > 0 ? p.price / p.size_m2 : 0,
                        rooms: p.rooms,
                        bathrooms: p.bathrooms,
                        url: p.url,
                        image_url: p.image_url,
                        // Serialize price history to pass it through Mapbox properties (which only support scalar types efficiently, but text is fine)
                        price_history_json: JSON.stringify(p.price_history || [])
                    }
                };
            })
            .filter(p => p !== null);

        const source = map.current.getSource('properties') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: features as any
            });
            console.log("Updated map source with features:", features.length);

            // Auto-zoom to fit all points (only on first large load if zoom is default)
            // Removing strict constraints to avoid jarring jumps on every update
            if (features.length > 0 && zoom === 12) {
                const bounds = new mapboxgl.LngLatBounds();
                features.forEach((feature: any) => {
                    bounds.extend(feature.geometry.coordinates);
                });

                map.current.fitBounds(bounds, {
                    padding: 50,
                    maxZoom: 14,
                    duration: 1000 // smooth animation
                });
            }
        }

        // Force update layer style to ensure color coding applies even if map init didn't re-run (HMR fix)
        if (map.current.getLayer('unclustered-point')) {
            map.current.setPaintProperty('unclustered-point', 'circle-color', [
                'case',
                ['==', ['get', 'size_m2'], 0], '#9ca3af',   // Grey (Unknown size)
                ['<', ['get', 'price_per_m2'], 3000], '#22c55e', // Green (Cheap < 3k)
                ['<', ['get', 'price_per_m2'], 5000], '#eab308', // Yellow (Medium 3k-5k)
                '#ef4444' // Red (Expensive > 5k)
            ]);
        }

    }, [properties, mapLoaded]);

    const [visibleCategories, setVisibleCategories] = useState({
        cheap: true,
        medium: true,
        expensive: true,
        unknown: true
    });

    // 4. Update Map Filter based on visibleCategories
    useEffect(() => {
        if (!map.current || !mapLoaded || !map.current.getLayer('unclustered-point')) return;

        const filters: any[] = ['any'];

        if (visibleCategories.cheap) filters.push(['<', ['get', 'price_per_m2'], 3000]);
        if (visibleCategories.medium) filters.push(['all', ['>=', ['get', 'price_per_m2'], 3000], ['<', ['get', 'price_per_m2'], 5000]]);
        if (visibleCategories.expensive) filters.push(['>=', ['get', 'price_per_m2'], 5000]);
        if (visibleCategories.unknown) filters.push(['==', ['get', 'size_m2'], 0]);

        // If nothing selected, filters will be ['any'] which evaluates to false (hiding everything)
        // We combine with existing filter: ['!', ['has', 'point_count']]

        const finalFilter = ['all', ['!', ['has', 'point_count']], filters];

        map.current.setFilter('unclustered-point', finalFilter);

    }, [visibleCategories, mapLoaded]);

    const toggleCategory = (category: keyof typeof visibleCategories) => {
        setVisibleCategories(prev => ({ ...prev, [category]: !prev[category] }));
    };

    // Simple check without return logic to avoid rendering errors
    const isTokenMissing = !mapboxgl.accessToken;

    return (
        <div className="relative w-full h-screen">
            <div className="absolute top-0 left-0 m-4 p-2 bg-black/70 text-white backdrop-blur rounded shadow z-10 font-mono text-xs">
                Loaded: {properties.length} | Token: {mapboxgl.accessToken ? mapboxgl.accessToken.substring(0, 8) + '...' : 'MISSING'}
            </div>

            {/* LEGEND & FILTERS */}
            <div className="absolute bottom-8 left-4 bg-white/90 backdrop-blur p-3 rounded-lg shadow-lg z-10 border border-gray-200">
                <h4 className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">Price / m²</h4>
                <div className="space-y-2">
                    <div
                        onClick={() => toggleCategory('cheap')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.cheap ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-green-500 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium">&lt; 3.000 €</span>
                    </div>
                    <div
                        onClick={() => toggleCategory('medium')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.medium ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-yellow-400 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium">3.000 - 5.000 €</span>
                    </div>
                    <div
                        onClick={() => toggleCategory('expensive')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.expensive ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-red-500 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium">&gt; 5.000 €</span>
                    </div>
                    <div
                        onClick={() => toggleCategory('unknown')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.unknown ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-gray-400 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium">N/A (Unknown)</span>
                    </div>
                </div>
            </div>

            {isTokenMissing && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-600 text-white p-4 rounded shadow-lg z-50">
                    Error: Mapbox Token Missing in .env.local
                </div>
            )}

            {errorMsg && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-600 text-white p-4 rounded shadow-lg z-50 max-w-sm break-words">
                    {errorMsg}
                </div>
            )}
            <div ref={mapContainer} className="w-full h-full" />
        </div>
    );
}
