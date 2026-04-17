"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import io, { Socket } from 'socket.io-client';
import { Search, Pause, Play, Trash2, Download, CheckCircle2, XCircle, Activity, X } from 'lucide-react';

interface TerminalViewerProps {
  serverId: number | null;
  logType: string | null;
  sourceId: string | null;
  isActiveSlot?: boolean;
  onSlotClick?: () => void;
}

export default function TerminalViewer({ serverId, logType, sourceId, isActiveSlot, onSlotClick }: TerminalViewerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [newWatchKeyword, setNewWatchKeyword] = useState('');
  const [alertCount, setAlertCount] = useState(0);
  const logBuffer = useRef<string>('');

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
      
      // LOG COLORIZATION & ALERTING
      const colorize = (text: string) => {
        let painted = text
          .replace(/(ERROR|FAIL|CRITICAL|FATAL|EXCEPTION)/gi, '\x1b[1;31m$1\x1b[0m')
          .replace(/(WARN|WARNING|ALERT)/gi, '\x1b[1;33m$1\x1b[0m')
          .replace(/(INFO|OK|SUCCESS)/gi, '\x1b[32m$1\x1b[0m')
          .replace(/(DEBUG)/gi, '\x1b[34m$1\x1b[0m');

        // Check Watchlist
        watchlist.forEach(word => {
          if (word && text.toLowerCase().includes(word.toLowerCase())) {
            // Intense highlight for watched words
            const regex = new RegExp(`(${word})`, 'gi');
            painted = painted.replace(regex, '\x1b[1;37;41m $1 \x1b[0m'); 
            setAlertCount(prev => prev + 1);
          }
        });
        
        return painted;
      };

      const finalData = colorize(safeData);

      if (isPaused) {
        logBuffer.current += finalData;
      } else {
        term.write(finalData);
      }
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
  }, [serverId, logType, sourceId, activeSearch, isPaused]);

  const downloadLogs = () => {
    if (!termInstance.current) return;
    // Extract all lines from the terminal buffer
    const buffer = termInstance.current.buffer.active;
    let content = '';
    for (let i = 0; i < buffer.length; i++) {
        content += buffer.getLine(i)?.translateToString() + '\n';
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulselog_${sourceId || 'extract'}_${new Date().getTime()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div 
      onClick={onSlotClick}
      className={`w-full h-full p-4 bg-white/5 dark:bg-black/40 backdrop-blur-xl border-2 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 cursor-default ${
        isActiveSlot 
          ? 'border-purple-500/50 ring-4 ring-purple-500/10' 
          : 'border-white/10 dark:border-white/5 opacity-80'
      }`}
    >
       <div className="flex items-center justify-between mb-3 w-full">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-400"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <div className="w-3 h-3 rounded-full bg-green-400"></div>
            <span className="ml-2 text-xs font-semibold text-zinc-400 uppercase tracking-widest flex items-center">
              Live Stream {sourceId ? `- ${sourceId}` : ''}
              {alertCount > 0 && (
                <span className="ml-3 px-2 py-0.5 bg-red-500/20 text-red-500 text-[10px] rounded-full border border-red-500/30 animate-pulse flex items-center gap-1">
                   <Activity className="w-3 h-3" /> {alertCount} Watch Matches
                </span>
              )}
            </span>
          </div>
          {sourceId && (
            <div className="flex items-center gap-2">
               {/* Watchlist Section */}
               <div className="flex items-center bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 focus-within:border-purple-500 transition-all">
                  <Activity className="w-3.5 h-3.5 text-purple-500 mr-2" />
                  <input 
                    type="text" 
                    value={newWatchKeyword}
                    onChange={e => setNewWatchKeyword(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newWatchKeyword) {
                        setWatchlist([...watchlist, newWatchKeyword.toLowerCase()]);
                        setNewWatchKeyword('');
                      }
                    }}
                    placeholder="Watch..." 
                    className="bg-transparent text-white text-xs outline-none w-16 placeholder:text-zinc-600 transition-all focus:w-28"
                  />
                  {watchlist.length > 0 && (
                    <div className="flex items-center gap-1 ml-2 pl-2 border-l border-white/10">
                      {watchlist.map(w => (
                        <span key={w} className="flex items-center bg-purple-500/20 text-purple-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-purple-500/30">
                          {w}
                          <X className="w-2.5 h-2.5 ml-1 cursor-pointer hover:text-white" onClick={() => setWatchlist(watchlist.filter(x => x !== w))} />
                        </span>
                      ))}
                    </div>
                  )}
               </div>

               <div className="w-[1px] h-4 bg-white/10 mx-1"></div>

               <input 
                 type="text" 
                 value={searchTerm} 
                 onChange={e => setSearchTerm(e.target.value)}
                 onKeyDown={e => { if(e.key === 'Enter') setActiveSearch(searchTerm) }}
                 placeholder="Search logs..." 
                 className="bg-black/40 border border-white/10 text-white text-xs rounded-xl px-3 py-1.5 outline-none focus:border-purple-500 transition-colors w-32 font-mono"
               />
                <button 
                  onClick={() => setActiveSearch(searchTerm)}
                  className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-xl px-3 py-1.5 transition-colors flex items-center justify-center"
                  title="Search"
                >
                  <Search className="w-3.5 h-3.5 mr-1" /> Search
                </button>

                <div className="w-[1px] h-4 bg-white/10 mx-1"></div>

                <div className="flex items-center bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <button 
                    onClick={downloadLogs}
                    className="p-2 hover:bg-white/10 text-zinc-400 hover:text-blue-400 transition-all border-r border-white/10"
                    title="Download Logs"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <button 
                    onClick={() => {
                      if (isPaused) {
                        if (socketRef.current && serverId && logType && sourceId) {
                          socketRef.current.emit('request_stream', { serverId, logType, sourceId, searchTerm: activeSearch });
                          if (termInstance.current) {
                            termInstance.current.writeln('\x1b[32m\n[STREAM RESUMED]\x1b[0m Starting fresh tail...');
                          }
                        }
                        setIsPaused(false);
                      } else {
                        if (socketRef.current) {
                          socketRef.current.emit('disconnect_stream');
                        }
                        setIsPaused(true);
                        if (termInstance.current) {
                          termInstance.current.writeln('\x1b[33m\n[STREAM STOPPED]\x1b[0m Output frozen.');
                        }
                      }
                    }}
                    className={`p-2 transition-all border-r border-white/10 ${
                      isPaused ? 'text-green-400 hover:bg-green-500/10' : 'text-red-400 hover:bg-red-500/10'
                    }`}
                    title={isPaused ? "Play" : "Stop"}
                  >
                    {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
                  </button>

                  <button 
                    onClick={() => {
                      termInstance.current?.clear();
                      setAlertCount(0);
                    }}
                    className="p-2 hover:bg-white/10 text-zinc-400 hover:text-red-400 transition-all"
                    title="Clear Terminal"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
            </div>
          )}
        </div>
       <div ref={terminalRef} className="flex-1 w-full h-full overflow-hidden" />
    </div>
  );
}
