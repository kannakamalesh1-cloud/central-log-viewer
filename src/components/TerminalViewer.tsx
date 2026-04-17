"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import io, { Socket } from 'socket.io-client';
import { Search, Pause, Play, Trash2, Download, CheckCircle2, XCircle, Activity, X, ExternalLink } from 'lucide-react';

interface TerminalViewerProps {
  serverId: number | null;
  logType: string | null;
  sourceId: string | null;
  isActiveSlot?: boolean;
  onSlotClick?: () => void;
  onClose?: () => void;
  onStatusChange?: (status: 'running' | 'dying' | 'stopped') => void;
}

export default function TerminalViewer({ serverId, logType, sourceId, isActiveSlot, onSlotClick, onClose, onStatusChange }: TerminalViewerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [newWatchKeyword, setNewWatchKeyword] = useState('');
  const [alertCount, setAlertCount] = useState(0);
  const logBuffer = useRef<string>('');
  const watchlistRef = useRef<string[]>([]);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  useEffect(() => {
    setSearchTerm('');
    setActiveSearch('');
    setIsPaused(false);
    setWatchlist([]);
    setAlertCount(0);
    logBuffer.current = '';
    if (onStatusChange) onStatusChange('stopped');
  }, [serverId, logType, sourceId]);

  // Sync pause button with header pulse
  useEffect(() => {
    if (onStatusChange) {
      if (serverId && sourceId && !isPaused) {
        onStatusChange('running');
      }
      // Note: 'dying' → 'stopped' transition is handled inline in the pause button click
    }
  }, [isPaused, serverId, sourceId]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0d0d0d',
        foreground: '#e2e8f0',
        cursor: '#8b5cf6',
      },
      fontFamily: 'monospace',
      fontSize: 14,
      convertEol: true,
      cursorInactiveStyle: 'outline',
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    setTimeout(() => { if (fitAddonRef.current) fitAddonRef.current.fit(); }, 50);
    termInstance.current = term;

    const handleResize = () => { if (fitAddonRef.current) fitAddonRef.current.fit(); };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!termInstance.current) return;
    const term = termInstance.current;
    term.reset(); 
    term.clear();

    const socket = io({ path: '/socket.io' }); 
    socketRef.current = socket;

    socket.on('connect', () => {
      term.writeln('\x1b[35m[INFO]\x1b[0m CONNECTED_TO_STREAMING_NODE...');
      if (serverId && logType && sourceId) {
        socket.emit('request_stream', { serverId, logType, sourceId, searchTerm: activeSearch });
      }
    });

    socket.on('terminal:data', (data: any) => {
      let safeData = data;
      if (typeof safeData !== 'string') {
        try { safeData = JSON.stringify(safeData); } catch (e) { safeData = String(safeData); }
      }
      
      const colorize = (text: string) => {
        let painted = text
          .replace(/(ERROR|FAIL|CRITICAL|FATAL|EXCEPTION)/gi, '\x1b[1;31m$1\x1b[0m')
          .replace(/(WARN|WARNING|ALERT)/gi, '\x1b[1;33m$1\x1b[0m')
          .replace(/(INFO|OK|SUCCESS)/gi, '\x1b[32m$1\x1b[0m');

        watchlistRef.current.forEach(word => {
          if (word && text.toLowerCase().includes(word.toLowerCase())) {
            const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            painted = painted.replace(regex, '\x1b[1;37;41m $1 \x1b[0m'); 
            setAlertCount(prev => prev + 1);
          }
        });
        return painted;
      };

      const finalData = colorize(safeData);
      if (isPausedRef.current) logBuffer.current += finalData;
      else term.write(finalData);
    });

    socket.on('disconnect', () => {
      term.writeln('\x1b[31m[OFFLINE]\x1b[0m Lost connection.');
      if (onStatusChange) onStatusChange('stopped');
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('disconnect_stream');
        socketRef.current.disconnect();
      }
    };
  }, [serverId, logType, sourceId, activeSearch]);

  const downloadLogs = () => {
    if (!termInstance.current) return;
    const buffer = termInstance.current.buffer.active;
    let content = '';
    for (let i = 0; i < buffer.length; i++) content += buffer.getLine(i)?.translateToString() + '\n';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulselog_${sourceId || 'extract'}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onSlotClick}
      className={`w-full h-full p-4 bg-white/5 dark:bg-[#080808] backdrop-blur-3xl border-2 rounded-[32px] shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col transition-all duration-300 cursor-default overscroll-none select-none ${isActiveSlot
        ? 'border-purple-500/50 ring-8 ring-purple-500/5'
        : 'border-white/10 dark:border-white/5 opacity-90'
        }`}
    >
      <div className="flex items-center justify-between mb-4 w-full px-2">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.4)]"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/80 shadow-[0_0_8px_rgba(234,179,8,0.4)]"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/80 shadow-[0_0_8px_rgba(34,197,94,0.4)]"></div>
          </div>
          <span className="ml-3 text-[11px] font-black text-zinc-400 uppercase tracking-[0.2em] flex items-center">
            LIVE_STREAM_NODE :: {sourceId?.toUpperCase() || 'SEARCHING...'}
            {alertCount > 0 && (
              <span className="ml-4 text-red-500 font-bold animate-pulse">[{alertCount}_FLAGS]</span>
            )}
          </span>
        </div>
        
        {sourceId && (
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-black/60 border border-white/10 rounded-2xl px-3 py-2 focus-within:border-purple-500/50 transition-all">
              <Activity className="w-3.5 h-3.5 text-purple-500 mr-2" />
              <input
                type="text"
                value={newWatchKeyword}
                onChange={e => setNewWatchKeyword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newWatchKeyword) {
                    if (!watchlist.includes(newWatchKeyword.toLowerCase())) {
                       setWatchlist([...watchlist, newWatchKeyword.toLowerCase()]);
                    }
                    setNewWatchKeyword('');
                  }
                }}
                placeholder="WATCH"
                className="bg-transparent text-white text-[10px] font-black outline-none w-16 placeholder:text-zinc-700 transition-all focus:w-24 uppercase"
              />
              {watchlist.length > 0 && (
                <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10">
                  {watchlist.map(w => (
                    <span key={w} className="flex items-center bg-purple-500/20 text-purple-400 text-[9px] font-black px-1.5 py-0.5 rounded border border-purple-500/30">
                      {w.toUpperCase()}
                      <X className="w-2.5 h-2.5 ml-1 cursor-pointer hover:text-white" onClick={() => setWatchlist(watchlist.filter(x => x !== w))} />
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center bg-black/60 border border-white/10 rounded-2xl px-3 py-2 focus-within:border-cyan-500/50 transition-all">
               <Search className="w-3.5 h-3.5 text-cyan-500 mr-2" />
               <input 
                 type="text"
                 value={searchTerm}
                 onChange={e => setSearchTerm(e.target.value)}
                 onKeyDown={e => {
                   if (e.key === 'Enter') setActiveSearch(searchTerm);
                 }}
                 placeholder="SEARCH"
                 className="bg-transparent text-white text-[10px] font-black outline-none w-16 placeholder:text-zinc-700 transition-all focus:w-24 uppercase"
               />
            </div>

            <div className="flex items-center bg-white/5 border border-white/10 rounded-2xl overflow-hidden p-1 shadow-inner">
              <button onClick={downloadLogs} className="p-2.5 hover:bg-white/5 text-zinc-500 hover:text-cyan-400 border-r border-white/5 transition-all" title="Download Telemetry"><Download className="w-4 h-4" /></button>
              <button onClick={() => {
                if (isPaused) {
                  // RESUME
                  if (termInstance.current && logBuffer.current) {
                    termInstance.current.write(logBuffer.current);
                    logBuffer.current = '';
                  }
                  setIsPaused(false);
                  if (onStatusChange) onStatusChange('running');
                } else {
                  // PAUSE: trigger dying animation first, then go stopped
                  setIsPaused(true);
                  if (onStatusChange) {
                    onStatusChange('dying');
                    setTimeout(() => onStatusChange!('stopped'), 2500);
                  }
                }
              }} className={`p-2.5 transition-all border-r border-white/5 ${isPaused ? 'text-green-500' : 'text-zinc-500 hover:text-red-400'}`}>{isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}</button>
              <button 
                onClick={() => { termInstance.current?.clear(); setAlertCount(0); }} 
                className="p-2.5 hover:bg-white/5 text-zinc-500 hover:text-red-500 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      <div 
        ref={terminalRef} 
        className="flex-1 w-full h-full overflow-hidden select-text pb-10 cursor-text" 
      />
    </div>
  );
}
