"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import io, { Socket } from 'socket.io-client';
import { Search } from 'lucide-react';

interface TerminalViewerProps {
  serverId: number | null;
  logType: string | null;
  sourceId: string | null;
}

export default function TerminalViewer({ serverId, logType, sourceId }: TerminalViewerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  // Reset search when source changes
  useEffect(() => {
    setSearchTerm('');
    setActiveSearch('');
  }, [serverId, logType, sourceId]);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize terminal
    const term = new Terminal({
      theme: {
        background: '#0d0d0d', // Glassmorphic very dark
        foreground: '#e2e8f0',
        cursor: '#8b5cf6', // Vibrant purple cursor
      },
      fontFamily: 'monospace',
      fontSize: 14,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    // Add small delay to ensure DOM is ready for sizing
    setTimeout(() => fitAddon.fit(), 50);
    termInstance.current = term;

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!termInstance.current) return;
    const term = termInstance.current;

    // Connect WebSocket
    const socket = io({ path: '/socket.io' }); 
    socketRef.current = socket;

    socket.on('connect', () => {
      term.clear();
      term.writeln('\x1b[35m[INFO]\x1b[0m Connected to central log viewer backend.');
      
      if (serverId && logType && sourceId) {
        if (activeSearch) {
          term.writeln(`\x1b[35m[INFO]\x1b[0m Requesting strictly non-persistent live stream for: ${logType} -> ${sourceId} (Filtered by: ${activeSearch})`);
        } else {
          term.writeln(`\x1b[35m[INFO]\x1b[0m Requesting strictly non-persistent live stream for: ${logType} -> ${sourceId}`);
        }
        socket.emit('request_stream', { serverId, logType, sourceId, searchTerm: activeSearch });
      } else {
        term.writeln('\x1b[33m[WAITING]\x1b[0m Please select a server, log type, and specific source from the sidebar.');
      }
    });

    // Suppress Next.js dev overlays for internal xterm.js parsing warnings
    const originalConsoleError = console.error;
    console.error = (...args) => {
      if (args[0] && typeof args[0] === 'string' && args[0].includes('xterm.js: Parsing error')) {
        return; // Silently ignore terminal escape sequence parse errors
      }
      originalConsoleError.apply(console, args);
    };

    socket.on('terminal:data', (data: any) => {
      let safeData = data;
      if (typeof safeData !== 'string') {
        try {
           safeData = JSON.stringify(safeData);
        } catch (e) {
           safeData = String(safeData);
        }
      }
      term.write(safeData);
    });

    socket.on('disconnect', () => {
      term.writeln('\x1b[31m[DISCONNECTED]\x1b[0m Lost connection to server.');
    });

    return () => {
      console.error = originalConsoleError;
      if (socketRef.current) {
        socketRef.current.emit('disconnect_stream');
        socketRef.current.disconnect();
      }
    };
  }, [serverId, logType, sourceId, activeSearch]);

  return (
    <div className="w-full h-full p-4 bg-white/5 dark:bg-black/40 backdrop-blur-xl border border-white/10 dark:border-white/5 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
       <div className="flex items-center justify-between mb-3 w-full">
         <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <div className="w-3 h-3 rounded-full bg-green-400"></div>
            <span className="ml-2 text-xs font-semibold text-zinc-400 uppercase tracking-widest">
              Live Stream {sourceId ? `- ${sourceId}` : ''}
              {activeSearch ? ` (Search: ${activeSearch})` : ''}
            </span>
         </div>
         {sourceId && (
            <div className="flex items-center gap-2">
               <input 
                 type="text" 
                 value={searchTerm} 
                 onChange={e => setSearchTerm(e.target.value)}
                 onKeyDown={e => { if(e.key === 'Enter') setActiveSearch(searchTerm) }}
                 placeholder="Search log stream..." 
                 className="bg-black/40 border border-white/10 text-white text-xs rounded-lg px-3 py-1.5 outline-none focus:border-purple-500 transition-colors w-48 font-mono"
               />
               <button 
                 onClick={() => setActiveSearch(searchTerm)}
                 className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors flex items-center justify-center"
                 title="Search"
               >
                 <Search className="w-3.5 h-3.5 mr-1" /> Search
               </button>
            </div>
         )}
       </div>
       <div ref={terminalRef} className="flex-1 w-full h-full overflow-hidden" />
    </div>
  );
}
