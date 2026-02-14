"use client";

import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Ensure you set your token in .env.local
// NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1Ijoi...

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export default function MapComponent() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const [lng, setLng] = useState(-9.139); // Lisbon
    const [lat, setLat] = useState(38.722);
    const [zoom, setZoom] = useState(12);

    useEffect(() => {
        if (map.current) return; // initialize map only once
        if (!mapContainer.current) return;

        if (!mapboxgl.accessToken) {
            console.error("Mapbox Access Token is missing. Please set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local");
            return;
        }

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [lng, lat],
            zoom: zoom,
            attributionControl: false
        });

        map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

        map.current.on('move', () => {
            if (!map.current) return;
            setLng(parseFloat(map.current.getCenter().lng.toFixed(4)));
            setLat(parseFloat(map.current.getCenter().lat.toFixed(4)));
            setZoom(parseFloat(map.current.getZoom().toFixed(2)));
        });

        // Cleanup
        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        }
    }, [lng, lat, zoom]);

    if (!mapboxgl.accessToken) {
        return (
            <div className="flex items-center justify-center w-full h-full bg-gray-100 text-red-500 p-4">
                Error: Mapbox Access Token missing. Check .env.local
            </div>
        )
    }

    return (
        <div className="relative w-full h-full">
            <div className="absolute top-0 left-0 m-4 p-2 bg-white/90 backdrop-blur rounded shadow z-10 font-mono text-xs">
                Lng: {lng} | Lat: {lat} | Zoom: {zoom}
            </div>
            <div ref={mapContainer} className="w-full h-full" />
        </div>
    );
}
