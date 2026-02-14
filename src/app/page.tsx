"use client";

import dynamic from 'next/dynamic';

const Map = dynamic(() => import('@/components/Map'), {
    ssr: false,
    loading: () => <div className="w-full h-screen bg-gray-100 flex items-center justify-center text-gray-400">Loading Map...</div>
});

export default function Home() {
    return (
        <main className="flex min-h-screen flex-col">
            <div className="flex-1 w-full relative">
                <Map />
            </div>
        </main>
    );
}
