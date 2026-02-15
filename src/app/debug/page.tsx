"use client";

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function DebugPage() {
    const [logs, setLogs] = useState<any[]>([]);

    useEffect(() => {
        const fetchLogs = async () => {
            // Fetch the last 5 logs
            const { data, error } = await supabase
                .from('debug_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            if (error) {
                console.error("Error fetching logs:", error);
            } else {
                setLogs(data || []);
            }
        };

        fetchLogs();
    }, []);

    return (
        <div className="p-4 bg-gray-900 text-white min-h-screen font-mono text-xs overflow-auto">
            <h1 className="text-xl font-bold mb-4 text-green-400">Debug Logs (Latest 5)</h1>
            {logs.map((log) => (
                <div key={log.id} className="mb-8 border border-gray-700 p-4 rounded">
                    <div className="text-gray-400 mb-2">
                        {new Date(log.created_at).toLocaleString()} | {log.event_type}
                    </div>
                    <pre className="whitespace-pre-wrap bg-black p-2 rounded text-green-300">
                        {JSON.stringify(log.payload, null, 2)}
                    </pre>
                </div>
            ))}
        </div>
    );
}
