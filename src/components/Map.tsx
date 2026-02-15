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
                .select('*');

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
                        'circle-color': '#4ade80',
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

                    // Simple Chart Placeholder
                    // We can't easily render React components inside Mapbox popup HTML string without extra lib
                    // So we use standard HTML/CSS.
                    const chartPlaceholder = `
                        <div class="mt-2 pt-2 border-t border-gray-200">
                            <h4 class="text-xs font-semibold text-gray-500 mb-1">Price History</h4>
                            <div class="w-full h-16 bg-gray-50 flex items-end justify-between px-1 rounded relative">
                                <!-- Mock Bars for "Simple Chart" -->
                                <div class="w-1/5 bg-green-200 h-1/2 rounded-t" title="Past"></div>
                                <div class="w-1/5 bg-green-300 h-2/3 rounded-t" title="Past"></div>
                                <div class="w-1/5 bg-green-400 h-3/4 rounded-t" title="Past"></div>
                                <div class="w-1/5 bg-green-500 h-full rounded-t" title="Current"></div>
                            </div>
                            <div class="flex justify-between text-[10px] text-gray-400 mt-1">
                                <span>3m ago</span>
                                <span>Now</span>
                            </div>
                        </div>
                    `;

                    new mapboxgl.Popup()
                        .setLngLat(coordinates)
                        .setHTML(`
                            <div class="p-0 max-w-xs text-black w-64">
                                ${props.image_url ? `<div class="relative w-full h-32"><img src="${props.image_url}" class="w-full h-full object-cover rounded-t" /></div>` : ''}
                                <div class="p-3">
                                    <h3 class="font-bold text-sm mb-1 leading-tight line-clamp-2">${props.title}</h3>
                                    <div class="text-xl font-bold text-green-600 mb-1">
                                        ${priceFormatted} ${props.currency}
                                    </div>
                                    <div class="grid grid-cols-2 gap-2 text-xs text-gray-500 mb-2">
                                        <div><span class="font-semibold text-gray-700">${props.size_m2}</span> m²</div>
                                        <div><span class="font-semibold text-gray-700">${(props.price / props.size_m2).toFixed(0)}</span> ${props.currency}/m²</div>
                                        <div><span class="font-semibold text-gray-700">${props.rooms || '?'}</span> Rooms</div>
                                        <div><span class="font-semibold text-gray-700">${props.bathrooms || '?'}</span> Baths</div>
                                    </div>
                                    ${chartPlaceholder}
                                    <a href="${props.url}" target="_blank" class="mt-3 block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs py-2 px-3 rounded transition-colors">
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
                        rooms: p.rooms,
                        bathrooms: p.bathrooms,
                        url: p.url,
                        image_url: p.image_url
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

    }, [properties, mapLoaded]);

    // Simple check without return logic to avoid rendering errors
    const isTokenMissing = !mapboxgl.accessToken;

    return (
        <div className="relative w-full h-screen">
            <div className="absolute top-0 left-0 m-4 p-2 bg-black/70 text-white backdrop-blur rounded shadow z-10 font-mono text-xs">
                Loaded: {properties.length} | Token: {mapboxgl.accessToken ? mapboxgl.accessToken.substring(0, 8) + '...' : 'MISSING'}
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
