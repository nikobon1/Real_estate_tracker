"use client";

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

// 1. Get and sanitize token at MODULE LEVEL (synchronously)
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

    // Filters State
    const [visibleCategories, setVisibleCategories] = useState({
        cheap: true,
        medium: true,
        expensive: true,
        unknown: true
    });

    // Area Filter State
    const [sizeRange, setSizeRange] = useState<[number, number]>([0, 500]);
    const [maxSizeAvailable, setMaxSizeAvailable] = useState(500);

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
                setProperties(data || []);
            }
        };

        fetchProperties();
    }, []);

    // 2. Initialize Mapbox
    useEffect(() => {
        if (map.current) return;
        if (!mapContainer.current) return;

        if (!mapboxgl.accessToken) {
            console.error("Mapbox Access Token is missing");
            setErrorMsg("Mapbox Token is missing in .env.local");
            return;
        }

        try {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/streets-v11',
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
                setMapLoaded(true);

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

                // Events
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

                map.current.on('click', 'unclustered-point', (e) => {
                    if (!e.features || !e.features[0]) return;
                    const feature = e.features[0];
                    const coordinates = (feature.geometry as any).coordinates.slice();
                    const props = feature.properties as any;

                    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                    }

                    const priceFormatted = new Intl.NumberFormat('de-DE').format(props.price);
                    const size = props.size_m2;
                    const sizeDisplay = size > 0 ? `${size} m²` : `<span class="text-gray-400 italic">N/A</span>`;
                    const pricePerM2Display = size > 0
                        ? `${(props.price / size).toFixed(0)} ${props.currency}/m²`
                        : ``;

                    // Chart Logic
                    let chartHtml = '';
                    let history = [];
                    try {
                        history = JSON.parse(props.price_history_json || '[]');
                    } catch (e) { console.error(e); }

                    if (history.length === 0) history.push({ price: props.price, recorded_at: new Date().toISOString() });
                    history.sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

                    const prices = history.map((h: any) => h.price);
                    const minPrice = Math.min(...prices);
                    const maxPrice = Math.max(...prices);
                    const range = maxPrice - minPrice;

                    const bars = history.map((h: any, index: number) => {
                        const date = new Date(h.recorded_at);
                        const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
                        const priceStr = new Intl.NumberFormat('de-DE', { notation: "compact", maximumFractionDigits: 1 }).format(h.price);

                        let heightPercent = 50;
                        if (range > 0) heightPercent = 20 + 70 * ((h.price - minPrice) / range);

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

                    new mapboxgl.Popup({ maxWidth: '400px', closeButton: true, closeOnClick: true })
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

    // 3. Update Max Size Available
    useEffect(() => {
        if (properties.length > 0) {
            const sizes = properties.map(p => p.size_m2 || 0);
            const max = Math.ceil(Math.max(...sizes) / 10) * 10;
            if (max > maxSizeAvailable) {
                setMaxSizeAvailable(max);
                setSizeRange([0, max]);
            }
        }
    }, [properties.length]);

    // 4. Update Map Data with FILTERING logic
    useEffect(() => {
        if (!map.current || !mapLoaded || !map.current.getSource('properties')) return;

        // --- FILTERING LOGIC START ---

        // This runs locally on the valid properties result from Supabase
        const filteredProperties = properties.filter(p => {
            const size = p.size_m2 || 0;
            const pricePerM2 = size > 0 ? p.price / size : 0;

            // 1. Size Filter
            // If it's a known size, check range.
            // If it's 0 (unknown), pass it ONLY if we allow unknown. 
            // BUT essentially: 
            // - If size > 0, strict range check.
            // - If size == 0, we treat it as valid for "size range" purposes? usually NO, it's outside any range.
            //   However, if we want to show unknown sizes, we should only hide them if 'unknown' category is off.
            if (size > 0) {
                if (size < sizeRange[0] || size > sizeRange[1]) return false;
            }

            // 2. Category Filter
            if (size === 0) {
                if (!visibleCategories.unknown) return false;
            } else {
                if (pricePerM2 < 3000) {
                    if (!visibleCategories.cheap) return false;
                } else if (pricePerM2 < 5000) {
                    if (!visibleCategories.medium) return false;
                } else {
                    if (!visibleCategories.expensive) return false;
                }
            }

            return true;
        });

        // --- FILTERING LOGIC END ---

        const features = filteredProperties
            .map(p => {
                let lng, lat;
                if (typeof p.location === 'string' && p.location.startsWith('POINT')) {
                    const matches = p.location.match(/POINT\(([^ ]+) ([^ ]+)\)/);
                    if (matches) { lng = parseFloat(matches[1]); lat = parseFloat(matches[2]); }
                } else if (typeof p.location === 'object' && p.location !== null && p.location.coordinates) {
                    lng = p.location.coordinates[0];
                    lat = p.location.coordinates[1];
                }

                if (lng === undefined || lat === undefined) return null;

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

            // Auto-zoom only on first substantial load
            if (features.length > 0 && zoom === 12 && !mapContainer.current?.dataset.zoomed) {
                // Mark as zoomed to prevent re-zooming on filter change
                if (mapContainer.current) mapContainer.current.dataset.zoomed = "true";

                const bounds = new mapboxgl.LngLatBounds();
                features.forEach((feature: any) => bounds.extend(feature.geometry.coordinates));
                map.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 1000 });
            }
        }

    }, [properties, mapLoaded, visibleCategories, sizeRange]);

    const toggleCategory = (category: keyof typeof visibleCategories) => {
        setVisibleCategories(prev => ({ ...prev, [category]: !prev[category] }));
    };

    const isTokenMissing = !mapboxgl.accessToken;

    return (
        <div className="relative w-full h-screen">
            <div className="absolute top-0 left-0 m-4 p-2 bg-black/70 text-white backdrop-blur rounded shadow z-10 font-mono text-xs">
                Loaded: {properties.length} | Token: {mapboxgl.accessToken ? mapboxgl.accessToken.substring(0, 8) + '...' : 'MISSING'}
            </div>

            {/* LEGEND & FILTERS */}
            <div className="absolute bottom-8 left-4 bg-white/90 backdrop-blur p-4 rounded-lg shadow-lg z-10 border border-gray-200 w-64">
                <h4 className="text-xs font-bold text-gray-700 mb-3 uppercase tracking-wide border-b border-gray-100 pb-2">Filters</h4>

                {/* Price Categories */}
                <div className="space-y-2 mb-4">
                    <div
                        onClick={() => toggleCategory('cheap')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.cheap ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-green-500 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium flex-1">&lt; 3.000 €/m²</span>
                    </div>
                    <div
                        onClick={() => toggleCategory('medium')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.medium ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-yellow-400 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium flex-1">3k - 5k €/m²</span>
                    </div>
                    <div
                        onClick={() => toggleCategory('expensive')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.expensive ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-red-500 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium flex-1">&gt; 5.000 €/m²</span>
                    </div>
                    <div
                        onClick={() => toggleCategory('unknown')}
                        className={`flex items-center gap-2 cursor-pointer transition-opacity ${visibleCategories.unknown ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <div className="w-3 h-3 rounded-full bg-gray-400 shadow-sm"></div>
                        <span className="text-xs text-gray-700 font-medium flex-1">Unknown Size</span>
                    </div>
                </div>

                {/* Area Slider */}
                <div className="pt-2 border-t border-gray-100">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-semibold">
                        <span>Area (m²)</span>
                        <span>{sizeRange[0]} - {sizeRange[1]} m²</span>
                    </div>

                    <div className="relative h-8 mt-2">
                        {/* Custom Slider UI using basic HTML range inputs */}
                        <style jsx>{`
                            input[type=range]::-webkit-slider-thumb {
                                pointer-events: all;
                                width: 14px;
                                height: 14px;
                                -webkit-appearance: none;
                                background: #3b82f6;
                                border-radius: 50%;
                                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                                cursor: pointer;
                                margin-top: -6px;
                            }
                            input[type=range]::-moz-range-thumb {
                                pointer-events: all;
                                width: 14px;
                                height: 14px;
                                background: #3b82f6;
                                border-radius: 50%;
                                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                                cursor: pointer;
                                border: none;
                            }
                        `}</style>

                        {/* Track Background */}
                        <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-200 rounded -translate-y-1/2"></div>

                        {/* Active Track */}
                        <div
                            className="absolute top-1/2 h-1 bg-blue-400 rounded -translate-y-1/2"
                            style={{
                                left: `${(sizeRange[0] / maxSizeAvailable) * 100}%`,
                                right: `${100 - (sizeRange[1] / maxSizeAvailable) * 100}%`
                            }}
                        ></div>

                        {/* Min Thumb */}
                        <input
                            type="range"
                            min="0"
                            max={maxSizeAvailable}
                            value={sizeRange[0]}
                            onChange={(e) => {
                                const val = Math.min(Number(e.target.value), sizeRange[1] - 1);
                                setSizeRange([val, sizeRange[1]]);
                            }}
                            className="absolute top-0 left-0 w-full h-1 appearance-none bg-transparent pointer-events-none focus:outline-none z-20"
                        />

                        {/* Max Thumb */}
                        <input
                            type="range"
                            min="0"
                            max={maxSizeAvailable}
                            value={sizeRange[1]}
                            onChange={(e) => {
                                const val = Math.max(Number(e.target.value), sizeRange[0] + 1);
                                setSizeRange([sizeRange[0], val]);
                            }}
                            className="absolute top-0 left-0 w-full h-1 appearance-none bg-transparent pointer-events-none focus:outline-none z-30"
                        />
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
