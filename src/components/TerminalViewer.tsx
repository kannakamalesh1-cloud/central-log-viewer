"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { io, Socket } from 'socket.io-client';
import { Search, Pause, Play, Trash2, Download, Activity, X } from 'lucide-react';

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
  const terminalRef  = useRef<HTMLDivElement>(null);
  const socketRef    = useRef<Socket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef  = useRef<FitAddon | null>(null);

  const [searchTerm, setSearchTerm]           = useState('');
  const [activeSearch, setActiveSearch]       = useState('');
  const [isRegex, setIsRegex]                 = useState(false);
  const [isPaused, setIsPaused]               = useState(false);
  const [watchlist, setWatchlist]             = useState<string[]>([]);
  const [newWatchKeyword, setNewWatchKeyword] = useState('');
  const [alertCount, setAlertCount]           = useState(0);
  const [fontSize, setFontSize]               = useState(13);
  const [isDimmed, setIsDimmed]               = useState(false);
  const [errorSpike, setErrorSpike]           = useState(false);
  const [errorSpikeCount, setErrorSpikeCount] = useState(0);

  const logBuffer        = useRef<string>('');
  const watchlistRef     = useRef<string[]>([]);
  const errorTimestamps  = useRef<number[]>([]);
  const errorSpikeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { watchlistRef.current = watchlist; }, [watchlist]);

  // Reset on source change
  useEffect(() => {
    setSearchTerm(''); setActiveSearch(''); setIsRegex(false);
    setIsPaused(false); setWatchlist([]); setAlertCount(0);
    setErrorSpike(false); errorTimestamps.current = [];
    logBuffer.current = '';
    if (onStatusChange) onStatusChange('stopped');
  }, [serverId, logType, sourceId]);

  // Sync pause with header heartbeat
  useEffect(() => {
    if (onStatusChange && serverId && sourceId && !isPaused) onStatusChange('running');
  }, [isPaused, serverId, sourceId]);

  // Terminal init
  useEffect(() => {
    if (!terminalRef.current) return;
    const term = new Terminal({
      theme: { background: '#0d0d0d', foreground: '#e2e8f0', cursor: '#8b5cf6' },
      fontFamily: 'monospace',
      fontSize,
      convertEol: true,
      cursorInactiveStyle: 'outline',
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    setTimeout(() => fitAddonRef.current?.fit(), 50);
    termInstance.current = term;
    const onResize = () => fitAddonRef.current?.fit();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); term.dispose(); };
  }, []);

  // Font size
  useEffect(() => {
    if (!termInstance.current) return;
    (termInstance.current.options as any).fontSize = fontSize;
    fitAddonRef.current?.fit();
  }, [fontSize]);

  // Dim mode
  useEffect(() => {
    if (!termInstance.current) return;
    termInstance.current.options.theme = {
      background: isDimmed ? '#020202' : '#0d0d0d',
      foreground: isDimmed ? '#94a3b8' : '#e2e8f0',
      cursor: '#8b5cf6',
    };
  }, [isDimmed]);

  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // WebSocket
  useEffect(() => {
    if (!termInstance.current) return;
    const term = termInstance.current;
    term.reset(); term.clear();
    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => {
      term.writeln('\x1b[35m[INFO]\x1b[0m CONNECTED_TO_STREAMING_NODE...');
      if (serverId && logType && sourceId)
        socket.emit('request_stream', { serverId, logType, sourceId, searchTerm: activeSearch, isRegex });
    });

    socket.on('terminal:data', (data: any) => {
      let safeData = data;
      if (typeof safeData !== 'string') {
        try { safeData = JSON.stringify(safeData); } catch { safeData = String(safeData); }
      }

      // Error spike detection
      const errMatches = safeData.match(/(ERROR|FAIL|CRITICAL|FATAL|EXCEPTION)/gi);
      if (errMatches) {
        const now = Date.now();
        errorTimestamps.current.push(now);
        errorTimestamps.current = errorTimestamps.current.filter(t => now - t < 10000);
        if (errorTimestamps.current.length >= 3) {
          setErrorSpikeCount(errorTimestamps.current.length);
          setErrorSpike(true);
          if (errorSpikeTimer.current) clearTimeout(errorSpikeTimer.current);
          errorSpikeTimer.current = setTimeout(() => setErrorSpike(false), 6000);
        }
      }

      const colorize = (text: string) => {
        let p = text
          .replace(/(ERROR|FAIL|CRITICAL|FATAL|EXCEPTION)/gi, '\x1b[1;31m$1\x1b[0m')
          .replace(/(WARN|WARNING|ALERT)/gi, '\x1b[1;33m$1\x1b[0m')
          .replace(/(INFO|OK|SUCCESS)/gi, '\x1b[32m$1\x1b[0m');
        watchlistRef.current.forEach(word => {
          if (word && text.toLowerCase().includes(word.toLowerCase())) {
            const rx = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            p = p.replace(rx, '\x1b[1;37;41m $1 \x1b[0m');
            setAlertCount(prev => prev + 1);
          }
        });
        return p;
      };

      // Ensure all literal escapes are converted to actual control chars
      const cleanData = safeData
        .replace(/\\x1b/g, '\x1b')
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n');

      const finalData = colorize(cleanData);
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
  }, [serverId, logType, sourceId, activeSearch, isRegex]);

  const downloadLogs = () => {
    if (!termInstance.current) return;
    const buffer = termInstance.current.buffer.active;
    let content = `PulseLog Export — ${sourceId} — ${new Date().toISOString()}\n${'─'.repeat(60)}\n\n`;
    for (let i = 0; i < buffer.length; i++) content += buffer.getLine(i)?.translateToString() + '\n';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pulselog_${sourceId || 'export'}.log`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onSlotClick}
      className={`w-full h-full p-4 bg-[#080808] border-2 rounded-[32px] shadow-[0_24px_80px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col transition-all duration-300 cursor-default overscroll-none select-none ${
        isActiveSlot ? 'border-purple-500/50 ring-8 ring-purple-500/5' : 'border-white/10 opacity-90'
      }`}
    >
      {/* Error Spike Banner */}
      {errorSpike && (
        <div className="mb-2 px-4 py-2 bg-red-500/10 border border-red-500/25 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-ping flex-shrink-0" />
            <span className="text-red-400 text-[10px] font-black uppercase tracking-widest">
              ⚠ Error Spike — {errorSpikeCount} errors in last 10s
            </span>
          </div>
          <button onClick={() => setErrorSpike(false)} className="text-zinc-700 hover:text-red-400 transition-colors ml-4">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Single Header Row ─────────────────────────────────────── */}
      <div className="flex items-center w-full px-1 mb-3 gap-3">
        {/* Dots + Name */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          </div>
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.15em] max-w-[180px] truncate">
            {sourceId?.split('/').pop()?.toUpperCase() || 'NO_SOURCE'}
          </span>
          {alertCount > 0 && (
            <span className="text-red-500 text-[9px] font-bold animate-pulse flex-shrink-0">[{alertCount}]</span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Watch */}
        <div className="flex items-center bg-black/60 border border-white/10 rounded-xl px-2.5 py-1.5 focus-within:border-purple-500/50 transition-all flex-shrink-0">
          <Activity className="w-3 h-3 text-purple-500 mr-1.5 flex-shrink-0" />
          <input
            type="text" value={newWatchKeyword}
            onChange={e => setNewWatchKeyword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newWatchKeyword) {
                if (!watchlist.includes(newWatchKeyword.toLowerCase()))
                  setWatchlist([...watchlist, newWatchKeyword.toLowerCase()]);
                setNewWatchKeyword('');
              }
            }}
            placeholder="Watch"
            className="bg-transparent text-white text-[10px] font-black outline-none w-12 placeholder:text-zinc-700"
          />
          {watchlist.length > 0 && (
            <div className="flex items-center gap-1 ml-1.5 pl-1.5 border-l border-white/10">
              {watchlist.map(w => (
                <span key={w} className="flex items-center bg-purple-500/20 text-purple-400 text-[9px] font-black px-1.5 py-0.5 rounded border border-purple-500/30">
                  {w.toUpperCase()}
                  <X className="w-2 h-2 ml-1 cursor-pointer hover:text-white" onClick={() => setWatchlist(watchlist.filter(x => x !== w))} />
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="flex items-center bg-black/60 border border-white/10 rounded-xl px-2.5 py-1.5 focus-within:border-cyan-500/50 transition-all flex-shrink-0">
          <Search className="w-3 h-3 text-cyan-500 mr-1.5 flex-shrink-0" />
          <input
            type="text" value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setActiveSearch(searchTerm); }}
            placeholder="Search"
            className="bg-transparent text-white text-[10px] font-black outline-none w-14 placeholder:text-zinc-700"
          />
          <button
            onClick={() => setIsRegex(r => !r)}
            className={`ml-1.5 text-[9px] font-black px-1 py-0.5 rounded border transition-all ${
              isRegex ? 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10' : 'text-zinc-700 border-white/5'
            }`}
          >.*</button>
          <button onClick={() => setActiveSearch(searchTerm)} className="ml-1 text-[10px] font-black text-zinc-600 hover:text-white transition-colors">Go</button>
        </div>

        {/* Utility buttons */}
        <div className="flex items-center bg-white/5 border border-white/10 rounded-xl overflow-hidden flex-shrink-0">
          <button onClick={() => setFontSize(s => Math.max(10, s - 1))} className="px-2 py-2 text-[10px] font-black text-zinc-600 hover:text-white hover:bg-white/5 border-r border-white/5 transition-all">A-</button>
          <button onClick={() => setFontSize(s => Math.min(20, s + 1))} className="px-2 py-2 text-[10px] font-black text-zinc-600 hover:text-white hover:bg-white/5 border-r border-white/5 transition-all">A+</button>
          <button
            onClick={() => setIsDimmed(d => !d)}
            className={`px-2 py-2 text-xs border-r border-white/5 transition-all ${isDimmed ? 'text-violet-400 bg-violet-500/10' : 'text-zinc-600 hover:text-white hover:bg-white/5'}`}
          >◐</button>
          <button onClick={downloadLogs} className="p-2 hover:bg-white/5 text-zinc-500 hover:text-cyan-400 border-r border-white/5 transition-all">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (isPaused) {
                if (termInstance.current && logBuffer.current) { termInstance.current.write(logBuffer.current); logBuffer.current = ''; }
                setIsPaused(false);
                if (onStatusChange) onStatusChange('running');
              } else {
                setIsPaused(true);
                if (onStatusChange) { onStatusChange('dying'); setTimeout(() => onStatusChange!('stopped'), 2500); }
              }
            }}
            className={`p-2 transition-all border-r border-white/5 ${isPaused ? 'text-green-500' : 'text-zinc-500 hover:text-red-400'}`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => { termInstance.current?.clear(); setAlertCount(0); }}
            className="p-2 hover:bg-white/5 text-zinc-500 hover:text-red-500 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 w-full h-full overflow-hidden select-text pb-10 cursor-text" />
    </div>
  );
}
