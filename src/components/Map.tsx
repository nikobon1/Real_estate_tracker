"use client";

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

// Ensure you set your token in .env.local
// NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1Ijoi...

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export default function MapComponent() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [lng, setLng] = useState(-9.139); // Lisbon
    const [lat, setLat] = useState(38.722);
    const [zoom, setZoom] = useState(12);
    const [properties, setProperties] = useState<any[]>([]);

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

    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (!mapContainer.current) return;

        const [errorMsg, setErrorMsg] = useState<string | null>(null);

        useEffect(() => {
            if (map.current) return; // initialize map only once
            if (!mapContainer.current) return;

            if (!mapboxgl.accessToken) {
                console.error("Mapbox Access Token is missing. Please set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local");
                setErrorMsg("Mapbox Token is missing");
                return;
            }

            try {
                map.current = new mapboxgl.Map({
                    container: mapContainer.current,
                    style: 'mapbox://styles/mapbox/dark-v11', // Dark mode for premium feel
                    center: [lng, lat],
                    zoom: zoom,
                    attributionControl: false
                });

                map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

                map.current.on('error', (e) => {
                    console.error("Mapbox error:", e);
                    setErrorMsg(`Map Error: ${e.error?.message || "Unknown error"}`);
                });

                map.current.on('load', () => {
                    // ... (rest of the load logic)

                    if (!map.current) return;

                    // Load empty source first
                    map.current.addSource('properties', {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: []
                        },
                        cluster: true,
                        clusterMaxZoom: 14, // Max zoom to cluster points on
                        clusterRadius: 50 // Radius of each cluster when clustering points (defaults to 50)
                    });

                    // Layer for Clusters
                    map.current.addLayer({
                        id: 'clusters',
                        type: 'circle',
                        source: 'properties',
                        filter: ['has', 'point_count'],
                        paint: {
                            'circle-color': [
                                'step',
                                ['get', 'point_count'],
                                '#51bbd6',
                                100,
                                '#f1f075',
                                750,
                                '#f28cb1'
                            ],
                            'circle-radius': [
                                'step',
                                ['get', 'point_count'],
                                20,
                                100,
                                30,
                                750,
                                40
                            ]
                        }
                    });

                    // Layer for Cluster Text
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

                    // Layer for Unclustered Points (Individual Properties)
                    map.current.addLayer({
                        id: 'unclustered-point',
                        type: 'circle',
                        source: 'properties',
                        filter: ['!', ['has', 'point_count']],
                        paint: {
                            'circle-color': '#4ade80', // Green for active
                            'circle-radius': 8,
                            'circle-stroke-width': 1,
                            'circle-stroke-color': '#fff'
                        }
                    });

                    // Inspect a cluster on click
                    map.current.on('click', 'clusters', (e) => {
                        const features = map.current?.queryRenderedFeatures(e.point, {
                            layers: ['clusters']
                        });
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

                    // Show popup for individual points
                    map.current.on('click', 'unclustered-point', (e) => {
                        if (!e.features || !e.features[0]) return;
                        const feature = e.features[0];
                        const coordinates = (feature.geometry as any).coordinates.slice();
                        const { title, price, currency, size_m2, url, image_url } = feature.properties as any;

                        // Ensure that if the map is zoomed out such that multiple
                        // copies of the feature are visible, the popup appears
                        // over the copy being pointed to.
                        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                        }

                        new mapboxgl.Popup()
                            .setLngLat(coordinates)
                            .setHTML(`
                        <div class="p-2 max-w-xs">
                            ${image_url ? `<img src="${image_url}" class="w-full h-32 object-cover rounded mb-2" />` : ''}
                            <h3 class="font-bold text-sm mb-1">${title}</h3>
                            <div class="text-lg font-bold text-green-600 mb-1">
                                ${new Intl.NumberFormat('de-DE').format(price)} ${currency}
                            </div>
                            <div class="text-xs text-gray-500 mb-2">
                                ${size_m2} m² • ${(price / size_m2).toFixed(0)} ${currency}/m²
                            </div>
                            <a href="${url}" target="_blank" class="block w-full text-center bg-blue-600 text-white text-xs py-1 px-2 rounded hover:bg-blue-700">
                                View on Idealista
                            </a>
                        </div>
                    `)
                            .addTo(map.current!);
                    });

                    // Change cursor on hover
                    map.current.on('mouseenter', 'clusters', () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
                    map.current.on('mouseleave', 'clusters', () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
                    map.current.on('mouseenter', 'unclustered-point', () => { if (map.current) map.current.getCanvas().style.cursor = 'pointer'; });
                    map.current.on('mouseleave', 'unclustered-point', () => { if (map.current) map.current.getCanvas().style.cursor = ''; });
                });

                // Cleanup
                return () => {
                    if (map.current) {
                        map.current.remove();
                        map.current = null;
                    }
                }
            }, []); // Only run once on mount

        // Update map source when properties change
        useEffect(() => {
            if (!map.current || !map.current.getSource('properties')) return;

            const features = properties
                .filter(p => p.location && p.location.startsWith('POINT'))
                .map(p => {
                    // Parse WKT: POINT(-9.15 38.71)
                    const matches = p.location.match(/POINT\(([^ ]+) ([^ ]+)\)/);
                    if (!matches) return null;
                    const lng = parseFloat(matches[1]);
                    const lat = parseFloat(matches[2]);

                    return {
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [lng, lat]
                        },
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

            (map.current.getSource('properties') as mapboxgl.GeoJSONSource).setData({
                type: 'FeatureCollection',
                features: features as any
            });

            // Fly to the first property if we have loaded data effectively
            if (features.length > 0) {
                const first = features[0];
                // map.current.flyTo({ center: first.geometry.coordinates as [number, number], zoom: 12 });
            }

        }, [properties]);

        if (!mapboxgl.accessToken) {
            return (
                <div className="flex items-center justify-center w-full h-full bg-gray-100 text-red-500 p-4">
                    Error: Mapbox Access Token missing. Check .env.local
                </div>
            )
        }

        return (
            <div className="relative w-full h-full">
                <div className="absolute top-0 left-0 m-4 p-2 bg-black/70 text-white backdrop-blur rounded shadow z-10 font-mono text-xs">
                    Properties loaded: {properties.length}
                </div>
                {errorMsg && (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-600 text-white p-4 rounded shadow-lg z-50">
                        {errorMsg}
                    </div>
                )}
                <div ref={mapContainer} className="w-full h-full" />
            </div>
        );
    }
