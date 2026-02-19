"use client";

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '@/lib/supabase';

// 1. Get and sanitize token at MODULE LEVEL (synchronously)
let token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
if (token.startsWith('pk.pk.')) {
    token = token.substring(3);
}
mapboxgl.accessToken = token;

const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_FILTER_CAP = 1_000_000;
const MAX_COMPARE_ITEMS = 4;
const FAVORITES_STORAGE_KEY = 're_tracker_favorites_v1';
const COMPARE_STORAGE_KEY = 're_tracker_compare_v1';
const POLYGON_SOURCE_ID = 'search-polygon';
const POLYGON_FILL_LAYER_ID = 'search-polygon-fill';
const POLYGON_LINE_LAYER_ID = 'search-polygon-line';
const POLYGON_POINTS_LAYER_ID = 'search-polygon-points';

type LngLatTuple = [number, number];
type PriceHistoryEntry = { price?: number; recorded_at?: string };
type PropertyRecord = {
    id: string;
    title: string;
    price: number;
    currency: string;
    size_m2: number;
    rooms?: number;
    bathrooms?: number;
    url: string;
    image_url?: string | null;
    year_built?: number | null;
    location: any;
    price_history?: PriceHistoryEntry[];
    [key: string]: any;
};

const formatPriceShort = (value: number) => {
    return new Intl.NumberFormat('de-DE', {
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(value || 0);
};

const escapeForOnclick = (value: string) => {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
};

const toDayStart = (timestamp: number) => {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

const formatShortDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
    });
};

const parseLocationCoordinates = (location: any): LngLatTuple | null => {
    if (typeof location === 'string' && location.startsWith('POINT')) {
        const matches = location.match(/POINT\(([^ ]+) ([^ ]+)\)/);
        if (matches) return [parseFloat(matches[1]), parseFloat(matches[2])];
        return null;
    }

    if (
        typeof location === 'object' &&
        location !== null &&
        Array.isArray(location.coordinates) &&
        location.coordinates.length === 2
    ) {
        return [Number(location.coordinates[0]), Number(location.coordinates[1])];
    }

    return null;
};

const getPropertyHistoryDates = (property: PropertyRecord): number[] => {
    const history = Array.isArray(property.price_history) ? property.price_history : [];
    return history
        .map((item) => (item?.recorded_at ? Date.parse(item.recorded_at) : NaN))
        .filter((date): date is number => Number.isFinite(date))
        .map(toDayStart);
};

const isPointInPolygon = (point: LngLatTuple, polygon: LngLatTuple[]) => {
    if (polygon.length < 3) return false;
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        const intersects =
            yi > y !== yj > y &&
            x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
        if (intersects) inside = !inside;
    }

    return inside;
};

const findClosestVertexIndex = (points: LngLatTuple[], target: LngLatTuple) => {
    if (points.length === 0) return -1;
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;

    points.forEach((point, index) => {
        const distance = Math.hypot(point[0] - target[0], point[1] - target[1]);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
        }
    });

    return closestIndex;
};

const buildPolygonFeatureCollection = (points: LngLatTuple[], closed: boolean) => {
    const features: any[] = [];
    if (points.length > 0) {
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: points },
            properties: {}
        });

        features.push({
            type: 'Feature',
            geometry: { type: 'MultiPoint', coordinates: points },
            properties: {}
        });
    }

    if (closed && points.length >= 3) {
        features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[...points, points[0]]] },
            properties: {}
        });
    }

    return {
        type: 'FeatureCollection',
        features
    };
};

export default function MapComponent() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const isDrawingPolygonRef = useRef(false);
    const isDraggingVertexRef = useRef(false);
    const draggedVertexIndexRef = useRef<number | null>(null);
    const polygonPointsRef = useRef<LngLatTuple[]>([]);
    const favoriteIdsRef = useRef<string[]>([]);
    const compareIdsRef = useRef<string[]>([]);
    const [lng] = useState(-9.139); // Lisbon
    const [lat] = useState(38.722);
    const [zoom] = useState(12);
    const [properties, setProperties] = useState<PropertyRecord[]>([]);
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

    // Total Price Filter State
    const [priceRange, setPriceRange] = useState<[number, number]>([0, 5000000]);
    const [minPriceAvailable, setMinPriceAvailable] = useState(0);
    const [maxPriceAvailable, setMaxPriceAvailable] = useState(5000000);

    // Year Built Filter State
    const [yearRange, setYearRange] = useState<[number, number]>([1900, 2030]);
    const [minYearAvailable, setMinYearAvailable] = useState(1900);
    const [maxYearAvailable, setMaxYearAvailable] = useState(2030);

    // Timeline Filter State
    const [dateRange, setDateRange] = useState<[number, number]>(() => {
        const today = toDayStart(Date.now());
        return [today - 180 * DAY_MS, today];
    });
    const [minDateAvailable, setMinDateAvailable] = useState(() => toDayStart(Date.now() - 180 * DAY_MS));
    const [maxDateAvailable, setMaxDateAvailable] = useState(() => toDayStart(Date.now()));

    // Polygon Search State
    const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
    const [polygonPoints, setPolygonPoints] = useState<LngLatTuple[]>([]);
    const [isPolygonClosed, setIsPolygonClosed] = useState(false);
    const [isDraggingVertex, setIsDraggingVertex] = useState(false);
    const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
    const [compareIds, setCompareIds] = useState<string[]>([]);

    useEffect(() => {
        isDrawingPolygonRef.current = isDrawingPolygon;
        if (map.current) {
            if (isDraggingVertex) {
                map.current.getCanvas().style.cursor = 'grabbing';
            } else {
                map.current.getCanvas().style.cursor = isDrawingPolygon ? 'crosshair' : '';
            }
        }
    }, [isDrawingPolygon, isDraggingVertex]);

    useEffect(() => {
        polygonPointsRef.current = polygonPoints;
    }, [polygonPoints]);

    useEffect(() => {
        favoriteIdsRef.current = favoriteIds;
    }, [favoriteIds]);

    useEffect(() => {
        compareIdsRef.current = compareIds;
    }, [compareIds]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const rawFavorites = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
            const rawCompare = window.localStorage.getItem(COMPARE_STORAGE_KEY);

            if (rawFavorites) {
                const parsed = JSON.parse(rawFavorites);
                if (Array.isArray(parsed)) setFavoriteIds(parsed.map((item) => String(item)));
            }

            if (rawCompare) {
                const parsed = JSON.parse(rawCompare);
                if (Array.isArray(parsed)) setCompareIds(parsed.map((item) => String(item)).slice(0, MAX_COMPARE_ITEMS));
            }
        } catch (error) {
            console.error('Failed to read localStorage lists:', error);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteIds));
    }, [favoriteIds]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compareIds));
    }, [compareIds]);

    const toggleFavoriteById = useCallback((propertyId: string) => {
        setFavoriteIds((prev) =>
            prev.includes(propertyId)
                ? prev.filter((id) => id !== propertyId)
                : [...prev, propertyId]
        );
    }, []);

    const toggleCompareById = useCallback((propertyId: string) => {
        setCompareIds((prev) => {
            if (prev.includes(propertyId)) return prev.filter((id) => id !== propertyId);
            if (prev.length >= MAX_COMPARE_ITEMS) return prev;
            return [...prev, propertyId];
        });
    }, []);

    const removeFromFavorites = useCallback((propertyId: string) => {
        setFavoriteIds((prev) => prev.filter((id) => id !== propertyId));
    }, []);

    const removeFromCompare = useCallback((propertyId: string) => {
        setCompareIds((prev) => prev.filter((id) => id !== propertyId));
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const popupApi = window as any;
        popupApi.__toggleFavoriteFromPopup = (propertyId: string) => {
            toggleFavoriteById(String(propertyId));
        };
        popupApi.__toggleCompareFromPopup = (propertyId: string) => {
            toggleCompareById(String(propertyId));
        };

        return () => {
            delete popupApi.__toggleFavoriteFromPopup;
            delete popupApi.__toggleCompareFromPopup;
        };
    }, [toggleFavoriteById, toggleCompareById]);

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

                map.current.addSource(POLYGON_SOURCE_ID, {
                    type: 'geojson',
                    data: buildPolygonFeatureCollection([], false) as any
                });

                map.current.addLayer({
                    id: POLYGON_FILL_LAYER_ID,
                    type: 'fill',
                    source: POLYGON_SOURCE_ID,
                    filter: ['==', ['geometry-type'], 'Polygon'],
                    paint: {
                        'fill-color': '#2563eb',
                        'fill-opacity': 0.15
                    }
                });

                map.current.addLayer({
                    id: POLYGON_LINE_LAYER_ID,
                    type: 'line',
                    source: POLYGON_SOURCE_ID,
                    filter: ['==', ['geometry-type'], 'LineString'],
                    paint: {
                        'line-color': '#2563eb',
                        'line-width': 2.5
                    }
                });

                map.current.addLayer({
                    id: POLYGON_POINTS_LAYER_ID,
                    type: 'circle',
                    source: POLYGON_SOURCE_ID,
                    filter: ['==', ['geometry-type'], 'MultiPoint'],
                    paint: {
                        'circle-color': '#1d4ed8',
                        'circle-radius': 5,
                        'circle-stroke-color': '#ffffff',
                        'circle-stroke-width': 1
                    }
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
                    if (isDrawingPolygonRef.current) return;
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
                    if (isDrawingPolygonRef.current) return;
                    if (!e.features || e.features.length === 0) return;

                    // Handle coordinates and wrapping
                    const coordinates = (e.features[0].geometry as any).coordinates.slice();
                    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                    }

                    // --- SINGLE PROPERTY VIEW ---
                    if (e.features.length === 1) {
                        const feature = e.features[0];
                        const props = feature.properties as any;
                        const priceFormatted = new Intl.NumberFormat('de-DE').format(props.price);
                        const size = props.size_m2;
                        const propertyId = String(props.id);
                        const escapedPropertyId = escapeForOnclick(propertyId);
                        const isFavorite = favoriteIdsRef.current.includes(propertyId);
                        const isCompared = compareIdsRef.current.includes(propertyId);
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
                                        <div class="grid grid-cols-2 gap-2 mt-3">
                                            <button
                                                onclick="window.__toggleFavoriteFromPopup('${escapedPropertyId}')"
                                                class="text-xs py-2 px-2 rounded border border-amber-300 bg-amber-50 text-amber-700 font-semibold hover:bg-amber-100 transition-colors"
                                            >
                                                ${isFavorite ? '★ Favorited' : '☆ Favorite'}
                                            </button>
                                            <button
                                                onclick="window.__toggleCompareFromPopup('${escapedPropertyId}')"
                                                class="text-xs py-2 px-2 rounded border border-purple-300 bg-purple-50 text-purple-700 font-semibold hover:bg-purple-100 transition-colors"
                                            >
                                                ${isCompared ? '⇄ In compare' : '⇄ Compare'}
                                            </button>
                                        </div>
                                        ${chartHtml}
                                        <a href="${props.url}" target="_blank" class="mt-4 block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-2.5 px-4 rounded-md transition-colors shadow-sm hover:shadow">
                                            View on Idealista
                                        </a>
                                    </div>
                                </div>
                            `)
                            .addTo(map.current!);

                    }
                    // --- MULTI PROPERTY VIEW (STACKED) ---
                    else {
                        const count = e.features.length;

                        const listItems = e.features.map((feature: any) => {
                            const props = feature.properties;
                            const priceFormatted = new Intl.NumberFormat('de-DE').format(props.price);
                            const size = props.size_m2;
                            const itemId = String(props.id);
                            const escapedItemId = escapeForOnclick(itemId);
                            const itemFavorite = favoriteIdsRef.current.includes(itemId);
                            const itemCompared = compareIdsRef.current.includes(itemId);
                            const sizeDisplay = size > 0 ? `${size} m²` : `N/A`;

                            return `
                                <div class="flex gap-3 p-3 border-b border-gray-100 last:border-0 hover:bg-slate-50 transition-colors">
                                    ${props.image_url ?
                                    `<div class="w-16 h-16 shrink-0 rounded overflow-hidden">
                                            <img src="${props.image_url}" class="w-full h-full object-cover" />
                                        </div>` : ''
                                }
                                    <div class="flex-1 min-w-0">
                                        <div class="font-bold text-green-600 text-sm mb-0.5">${priceFormatted} ${props.currency}</div>
                                        <div class="text-xs text-gray-500 mb-1 font-medium">${sizeDisplay} • ${props.rooms || '-'} Rooms</div>
                                        <div class="text-xs text-gray-800 line-clamp-2 leading-tight mb-2">${props.title}</div>
                                        <div class="flex gap-1.5 mb-2">
                                            <button onclick="window.__toggleFavoriteFromPopup('${escapedItemId}')" class="text-[10px] px-1.5 py-1 rounded border border-amber-300 bg-amber-50 text-amber-700 font-semibold">
                                                ${itemFavorite ? '★ Saved' : '☆ Save'}
                                            </button>
                                            <button onclick="window.__toggleCompareFromPopup('${escapedItemId}')" class="text-[10px] px-1.5 py-1 rounded border border-purple-300 bg-purple-50 text-purple-700 font-semibold">
                                                ${itemCompared ? '⇄ Added' : '⇄ Compare'}
                                            </button>
                                        </div>
                                        <a href="${props.url}" target="_blank" class="text-[10px] font-bold text-blue-600 hover:underline uppercase tracking-wide">
                                            View Listing &rarr;
                                        </a>
                                    </div>
                                </div>
                            `;
                        }).join('');

                        new mapboxgl.Popup({ maxWidth: '340px', closeButton: true, closeOnClick: true })
                            .setLngLat(coordinates)
                            .setHTML(`
                                <div class="text-black w-[300px] max-h-[400px] flex flex-col">
                                    <div class="bg-gray-50 px-3 py-2 border-b border-gray-200 flex justify-between items-center rounded-t">
                                        <span class="font-bold text-xs text-gray-600 uppercase tracking-wider">${count} Properties Here</span>
                                    </div>
                                    <div class="overflow-y-auto custom-scrollbar">
                                        ${listItems}
                                    </div>
                                </div>
                                <style>
                                    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                                    .custom-scrollbar::-webkit-scrollbar-track { bg: transparent; }
                                    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 4px; }
                                </style>
                            `)
                            .addTo(map.current!);
                    }
                });

                map.current.on('click', (e) => {
                    if (!isDrawingPolygonRef.current) return;
                    setPolygonPoints((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
                });

                const stopVertexDragging = () => {
                    if (!isDraggingVertexRef.current) return;
                    isDraggingVertexRef.current = false;
                    draggedVertexIndexRef.current = null;
                    setIsDraggingVertex(false);
                    if (map.current) {
                        map.current.dragPan.enable();
                        map.current.getCanvas().style.cursor = isDrawingPolygonRef.current ? 'crosshair' : '';
                    }
                };

                map.current.on('mousedown', POLYGON_POINTS_LAYER_ID, (e: any) => {
                    if (isDrawingPolygonRef.current) return;
                    if (!e.features || e.features.length === 0) return;

                    const featureCoordinates = (e.features[0].geometry as any)?.coordinates;
                    if (!Array.isArray(featureCoordinates) || featureCoordinates.length < 2) return;

                    const closestIndex = findClosestVertexIndex(
                        polygonPointsRef.current,
                        [Number(featureCoordinates[0]), Number(featureCoordinates[1])]
                    );
                    if (closestIndex < 0) return;

                    e.preventDefault();
                    isDraggingVertexRef.current = true;
                    draggedVertexIndexRef.current = closestIndex;
                    setIsDraggingVertex(true);
                    map.current?.dragPan.disable();
                    if (map.current) map.current.getCanvas().style.cursor = 'grabbing';
                });

                map.current.on('mousemove', (e: any) => {
                    if (!isDraggingVertexRef.current) return;
                    const vertexIndex = draggedVertexIndexRef.current;
                    if (vertexIndex === null) return;

                    setPolygonPoints((prev) => {
                        if (!prev[vertexIndex]) return prev;
                        const next = [...prev];
                        next[vertexIndex] = [e.lngLat.lng, e.lngLat.lat];
                        return next;
                    });
                });

                map.current.on('mouseup', stopVertexDragging);
                map.current.on('dragend', stopVertexDragging);

                map.current.on('mouseenter', 'clusters', () => {
                    if (isDrawingPolygonRef.current || isDraggingVertexRef.current) return;
                    map.current!.getCanvas().style.cursor = 'pointer';
                });
                map.current.on('mouseleave', 'clusters', () => {
                    map.current!.getCanvas().style.cursor = isDraggingVertexRef.current
                        ? 'grabbing'
                        : isDrawingPolygonRef.current
                            ? 'crosshair'
                            : '';
                });
                map.current.on('mouseenter', 'unclustered-point', () => {
                    if (isDrawingPolygonRef.current || isDraggingVertexRef.current) return;
                    map.current!.getCanvas().style.cursor = 'pointer';
                });
                map.current.on('mouseleave', 'unclustered-point', () => {
                    map.current!.getCanvas().style.cursor = isDraggingVertexRef.current
                        ? 'grabbing'
                        : isDrawingPolygonRef.current
                            ? 'crosshair'
                            : '';
                });
                map.current.on('mouseenter', POLYGON_POINTS_LAYER_ID, () => {
                    if (isDrawingPolygonRef.current) return;
                    map.current!.getCanvas().style.cursor = isDraggingVertexRef.current ? 'grabbing' : 'grab';
                });
                map.current.on('mouseleave', POLYGON_POINTS_LAYER_ID, () => {
                    map.current!.getCanvas().style.cursor = isDraggingVertexRef.current
                        ? 'grabbing'
                        : isDrawingPolygonRef.current
                            ? 'crosshair'
                            : '';
                });
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
            const sizes = properties.map((p) => p.size_m2 || 0);
            const max = Math.ceil(Math.max(...sizes) / 10) * 10;
            if (max > maxSizeAvailable) {
                setMaxSizeAvailable(max);
                setSizeRange([0, max]);
            }
        }
    }, [properties, maxSizeAvailable]);

    // 3c. Update Price Range from data
    useEffect(() => {
        if (properties.length > 0) {
            const prices = properties.map((p) => p.price || 0).filter((p) => p > 0);
            if (prices.length > 0) {
                const minPRaw = Math.floor(Math.min(...prices) / 10000) * 10000;
                const maxPRaw = Math.ceil(Math.max(...prices) / 10000) * 10000;
                const maxP = Math.min(maxPRaw, PRICE_FILTER_CAP);
                const minP = Math.min(minPRaw, maxP);
                setMinPriceAvailable(minP);
                setMaxPriceAvailable(maxP);
                setPriceRange([minP, maxP]);
            }
        }
    }, [properties]);

    // 3b. Update Year Built Range from data
    useEffect(() => {
        if (properties.length > 0) {
            const years = properties
                .map((p) => p.year_built)
                .filter((y): y is number => y !== null && y !== undefined && y > 0);
            if (years.length > 0) {
                const minY = Math.min(...years);
                const maxY = Math.max(...years);
                setMinYearAvailable(minY);
                setMaxYearAvailable(maxY);
                setYearRange([minY, maxY]);
            }
        }
    }, [properties]);

    // 3d. Update Timeline bounds from price history
    useEffect(() => {
        if (properties.length === 0) return;

        const dates = properties.flatMap((property) => {
            const historyDates = getPropertyHistoryDates(property);
            if (historyDates.length > 0) return historyDates;
            if (property.created_at) {
                const parsed = Date.parse(property.created_at);
                if (Number.isFinite(parsed)) return [toDayStart(parsed)];
            }
            return [];
        });

        if (dates.length === 0) return;

        const minD = Math.min(...dates);
        const maxD = Math.max(...dates);
        setMinDateAvailable(minD);
        setMaxDateAvailable(maxD);
        setDateRange([minD, maxD]);
    }, [properties]);

    // 3e. Sync polygon drawing GeoJSON source
    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const polygonSource = map.current.getSource(POLYGON_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (!polygonSource) return;

        polygonSource.setData(buildPolygonFeatureCollection(polygonPoints, isPolygonClosed) as any);
    }, [mapLoaded, polygonPoints, isPolygonClosed]);

    // 4. Update Map Data with FILTERING logic
    useEffect(() => {
        if (!map.current || !mapLoaded || !map.current.getSource('properties')) return;

        const hasPolygonFilter = isPolygonClosed && polygonPoints.length >= 3;
        const rangeStart = toDayStart(dateRange[0]);
        const rangeEnd = toDayStart(maxDateAvailable);

        const features = properties
            .map((property) => ({
                property,
                coordinates: parseLocationCoordinates(property.location)
            }))
            .filter((item): item is { property: PropertyRecord; coordinates: LngLatTuple } => !!item.coordinates)
            .filter(({ property, coordinates }) => {
                const size = property.size_m2 || 0;
                const pricePerM2 = size > 0 ? property.price / size : 0;

                // 0. Total Price Filter
                if (property.price > 0) {
                    if (property.price < priceRange[0] || property.price > priceRange[1]) return false;
                }

                // 1. Size Filter
                if (size > 0) {
                    if (size < sizeRange[0] || size > sizeRange[1]) return false;
                }

                // 2. Category Filter
                if (size === 0) {
                    if (!visibleCategories.unknown) return false;
                } else if (pricePerM2 < 3000) {
                    if (!visibleCategories.cheap) return false;
                } else if (pricePerM2 < 5000) {
                    if (!visibleCategories.medium) return false;
                } else if (!visibleCategories.expensive) {
                    return false;
                }

                // 3. Year Built Filter
                const yearBuilt = property.year_built;
                if (yearBuilt && yearBuilt > 0) {
                    if (yearBuilt < yearRange[0] || yearBuilt > yearRange[1]) return false;
                }

                // 4. Timeline Filter (history intersection with selected date range)
                const historyDates = getPropertyHistoryDates(property);
                const fallbackDate = toDayStart(maxDateAvailable);
                const datesToCheck = historyDates.length > 0 ? historyDates : [fallbackDate];
                if (!datesToCheck.some((date) => date >= rangeStart && date <= rangeEnd)) return false;

                // 5. Polygon Filter
                if (hasPolygonFilter && !isPointInPolygon(coordinates, polygonPoints)) return false;

                return true;
            })
            .map(({ property, coordinates }) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates },
                properties: {
                    id: property.id,
                    title: property.title,
                    price: property.price,
                    currency: property.currency,
                    size_m2: property.size_m2,
                    price_per_m2: property.size_m2 > 0 ? property.price / property.size_m2 : 0,
                    rooms: property.rooms,
                    bathrooms: property.bathrooms,
                    url: property.url,
                    image_url: property.image_url,
                    year_built: property.year_built || null,
                    price_history_json: JSON.stringify(property.price_history || [])
                }
            }));

        const source = map.current.getSource('properties') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: features as any
            });

            // Auto-zoom only on first substantial load
            if (features.length > 0 && zoom === 12 && !mapContainer.current?.dataset.zoomed) {
                if (mapContainer.current) mapContainer.current.dataset.zoomed = 'true';

                const bounds = new mapboxgl.LngLatBounds();
                features.forEach((feature: any) => bounds.extend(feature.geometry.coordinates));
                map.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 1000 });
            }
        }
    }, [
        properties,
        mapLoaded,
        visibleCategories,
        sizeRange,
        yearRange,
        priceRange,
        dateRange,
        maxDateAvailable,
        isPolygonClosed,
        polygonPoints,
        zoom
    ]);

    const toggleCategory = (category: keyof typeof visibleCategories) => {
        setVisibleCategories(prev => ({ ...prev, [category]: !prev[category] }));
    };

    const hasPolygonFilter = isPolygonClosed && polygonPoints.length >= 3;
    const canCompletePolygon = isDrawingPolygon && polygonPoints.length >= 3;
    const hasTimelineRange = maxDateAvailable > minDateAvailable;
    const timelineSpan = Math.max(maxDateAvailable - minDateAvailable, DAY_MS);
    const propertiesById = useMemo(() => {
        const byId = new Map<string, PropertyRecord>();
        properties.forEach((property) => byId.set(String(property.id), property));
        return byId;
    }, [properties]);
    const favoriteProperties = useMemo(
        () => favoriteIds.map((id) => propertiesById.get(id)).filter(Boolean) as PropertyRecord[],
        [favoriteIds, propertiesById]
    );
    const compareProperties = useMemo(
        () => compareIds.map((id) => propertiesById.get(id)).filter(Boolean) as PropertyRecord[],
        [compareIds, propertiesById]
    );
    const compareReady = compareProperties.length >= 2;

    const startPolygonDrawing = () => {
        isDraggingVertexRef.current = false;
        draggedVertexIndexRef.current = null;
        setIsDraggingVertex(false);
        if (map.current) map.current.dragPan.enable();
        setPolygonPoints([]);
        setIsPolygonClosed(false);
        setIsDrawingPolygon(true);
    };

    const completePolygonDrawing = () => {
        if (polygonPoints.length < 3) return;
        setIsPolygonClosed(true);
        setIsDrawingPolygon(false);
    };

    const clearPolygon = () => {
        isDraggingVertexRef.current = false;
        draggedVertexIndexRef.current = null;
        setIsDraggingVertex(false);
        if (map.current) map.current.dragPan.enable();
        setPolygonPoints([]);
        setIsPolygonClosed(false);
        setIsDrawingPolygon(false);
    };

    const isTokenMissing = !mapboxgl.accessToken;

    return (
        <div className="relative w-full h-screen">
            <div className="absolute top-0 left-0 m-4 p-2 bg-black/70 text-white backdrop-blur rounded shadow z-10 font-mono text-xs">
                Loaded: {properties.length} | Token: {mapboxgl.accessToken ? mapboxgl.accessToken.substring(0, 8) + '...' : 'MISSING'}
            </div>

            {/* LEGEND & FILTERS */}
            <div className="absolute bottom-8 left-4 bg-white/90 backdrop-blur p-4 rounded-lg shadow-lg z-10 border border-gray-200 w-80 max-h-[85vh] overflow-y-auto">
                <h4 className="text-xs font-bold text-gray-700 mb-3 uppercase tracking-wide border-b border-gray-100 pb-2">Filters</h4>

                {/* Shared Slider Thumb Styles */}
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

                {/* Polygon Search */}
                <div className="mb-4 pb-3 border-b border-gray-100">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Polygon Search</span>
                        <span className={`text-[10px] font-semibold ${hasPolygonFilter ? 'text-blue-700' : 'text-gray-400'}`}>
                            {hasPolygonFilter ? 'Active' : 'Off'}
                        </span>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={startPolygonDrawing}
                            className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
                                isDrawingPolygon
                                    ? 'bg-blue-600 text-white border-blue-700'
                                    : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
                            }`}
                        >
                            {isDrawingPolygon ? 'Drawing…' : 'Draw area'}
                        </button>

                        <button
                            type="button"
                            onClick={completePolygonDrawing}
                            disabled={!canCompletePolygon}
                            className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
                                canCompletePolygon
                                    ? 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200'
                                    : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                            }`}
                        >
                            Complete
                        </button>

                        <button
                            type="button"
                            onClick={clearPolygon}
                            disabled={polygonPoints.length === 0}
                            className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
                                polygonPoints.length > 0
                                    ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                    : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                            }`}
                        >
                            Clear
                        </button>
                    </div>

                    <div className="mt-2 text-[11px] text-gray-500">
                        {isDrawingPolygon
                            ? `Click on map to add points (${polygonPoints.length}).`
                            : hasPolygonFilter
                                ? isDraggingVertex
                                    ? 'Editing vertex… release mouse to apply.'
                                    : `Polygon locked (${polygonPoints.length} points). Drag points to adjust.`
                                : 'Start drawing to filter listings by area.'}
                    </div>
                </div>

                {/* Total Price Slider */}
                <div className="mb-4">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-semibold">
                        <span>Price (€)</span>
                        <span>{priceRange[0] >= 1000000 ? (priceRange[0] / 1000000).toFixed(1) + 'M' : Math.round(priceRange[0] / 1000) + 'k'} - {priceRange[1] >= 1000000 ? (priceRange[1] / 1000000).toFixed(1) + 'M' : Math.round(priceRange[1] / 1000) + 'k'}</span>
                    </div>

                    <div className="relative h-8 mt-2">
                        {/* Track Background */}
                        <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-200 rounded -translate-y-1/2"></div>

                        {/* Active Track */}
                        <div
                            className="absolute top-1/2 h-1 bg-green-400 rounded -translate-y-1/2"
                            style={{
                                left: `${maxPriceAvailable > minPriceAvailable ? ((priceRange[0] - minPriceAvailable) / (maxPriceAvailable - minPriceAvailable)) * 100 : 0}%`,
                                right: `${maxPriceAvailable > minPriceAvailable ? 100 - ((priceRange[1] - minPriceAvailable) / (maxPriceAvailable - minPriceAvailable)) * 100 : 0}%`
                            }}
                        ></div>

                        {/* Min Thumb */}
                        <input
                            type="range"
                            min={minPriceAvailable}
                            max={maxPriceAvailable}
                            step={10000}
                            value={priceRange[0]}
                            onChange={(e) => {
                                const val = Math.min(Number(e.target.value), priceRange[1] - 10000);
                                setPriceRange([val, priceRange[1]]);
                            }}
                            className="absolute top-0 left-0 w-full h-1 appearance-none bg-transparent pointer-events-none focus:outline-none z-20"
                        />

                        {/* Max Thumb */}
                        <input
                            type="range"
                            min={minPriceAvailable}
                            max={maxPriceAvailable}
                            step={10000}
                            value={priceRange[1]}
                            onChange={(e) => {
                                const val = Math.max(Number(e.target.value), priceRange[0] + 10000);
                                setPriceRange([priceRange[0], val]);
                            }}
                            className="absolute top-0 left-0 w-full h-1 appearance-none bg-transparent pointer-events-none focus:outline-none z-30"
                        />
                    </div>
                </div>

                {/* Timeline Slider */}
                <div className="mb-4">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-semibold">
                        <span>Timeline (from)</span>
                        <span>{formatShortDate(dateRange[0])} → {formatShortDate(maxDateAvailable)}</span>
                    </div>

                    <div className="relative h-8 mt-2">
                        {/* Track Background */}
                        <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-200 rounded -translate-y-1/2"></div>

                        {/* Active Track */}
                        <div
                            className="absolute top-1/2 h-1 bg-indigo-400 rounded -translate-y-1/2"
                            style={{
                                left: `${hasTimelineRange ? ((dateRange[0] - minDateAvailable) / timelineSpan) * 100 : 0}%`,
                                right: `${hasTimelineRange ? 0 : 100}%`
                            }}
                        ></div>

                        {/* Min Thumb */}
                        <input
                            type="range"
                            min={minDateAvailable}
                            max={maxDateAvailable}
                            step={DAY_MS}
                            value={dateRange[0]}
                            disabled={!hasTimelineRange}
                            onChange={(e) => {
                                if (!hasTimelineRange) return;
                                const rawValue = Number(e.target.value);
                                const value = Math.min(rawValue, maxDateAvailable - DAY_MS);
                                setDateRange([toDayStart(value), maxDateAvailable]);
                            }}
                            className="absolute top-0 left-0 w-full h-1 appearance-none bg-transparent pointer-events-none focus:outline-none z-20"
                        />
                    </div>
                </div>

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

                {/* Year Built Slider */}
                <div className="pt-2 border-t border-gray-100 mt-2">
                    <div className="flex justify-between text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-semibold">
                        <span>Year Built</span>
                        <span>{yearRange[0]} - {yearRange[1]}</span>
                    </div>

                    <div className="relative h-8 mt-2">
                        {/* Track Background */}
                        <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-200 rounded -translate-y-1/2"></div>

                        {/* Active Track */}
                        <div
                            className="absolute top-1/2 h-1 bg-blue-400 rounded -translate-y-1/2"
                            style={{
                                left: `${maxYearAvailable > minYearAvailable ? ((yearRange[0] - minYearAvailable) / (maxYearAvailable - minYearAvailable)) * 100 : 0}%`,
                                right: `${maxYearAvailable > minYearAvailable ? 100 - ((yearRange[1] - minYearAvailable) / (maxYearAvailable - minYearAvailable)) * 100 : 0}%`
                            }}
                        ></div>

                        {/* Min Thumb */}
                        <input
                            type="range"
                            min={minYearAvailable}
                            max={maxYearAvailable}
                            value={yearRange[0]}
                            onChange={(e) => {
                                const val = Math.min(Number(e.target.value), yearRange[1] - 1);
                                setYearRange([val, yearRange[1]]);
                            }}
                            className="absolute top-0 left-0 w-full h-1 appearance-none bg-transparent pointer-events-none focus:outline-none z-20"
                        />

                        {/* Max Thumb */}
                        <input
                            type="range"
                            min={minYearAvailable}
                            max={maxYearAvailable}
                            value={yearRange[1]}
                            onChange={(e) => {
                                const val = Math.max(Number(e.target.value), yearRange[0] + 1);
                                setYearRange([yearRange[0], val]);
                            }}
                            className="absolute top-0 left-0 w-full h-1 appearance-none bg-transparent pointer-events-none focus:outline-none z-30"
                        />
                    </div>
                </div>
            </div>
            <div className="absolute top-4 right-4 w-80 max-h-[88vh] overflow-y-auto bg-white/95 backdrop-blur rounded-lg shadow-lg border border-gray-200 z-10 p-3">
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Favorites</h4>
                        <span className="text-[11px] text-gray-500">{favoriteProperties.length}</span>
                    </div>
                    {favoriteProperties.length === 0 ? (
                        <p className="text-[11px] text-gray-500">Add favorites from map popups.</p>
                    ) : (
                        <div className="space-y-2">
                            {favoriteProperties.map((property) => (
                                <div key={`fav-${property.id}`} className="border border-amber-100 bg-amber-50/50 rounded p-2">
                                    <div className="text-xs font-semibold text-gray-800 line-clamp-2">{property.title}</div>
                                    <div className="text-[11px] text-gray-600 mt-0.5">
                                        {new Intl.NumberFormat('de-DE').format(property.price)} {property.currency}
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <a
                                            href={property.url}
                                            target="_blank"
                                            className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide hover:underline"
                                        >
                                            Open
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => removeFromFavorites(String(property.id))}
                                            className="text-[10px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Compare</h4>
                        <span className="text-[11px] text-gray-500">{compareProperties.length}/{MAX_COMPARE_ITEMS}</span>
                    </div>
                    {!compareReady ? (
                        <p className="text-[11px] text-gray-500">Add at least 2 properties to compare.</p>
                    ) : (
                        <div className="space-y-2">
                            {compareProperties.map((property) => {
                                const size = property.size_m2 || 0;
                                const ppm2 = size > 0 ? Math.round(property.price / size) : null;
                                return (
                                    <div key={`cmp-${property.id}`} className="border border-purple-100 bg-purple-50/40 rounded p-2">
                                        <div className="flex justify-between gap-2 items-start">
                                            <div className="text-xs font-semibold text-gray-800 line-clamp-2">{property.title}</div>
                                            <button
                                                type="button"
                                                onClick={() => removeFromCompare(String(property.id))}
                                                className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 shrink-0"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2 text-[11px] text-gray-700">
                                            <div>Price</div>
                                            <div className="font-medium text-right">{formatPriceShort(property.price)} {property.currency}</div>
                                            <div>Area</div>
                                            <div className="font-medium text-right">{size > 0 ? `${size} m²` : 'N/A'}</div>
                                            <div>€/m²</div>
                                            <div className="font-medium text-right">{ppm2 ? `${new Intl.NumberFormat('de-DE').format(ppm2)} €` : 'N/A'}</div>
                                            <div>Rooms</div>
                                            <div className="font-medium text-right">{property.rooms || '—'}</div>
                                            <div>Baths</div>
                                            <div className="font-medium text-right">{property.bathrooms || '—'}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
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
