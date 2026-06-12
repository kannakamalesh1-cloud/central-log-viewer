"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { io, Socket } from 'socket.io-client';
import { Search, Pause, Play, Trash2, Download, Activity, X, ExternalLink, Sparkles, Loader2 } from 'lucide-react';

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

  // Gemini state variables
  const [isAnalyzing, setIsAnalyzing]           = useState(false);
  const [analysisReport, setAnalysisReport]     = useState<string | null>(null);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);

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

  // Automatically update search after 400ms of typing inactivity
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      setActiveSearch(searchTerm);
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchTerm]);

  // Sync pause with header heartbeat
  useEffect(() => {
    if (onStatusChange && serverId && sourceId && !isPaused) onStatusChange('running');
  }, [isPaused, serverId, sourceId]);

  const handleAnalyzeSpike = async () => {
    if (!termInstance.current) return;
    
    // Extract recent logs from the active terminal buffer (last 150 lines)
    const buffer = termInstance.current.buffer.active;
    const lines: string[] = [];
    const startLine = Math.max(0, buffer.length - 150);
    for (let i = startLine; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString());
      }
    }
    const recentLogs = lines.join('\n');

    setIsAnalyzing(true);
    setAnalysisReport(null);
    setShowAnalysisModal(true);

    try {
      const res = await fetch('/api/analyze-error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ logs: recentLogs }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to analyze logs');
      }

      const data = await res.json();
      setAnalysisReport(data.report);
    } catch (err: any) {
      setAnalysisReport(`### ❌ Analysis Failed\n\nUnable to generate report: ${err.message || 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };


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

    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'v')) {
        return false;
      }
      return true;
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

  const downloadReportMarkdown = () => {
    if (!analysisReport) return;
    const content = `---
title: PulseLog AI Diagnostic Report
server: ${sourceId || 'Unknown'}
date: ${new Date().toLocaleString()}
---

${analysisReport}`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulselog_diagnostic_${sourceId || 'report'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadReportPDF = () => {
    if (!analysisReport) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const reportHtml = document.querySelector('.analysis-report-container')?.innerHTML || '';
    
    const htmlContent = `
      <html>
        <head>
          <title>PulseLog AI Diagnostic Report</title>
          <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
          <style>
            body { 
              font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
              padding: 40px; 
              color: #1e293b; 
              background-color: #ffffff;
            }
            .header-bar {
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 16px;
              margin-bottom: 24px;
              display: flex;
              align-items: center;
              justify-content: space-between;
            }
            .logo-text {
              font-size: 1.5rem;
              font-weight: 900;
              color: #4f46e5;
              letter-spacing: -0.025em;
            }
            .meta-text {
              font-size: 0.75rem;
              color: #64748b;
              text-align: right;
            }
            h2, h3, h4 { font-weight: 800; color: #0f172a; margin-top: 1.5rem; margin-bottom: 0.75rem; }
            h2 { font-size: 1.25rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem; }
            h3 { font-size: 1.1rem; }
            h4 { font-size: 0.95rem; }
            p { font-size: 0.875rem; color: #475569; line-height: 1.6; margin-bottom: 0.75rem; }
            ul, ol { margin-left: 1.5rem; margin-bottom: 1rem; }
            li { font-size: 0.875rem; color: #475569; margin-bottom: 0.25rem; }
            code { font-family: monospace; font-size: 0.85rem; background-color: #f1f5f9; padding: 2px 4px; border-radius: 4px; color: #0f172a; }
            pre { background-color: #0f172a; color: #f8fafc; padding: 16px; border-radius: 12px; font-family: monospace; font-size: 0.825rem; overflow-x: auto; margin: 16px 0; }
            pre code { background: none; color: inherit; padding: 0; }
            @media print {
              @page { margin: 0; }
              body { padding: 1.5cm; }
            }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <div>
              <div class="logo-text">PULSELOG AI DIAGNOSTIC</div>
              <div style="font-size: 0.85rem; color: #64748b; font-weight: 600;">POWERED BY GROQ &middot; LLAMA 3.3 70B</div>
            </div>
            <div class="meta-text">
              <strong>Source:</strong> ${sourceId || 'Unknown Server'}<br>
              <strong>Date:</strong> ${new Date().toLocaleString()}
            </div>
          </div>
          <div>
            ${reportHtml}
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    
    // Split by code blocks first
    const parts = text.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        const lines = part.split('\n');
        const lang = lines[0].replace('```', '').trim() || 'bash';
        const code = lines.slice(1, -1).join('\n');
        
        return (
          <div key={index} className="my-5 rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 shadow-lg font-mono">
            <div className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <span>{lang}</span>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition-all active:scale-95 cursor-pointer text-xs font-black uppercase tracking-wider"
              >
                Copy Code
              </button>
            </div>
            <pre className="p-5 overflow-x-auto text-sm text-slate-100 whitespace-pre leading-relaxed select-text">{code}</pre>
          </div>
        );
      }
      
      const lines = part.split('\n');
      return lines.map((line, lineIdx) => {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('###')) {
          return (
            <h4 key={`${index}-${lineIdx}`} className="text-sm font-black text-slate-800 uppercase tracking-wider mt-6 mb-3 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-gradient-to-b from-sky-400 to-indigo-500" />
              {trimmed.replace('###', '').trim()}
            </h4>
          );
        }
        if (trimmed.startsWith('##')) {
          return (
            <h3 key={`${index}-${lineIdx}`} className="text-base font-black text-slate-900 tracking-tight mt-7 mb-4 flex items-center gap-2.5">
              <span className="w-1.5 h-5 rounded-full bg-gradient-to-b from-purple-400 to-pink-500" />
              {trimmed.replace('##', '').trim()}
            </h3>
          );
        }
        if (trimmed.startsWith('#')) {
          return (
            <h2 key={`${index}-${lineIdx}`} className="text-lg font-black bg-gradient-to-r from-indigo-500 to-sky-500 text-transparent bg-clip-text mt-8 mb-4">
              {trimmed.replace('#', '').trim()}
            </h2>
          );
        }
        if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
          return (
            <div key={`${index}-${lineIdx}`} className="flex items-start gap-3 ml-4 my-2 text-sm text-slate-600">
              <span className="text-sky-500 mt-0.5 flex-shrink-0 text-base">•</span>
              <span>{trimmed.substring(1).trim()}</span>
            </div>
          );
        }
        if (/^\d+\./.test(trimmed)) {
          const match = trimmed.match(/^(\d+)\.(.*)/);
          if (match) {
            return (
              <div key={`${index}-${lineIdx}`} className="flex items-start gap-3 ml-4 my-2.5 text-sm text-slate-600">
                <span className="font-black text-indigo-500 flex-shrink-0">{match[1]}.</span>
                <span>{match[2].trim()}</span>
              </div>
            );
          }
        }
        if (trimmed === '') {
          return <div key={`${index}-${lineIdx}`} className="h-3" />;
        }
        
        return (
          <p key={`${index}-${lineIdx}`} className="text-sm text-slate-600 leading-relaxed my-1.5 font-sans">
            {line}
          </p>
        );
      });
    });
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
          <div 
            onClick={handleAnalyzeSpike}
            className="flex items-center gap-2 px-3 py-1 bg-red-50 border border-red-200 rounded-xl flex-shrink-0 cursor-pointer hover:bg-red-100 hover:border-red-300 transition-all duration-150 active:scale-95"
            title="Click to analyze error spike with Gemini AI"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping flex-shrink-0" />
            <span className="text-red-600 text-[9px] font-black uppercase tracking-widest whitespace-nowrap flex items-center gap-1">
              Error Spike — {errorSpikeCount} in 10s
              <Sparkles className="w-2.5 h-2.5 text-red-500 animate-pulse" />
              <span className="text-[8px] lowercase font-normal opacity-70">(click to analyze)</span>
            </span>
            <button 
              onClick={(e) => { e.stopPropagation(); setErrorSpike(false); }} 
              className="text-red-300 hover:text-red-500 transition-colors ml-1"
              title="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}


        <div className="flex-1" />

        {/* Close Button (if slot system active) */}
        {onClose && (
          <button 
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-all group/close order-last ml-2"
            title="Close slot"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Watch input */}
        <div 
          title="Real-Time Alerts: Type a keyword & press Enter to highlight matches in bright red and count occurrences."
          className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/10 transition-all flex-shrink-0 gap-1.5"
        >
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
            placeholder="Watch keyword..."
            className="bg-transparent text-slate-700 text-[10px] font-bold outline-none w-24 placeholder:text-slate-400"
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

        {/* Search input with Auto-Trigger and Clear Option */}
        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all flex-shrink-0 gap-1.5">
          <Search className="w-3 h-3 text-sky-500 flex-shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search"
            className="bg-transparent text-slate-700 text-[10px] font-bold outline-none w-16 placeholder:text-slate-400"
          />
          <button
            onClick={() => setIsRegex(r => !r)}
            className={`text-[9px] font-black px-1.5 py-0.5 rounded-lg border transition-all ${
              isRegex
                ? 'text-amber-600 border-amber-400/50 bg-amber-50'
                : 'text-slate-400 border-slate-200 hover:border-slate-300'
            }`}
            title="Toggle regex"
          >
            .*
          </button>
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm('');
                setActiveSearch('');
              }}
              className="text-[10px] font-black text-slate-400 hover:text-red-500 transition-colors ml-0.5"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
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
            onClick={() => {
              const url = `/popout?serverId=${serverId}&logType=${logType}&sourceId=${encodeURIComponent(sourceId || '')}`;
              window.open(url, '_blank', 'width=1000,height=800,menubar=no,toolbar=no,location=no');
            }}
            title="Pop-out to new window"
            className="p-2 text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
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

      {/* AI Diagnostic Modal — fullscreen */}
      {showAnalysisModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-6xl bg-white rounded-[2rem] shadow-[0_32px_80px_-10px_rgba(15,23,42,0.35),_0_0_60px_rgba(14,165,233,0.12)] border border-slate-100 flex flex-col h-[95vh] overflow-hidden animate-in fade-in zoom-in-95 duration-300 ease-out">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-10 py-6 border-b border-slate-100 bg-slate-50/60 flex-shrink-0">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-sky-500 via-purple-500 to-indigo-500 shadow-lg shadow-indigo-500/20">
                  <Sparkles className="w-6 h-6 text-white animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">
                    PulseLog AI Diagnostic
                  </h3>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                    Powered by Groq · Llama 3.3 70B
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAnalysisModal(false)}
                className="p-2.5 rounded-2xl hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-all duration-200 active:scale-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-10 py-8 select-text">
              {/* Metadata strip */}
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold text-slate-500 uppercase tracking-wider mb-6">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span>Severity: <span className="text-red-500">Critical</span></span>
                </div>
                <div>
                  <span>Source: {sourceId?.split('/').pop()?.toUpperCase() || 'UNKNOWN'}</span>
                </div>
                <div>
                  <span>Time: {new Date().toLocaleTimeString()}</span>
                </div>
              </div>

              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-16 h-16 rounded-full border-4 border-sky-500/10 animate-ping" />
                    <div className="w-14 h-14 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-sm font-black text-slate-600 uppercase tracking-widest animate-pulse">
                      Analyzing Log Incident
                    </p>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                      Consulting neural systems engine...
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  {analysisReport ? (
                    <div className="max-w-none analysis-report-container select-text">
                      {renderMarkdown(analysisReport)}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-center py-16 text-base">No analysis report available.</p>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-10 py-5 border-t border-slate-100 bg-slate-50/60 flex justify-between items-center flex-shrink-0">
              {analysisReport && !isAnalyzing ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => navigator.clipboard.writeText(analysisReport)}
                    className="px-5 py-3 text-sm font-black text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-2xl transition-all duration-200 active:scale-95 flex items-center gap-2 border border-indigo-100 cursor-pointer"
                  >
                    Copy Entire Report
                  </button>
                  <button
                    onClick={downloadReportMarkdown}
                    className="px-5 py-3 text-sm font-black text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-2xl transition-all duration-200 active:scale-95 flex items-center gap-2 border border-sky-100 cursor-pointer"
                  >
                    Download Markdown
                  </button>
                  <button
                    onClick={downloadReportPDF}
                    className="px-5 py-3 text-sm font-black text-purple-600 hover:text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-2xl transition-all duration-200 active:scale-95 flex items-center gap-2 border border-purple-100 cursor-pointer"
                  >
                    Save as PDF
                  </button>
                </div>
              ) : <div />}
              <button
                onClick={() => setShowAnalysisModal(false)}
                className="px-6 py-3 text-sm font-black text-slate-700 bg-white border border-slate-200 rounded-2xl hover:bg-slate-100 hover:border-slate-300 transition-all duration-200 shadow-sm active:scale-95 cursor-pointer"
              >
                Close Diagnostic
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );

}
