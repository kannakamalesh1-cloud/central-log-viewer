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
      theme: {
        background:   '#ffffff',
        foreground:   '#1e293b',
        cursor:       '#0ea5e9',
        cursorAccent: '#ffffff',
        selectionBackground: 'rgba(14,165,233,0.2)',
        // Override ANSI green -> sky blue (used for INFO/OK/SUCCESS)
        green:        '#0284c7',
        brightGreen:  '#0ea5e9',
        // Keep red for errors
        red:          '#dc2626',
        brightRed:    '#ef4444',
        // Amber for warnings
        yellow:       '#b45309',
        brightYellow: '#d97706',
        // Cyan for info messages
        cyan:         '#0369a1',
        brightCyan:   '#0284c7',
        // Default black/white
        black:        '#1e293b',
        white:        '#334155',
        brightBlack:  '#64748b',
        brightWhite:  '#0f172a',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize,
      convertEol: true,
      cursorInactiveStyle: 'outline',
    });
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    // Delay fit so flexbox has time to compute dimensions
    const t1 = setTimeout(() => fitAddonRef.current?.fit(), 100);
    const t2 = setTimeout(() => fitAddonRef.current?.fit(), 400);

    termInstance.current = term;

    const onResize = () => fitAddonRef.current?.fit();
    window.addEventListener('resize', onResize);

    // ResizeObserver: refit whenever the container changes size
    const ro = new ResizeObserver(() => fitAddonRef.current?.fit());
    if (terminalRef.current) ro.observe(terminalRef.current);

    return () => {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      term.dispose();
    };
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
      background:   isDimmed ? '#f1f5f9' : '#ffffff',
      foreground:   isDimmed ? '#64748b' : '#1e293b',
      cursor:       '#0ea5e9',
      selectionBackground: 'rgba(14,165,233,0.15)',
      green:        isDimmed ? '#38bdf8' : '#0284c7',
      brightGreen:  '#0ea5e9',
      red:          '#dc2626',
      brightRed:    '#ef4444',
      yellow:       '#b45309',
      brightYellow: '#d97706',
      cyan:         '#0369a1',
      brightCyan:   '#0284c7',
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
      term.writeln('\x1b[36m[INFO]\x1b[0m CONNECTED_TO_STREAMING_NODE...');
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

      const cleanData = safeData
        .replace(/\\x1b/g, '\x1b')
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n');

      const finalData = colorize(cleanData);
      if (isPausedRef.current) logBuffer.current += finalData;
      else term.write(finalData);
    });

    // AUTO-RECONNECT ON DOCKER START
    socket.on('docker_event', (event: any) => {
      if (event.action === 'start' && logType === 'docker' && sourceId) {
        // Strip suffixes if present in sourceId
        const cleanSourceId = sourceId.split('|')[0].split(':')[0];
        if (event.name === cleanSourceId || event.id.startsWith(cleanSourceId)) {
          term.writeln('\r\n\x1b[32m[SYSTEM] Container start detected. Re-hooking stream...\x1b[0m');
          socket.emit('request_stream', { serverId, logType, sourceId, searchTerm: activeSearch, isRegex });
          if (onStatusChange) onStatusChange('running');
        }
      }
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
      className={`w-full h-full flex flex-col bg-white rounded-3xl overflow-hidden transition-all duration-300 cursor-default overscroll-none select-none ${
        isActiveSlot
          ? 'border-2 border-sky-400 shadow-[0_8px_40px_rgba(56,189,248,0.18)]'
          : 'border border-slate-200 shadow-lg'
      }`}
      style={{ minHeight: 0 }}
    >
      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="flex items-center w-full px-4 py-2.5 gap-3 bg-white border-b border-slate-100 flex-shrink-0 flex-wrap">

        {/* Traffic dots + source name */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <span className="text-[11px] font-black text-slate-600 uppercase tracking-[0.18em] max-w-[180px] truncate">
            {sourceId?.split('/').pop()?.toUpperCase() || 'NO_SOURCE'}
          </span>
          {alertCount > 0 && (
            <span className="text-red-500 text-[9px] font-bold animate-pulse flex-shrink-0 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
              ⚠ {alertCount}
            </span>
          )}
        </div>

        {/* Error Spike inline banner */}
        {errorSpike && (
          <div className="flex items-center gap-2 px-3 py-1 bg-red-50 border border-red-200 rounded-xl flex-shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping flex-shrink-0" />
            <span className="text-red-600 text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
              Error Spike — {errorSpikeCount} in 10s
            </span>
            <button onClick={() => setErrorSpike(false)} className="text-red-300 hover:text-red-500 transition-colors ml-1">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Watch input */}
        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/10 transition-all flex-shrink-0 gap-1.5">
          <Activity className="w-3 h-3 text-sky-500 flex-shrink-0" />
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
            className="bg-transparent text-slate-700 text-[10px] font-bold outline-none w-12 placeholder:text-slate-400"
          />
          {watchlist.length > 0 && (
            <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-slate-200">
              {watchlist.map(w => (
                <span key={w} className="flex items-center bg-sky-500/15 text-sky-700 text-[9px] font-black px-1.5 py-0.5 rounded-lg border border-sky-400/30">
                  {w.toUpperCase()}
                  <X className="w-2 h-2 ml-1 cursor-pointer hover:text-sky-900" onClick={() => setWatchlist(watchlist.filter(x => x !== w))} />
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Search input */}
        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/10 transition-all flex-shrink-0 gap-1.5">
          <Search className="w-3 h-3 text-sky-500 flex-shrink-0" />
          <input
            type="text" value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setActiveSearch(searchTerm); }}
            placeholder="Search"
            className="bg-transparent text-slate-700 text-[10px] font-bold outline-none w-14 placeholder:text-slate-400"
          />
          <button
            onClick={() => setIsRegex(r => !r)}
            className={`text-[9px] font-black px-1.5 py-0.5 rounded-lg border transition-all ${
              isRegex
                ? 'text-amber-600 border-amber-400/50 bg-amber-50'
                : 'text-slate-400 border-slate-200 hover:border-slate-300'
            }`}
          >.*</button>
          <button
            onClick={() => setActiveSearch(searchTerm)}
            className="text-[10px] font-black text-slate-400 hover:text-sky-600 transition-colors ml-0.5"
          >Go</button>
        </div>

        {/* Utility button group */}
        <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden flex-shrink-0 bg-slate-50 divide-x divide-slate-200">
          <button
            onClick={() => setFontSize(s => Math.max(10, s - 1))}
            className="px-2.5 py-2 text-[10px] font-black text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
          >A-</button>
          <button
            onClick={() => setFontSize(s => Math.min(20, s + 1))}
            className="px-2.5 py-2 text-[10px] font-black text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
          >A+</button>
          <button
            onClick={() => setIsDimmed(d => !d)}
            title="Dim mode"
            className={`px-2.5 py-2 text-xs transition-all ${
              isDimmed
                ? 'text-sky-600 bg-sky-50'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
            }`}
          >◐</button>
          <button
            onClick={downloadLogs}
            title="Download logs"
            className="p-2 text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all"
          >
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
            title={isPaused ? 'Resume stream' : 'Pause stream'}
            className={`p-2 transition-all ${isPaused ? 'text-emerald-500 bg-emerald-50' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'}`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => { termInstance.current?.clear(); setAlertCount(0); }}
            title="Clear terminal"
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal — dark background for log readability */}
      <div ref={terminalRef} className="flex-1 min-h-0 w-full overflow-hidden select-text cursor-text" />
    </div>
  );
}
