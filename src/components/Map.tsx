"use client";

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

// Ensure you set your token in .env.local
// NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1Ijoi...



export default function MapComponent() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [lng, setLng] = useState(-9.139); // Lisbon
    const [lat, setLat] = useState(38.722);
    const [zoom, setZoom] = useState(12);
    const [properties, setProperties] = useState<any[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
                setProperties(data || []);
            }
        };

        fetchProperties();
    }, []);

    // 2. Initialize Mapbox
    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (!mapContainer.current) return;

        // 1. Get and sanitize token
        let token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
        if (token.startsWith('pk.pk.')) {
            console.warn("Found double 'pk.' prefix in token, fixing...");
            token = token.substring(3);
        }
        mapboxgl.accessToken = token;

        if (!mapboxgl.accessToken) {
            console.error("Mapbox Access Token is missing");
            setErrorMsg("Mapbox Token is missing in .env.local");
            return;
        }

        console.log("Initializing Mapbox with token:", token.substring(0, 8) + "...");

        try {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/dark-v11',
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

                    new mapboxgl.Popup()
                        .setLngLat(coordinates)
                        .setHTML(`
                            <div class="p-2 max-w-xs text-black">
                                ${props.image_url ? `<img src="${props.image_url}" class="w-full h-32 object-cover rounded mb-2" />` : ''}
                                <h3 class="font-bold text-sm mb-1">${props.title}</h3>
                                <div class="text-lg font-bold text-green-600 mb-1">
                                    ${new Intl.NumberFormat('de-DE').format(props.price)} ${props.currency}
                                </div>
                                <div class="text-xs text-gray-500 mb-2">
                                    ${props.size_m2} m² • ${(props.price / props.size_m2).toFixed(0)} ${props.currency}/m²
                                </div>
                                <a href="${props.url}" target="_blank" class="block w-full text-center bg-blue-600 text-white text-xs py-1 px-2 rounded hover:bg-blue-700">
                                    View on Idealista
                                </a>
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

    // 3. Update Map Data when properties change
    useEffect(() => {
        if (!map.current || !map.current.getSource('properties')) return;
        if (properties.length === 0) return;

        const features = properties
            .filter(p => p.location && p.location.startsWith('POINT'))
            .map(p => {
                const matches = p.location.match(/POINT\(([^ ]+) ([^ ]+)\)/);
                if (!matches) return null;
                const lng = parseFloat(matches[1]);
                const lat = parseFloat(matches[2]);

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [lng, lat] },
                    properties: {
                        id: p.id,
                        title: p.title,
                        price: p.price,
                        currency: p.currency,
                        size_m2: p.size_m2,
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
            console.log("Updated map with features:", features.length);
        }

    }, [properties]);

    if (!mapboxgl.accessToken) {
        return <div className="p-10 text-red-500">Error: Mapbox Token Missing</div>;
    }

    return (
        <div className="relative w-full h-full">
            <div className="absolute top-0 left-0 m-4 p-2 bg-black/70 text-white backdrop-blur rounded shadow z-10 font-mono text-xs">
                Loaded: {properties.length} | Token: {mapboxgl.accessToken ? mapboxgl.accessToken.substring(0, 8) + '...' : 'MISSING'}
            </div>
            {errorMsg && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-600 text-white p-4 rounded shadow-lg z-50 max-w-sm break-words">
                    {errorMsg}
                </div>
            )}
            <div ref={mapContainer} className="w-full h-full" />
        </div>
    );
}
