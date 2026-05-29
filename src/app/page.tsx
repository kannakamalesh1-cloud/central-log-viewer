"use client";

import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import TerminalViewer from "../components/TerminalViewer";
import Dashboard from "../components/Dashboard";
import { Lock, Eye, EyeOff, User, Activity, Globe, Disc, Clock, ChevronDown, ChevronRight, AlertCircle, Shield } from "lucide-react";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [userRole, setUserRole] = useState("viewer");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [view, setView] = useState<'dashboard' | 'terminal'>('dashboard');
  
  // Multi-slot system (Up to 4 slots)
  const [slots, setSlots] = useState<{ serverId: number | null, logType: string | null, sourceId: string | null }[]>(
    [null, null, null, null].map(() => ({ serverId: null, logType: null, sourceId: null }))
  );
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);

  const [activeStream, setActiveStream] = useState({
    serverId: null as number | null,
    logType: null as string | null,
    sourceId: null as string | null
  });

  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  // 3-state heartbeat: 'running' | 'dying' | 'stopped'
  const [heartbeatStatus, setHeartbeatStatus] = useState<'running' | 'dying' | 'stopped'>('stopped');
  const [recentSources, setRecentSources] = useState<{ sourceId: string; logType: string; serverId: number; serverName?: string }[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  // Update a specific slot
  const updateSlot = (index: number, data: { serverId: number | null, logType: string | null, sourceId: string | null }) => {
    setSlots(prev => {
      const newSlots = [...prev];
      newSlots[index] = data;
      return newSlots;
    });
    if (data.sourceId) {
       setActiveStream(data);
       setView('terminal');
    }
  };

  // Helper to add/move source to recent list
  const addToRecent = (serverId: number, logType: string, sourceId: string, serverName: string) => {
    setRecentSources(prev => {
      // Identity is serverId + sourceId to avoid collisions across servers
      const filtered = prev.filter(r => !(r.sourceId === sourceId && r.serverId === serverId)).slice(0, 4);
      const updated = [{ serverId, logType, sourceId, serverName }, ...filtered];
      try { localStorage.setItem('pulselog_recent', JSON.stringify(updated)); } catch { }
      return updated;
    });
  };

  // Load connection history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('pulselog_recent');
      if (stored) setRecentSources(JSON.parse(stored));
    } catch { }
  }, []);

  useEffect(() => {
    const verifySession = async () => {
      try {
        const res = await fetch("/api/auth/verify");
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            setUserRole(data.user.role || "viewer");
            setIsLoggedIn(true);
          }
        }
      } catch (e) {
        console.error("Session check failed", e);
      } finally {
        setIsCheckingSession(false);
      }
    };
    verifySession();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password })
      });
      if (res.ok) {
        const data = await res.json();
        setUserRole(data.role || "viewer");
        setIsLoggedIn(true);
      } else {
        setError("Invalid credentials");
      }
    } catch (e) {
      setError("Failed to connect");
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { }
    setIsLoggedIn(false);
    setUserRole("viewer");
    setSlots([null, null, null, null].map(() => ({ serverId: null, logType: null, sourceId: null })));
    setActiveStream({ serverId: null, logType: null, sourceId: null });
    setHeartbeatStatus('stopped');
  };

  if (isCheckingSession) return null;

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-6 relative overflow-hidden font-sans selection:bg-sky-100 selection:text-sky-900">
        {/* Animated Production-Ready Background Mesh */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-sky-200/30 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '8s' }} />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-100/40 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '12s', animationDelay: '2s' }} />


          {/* Subtle Grid Pattern Overlay */}
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#0ea5e9 0.5px, transparent 0.5px)', backgroundSize: '32px 32px' }} />
        </div>

        <div className="relative z-10 w-full max-w-[420px] animate-in fade-in zoom-in-95 duration-700 ease-out">
          {/* Main Login Card */}
          <div className="bg-white/70 backdrop-blur-3xl border border-white/40 rounded-[40px] p-10 md:p-12 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] overflow-hidden relative">
            {/* Glossy Overlay Effect */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-60" />

            <div className="flex flex-col items-center mb-12">
              <div className="w-16 h-16 bg-gradient-to-br from-sky-500 to-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-sky-500/20 rotate-3 transition-transform hover:rotate-0 duration-500">
                <Activity className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-3xl font-black text-slate-900 tracking-[-0.02em] mb-2 text-center">
                PULSE<span className="text-sky-600">LOG</span>
              </h1>
              <div className="flex items-center gap-2">
                <div className="h-px w-4 bg-slate-200" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">Infrastructure Hub</p>
                <div className="h-px w-4 bg-slate-200" />
              </div>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 animate-in shake duration-500">
                  <div className="w-8 h-8 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  </div>
                  <p className="text-red-600 text-[11px] font-bold leading-tight uppercase tracking-wide">{error}</p>
                </div>
              )}

              <div className="group flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Identity</label>
                <div className="relative transition-all duration-300">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-500 transition-colors">
                    <User className="w-5 h-5" />
                  </div>
                  <input
                    type="text"
                    placeholder="Username / Email"
                    value={username}
                    onChange={e => {
                      setUsername(e.target.value);
                      if (error) setError("");
                    }}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl pl-14 pr-5 py-4.5 text-slate-900 placeholder:text-slate-400 outline-none focus:border-sky-500/50 focus:bg-white focus:ring-4 focus:ring-sky-500/5 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="group flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Security</label>
                <div className="relative transition-all duration-300">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-sky-500 transition-colors">
                    <Lock className="w-5 h-5" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value);
                      if (error) setError("");
                    }}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl pl-14 pr-14 py-4.5 text-slate-900 placeholder:text-slate-400 outline-none focus:border-sky-500/50 focus:bg-white focus:ring-4 focus:ring-sky-500/5 transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-sky-600 transition-colors p-1 rounded-lg hover:bg-sky-50"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="mt-4 w-full bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-500 hover:to-blue-600 text-white font-black uppercase text-xs tracking-[0.2em] rounded-2xl py-5 transition-all shadow-xl shadow-sky-500/25 active:scale-[0.98] flex items-center justify-center gap-3 group/btn"
              >
                <span>Authorize Access</span>
                <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
              </button>
            </form>

            <div className="mt-10 pt-8 border-t border-slate-100 flex items-center justify-between">
              <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Version 2.4.0-PROD</p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">System Operational</span>
              </div>
            </div>
          </div>

          <p className="mt-8 text-center text-slate-400 text-[10px] font-medium tracking-wide">
            © 2026 PulseLog Monitoring Systems. All rights reserved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-full h-full bg-slate-50 flex text-slate-900 overflow-hidden overscroll-none font-sans select-none">
      <Sidebar
        userRole={userRole}
        selectedServerId={selectedServerId}
        setSelectedServerId={setSelectedServerId}
        activeSourceId={slots[activeSlotIndex]?.sourceId}
        onSelect={(serverId, logType, sourceId, serverName) => {
          updateSlot(activeSlotIndex, { serverId, logType, sourceId });
          setSelectedServerId(serverId); // Ensure server is selected in sidebar too
          setView('terminal');
          addToRecent(serverId, logType, sourceId, serverName);
        }}
        onShowDashboard={() => setView('dashboard')}
      />

      <main className="flex-1 flex flex-col p-2 h-full relative overflow-hidden">
        {/* Ambient Background Glow */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-sky-500/8 rounded-full blur-[140px]" style={{ animation: 'ambientpulse 6s ease-in-out infinite' }} />
          <div className="absolute bottom-10 right-10 w-[300px] h-[200px] bg-sky-400/5 rounded-full blur-[100px]" style={{ animation: 'ambientpulse 8s ease-in-out infinite reverse' }} />
        </div>
        <style>{`
             @keyframes ambientpulse {
               0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
               50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.1); }
             }
           `}</style>
        <header className="flex justify-between items-center mb-1.5 px-6 h-10 z-50 w-full">
          {/* Specialized Neon Heartbeat waveform */}
          <div className="flex items-center gap-8 bg-white/80 border border-slate-200 rounded-full pl-6 pr-8 py-1 shadow-sm h-9 overflow-hidden group">
            <div className="flex items-center gap-3">
              <Activity className={`w-4 h-4 transition-colors duration-500 ${heartbeatStatus === 'running' ? 'text-sky-500' : 'text-slate-300'}`} />
              <span className={`text-[10px] font-black tracking-[0.4em] transition-colors duration-500 ${heartbeatStatus === 'running' ? 'text-sky-600' : heartbeatStatus === 'dying' ? 'text-sky-400' : 'text-slate-400'}`}>PulseLog</span>
            </div>

            {/* Smart Heartbeat Waveform: TRUE conditional render */}
            <div className="w-[340px] h-8 relative overflow-hidden flex items-center pr-4">
              {heartbeatStatus === 'running' ? (
                // RUNNING: animated light sky-blue EKG
                <svg key="running" viewBox="0 0 200 40" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                  <defs>
                    <filter id="glowBlue">
                      <feGaussianBlur stdDeviation="0.8" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <path d="M0 20 L40 20 L45 20 L48 5 L52 35 L55 20 L65 20 L75 20 L80 0 L85 40 L90 20 L110 20 L120 20 L125 15 L130 25 L135 20 L150 20 L160 20 L165 5 L170 35 L175 20 L200 20"
                    fill="none" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round"
                    filter="url(#glowBlue)"
                    style={{ strokeDasharray: '400', strokeDashoffset: '400', animation: 'ekgpulse 1.8s infinite linear' }}
                  />
                  <style>{`
                          @keyframes ekgpulse {
                            0%   { stroke-dashoffset: 400; opacity: 0; }
                            15%  { opacity: 1; }
                            85%  { opacity: 1; }
                            100% { stroke-dashoffset: -400; opacity: 0; }
                          }
                        `}</style>
                </svg>
              ) : heartbeatStatus === 'dying' ? (
                // DYING: slowing, fading light sky-blue EKG
                <svg key="dying" viewBox="0 0 200 40" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                  <defs>
                    <filter id="glowBlueDying">
                      <feGaussianBlur stdDeviation="0.8" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  <path d="M0 20 L40 20 L45 20 L48 5 L52 35 L55 20 L65 20 L75 20 L80 0 L85 40 L90 20 L110 20 L120 20 L125 15 L130 25 L135 20 L150 20 L160 20 L165 5 L170 35 L175 20 L200 20"
                    fill="none" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round"
                    filter="url(#glowBlueDying)"
                    style={{
                      strokeDasharray: '400',
                      strokeDashoffset: '400',
                      animation: 'ekgdying 2.5s ease-out forwards'
                    }}
                  />
                  <style>{`
                          @keyframes ekgdying {
                            0%   { stroke-dashoffset: 400; opacity: 1; animation-timing-function: ease; }
                            30%  { stroke-dashoffset: 0;   opacity: 0.8; animation-timing-function: ease-in; }
                            55%  { stroke-dashoffset: 200; opacity: 0.5; animation-timing-function: ease-in; }
                            75%  { stroke-dashoffset: 350; opacity: 0.25; }
                            100% { stroke-dashoffset: 400; opacity: 0; }
                          }
                        `}</style>
                </svg>
              ) : (
                // STOPPED: soft slate flat line
                <svg key="stopped" viewBox="0 0 200 40" preserveAspectRatio="none" className="w-full h-full">
                  <line x1="0" y1="20" x2="200" y2="20" stroke="#bae6fd" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </div>
          </div>

          {/* Action Zone: Recent History + Log ID + Logout */}
          <div className="flex items-center gap-4">
            {/* Slot Indicator */}
            {view === 'terminal' && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded-xl shadow-sm">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mr-1">Slots:</span>
                {[0, 1, 2, 3].map(i => (
                  <button
                    key={i}
                    onClick={() => setActiveSlotIndex(i)}
                    className={`w-5 h-5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center border ${
                      activeSlotIndex === i 
                        ? 'bg-sky-500 border-sky-500 text-white shadow-md shadow-sky-500/20' 
                        : slots[i].sourceId 
                          ? 'bg-sky-100 border-sky-200 text-sky-600 hover:bg-sky-200' 
                          : 'bg-slate-50 border-slate-200 text-slate-300 hover:border-sky-300'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Connection History */}
            <div className="relative">
              <button
                onClick={() => setShowRecent(r => !r)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all text-xs font-bold ${showRecent
                  ? 'bg-sky-500 border-sky-500 text-white shadow-md shadow-sky-500/30'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-sky-50 hover:border-sky-400 hover:text-sky-700 shadow-sm'
                  }`}
                title="Recent connections"
              >
                <Clock className="w-3.5 h-3.5" />
                <span className="tracking-wide">Recent</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${showRecent ? 'rotate-180' : ''}`} />
              </button>
              {showRecent && (
                <div className="absolute right-0 top-12 w-[272px] bg-white border border-slate-200 rounded-2xl shadow-xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-sky-500" />
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Recent Connections</span>
                    </div>
                    {recentSources.length > 0 && (
                      <button
                        onClick={() => { setRecentSources([]); localStorage.removeItem('pulselog_recent'); }}
                        className="text-[9px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-widest px-2 py-0.5 rounded-lg hover:bg-red-50"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="max-h-[280px] overflow-y-auto p-1.5">
                    {recentSources.length === 0 ? (
                      <div className="py-8 flex flex-col items-center justify-center">
                        <Clock className="w-6 h-6 text-slate-300 mb-2 stroke-[1px]" />
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center px-4">
                          No activity yet
                        </p>
                      </div>
                    ) : (
                      recentSources.map((r, i) => (
                        <button
                          key={`${r.serverId}-${r.sourceId}`}
                          onClick={() => {
                            setActiveStream({ serverId: r.serverId, logType: r.logType, sourceId: r.sourceId });
                            setSelectedServerId(r.serverId);
                            setView('terminal');
                            addToRecent(r.serverId, r.logType, r.sourceId, r.serverName || 'Server');
                            setShowRecent(false);
                          }}
                          className="w-full group/item flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-sky-50 hover:border-sky-200 border border-transparent transition-all text-left mb-0.5 last:mb-0"
                        >
                          <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center group-hover/item:bg-sky-500/15 group-hover/item:border-sky-400/30 transition-all flex-shrink-0">
                            <Disc className="w-3.5 h-3.5 text-slate-400 group-hover/item:text-sky-600 group-hover/item:animate-spin" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-bold text-slate-700 group-hover/item:text-sky-800 truncate">
                                {r.sourceId.split('/').pop()?.toUpperCase()}
                              </span>
                              <span className="text-[8px] font-black text-sky-500/70 uppercase tracking-tighter shrink-0 bg-sky-50 px-1.5 py-0.5 rounded">{r.logType}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Globe className="w-2.5 h-2.5 text-slate-400" />
                              <span className="text-[9px] font-semibold text-slate-400 truncate">{r.serverName || 'Server'}</span>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {slots[activeSlotIndex]?.sourceId && (
              <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-2xl px-4 h-9 shadow-sm group/id transition-all hover:border-sky-300 hover:bg-sky-50">
                <Disc className={`w-3.5 h-3.5 transition-all duration-500 ${heartbeatStatus === 'running' ? 'text-sky-500 animate-spin' : 'text-slate-300'}`} />
                <span className="text-[10px] font-black tracking-widest text-slate-500 uppercase group-hover/id:text-sky-700 transition-colors">
                  {slots[activeSlotIndex].sourceId.split('/').pop()?.toUpperCase()}
                </span>
              </div>
            )}

            <button
              onClick={handleLogout}
              className="text-[10px] font-black tracking-[0.2em] text-slate-400 hover:text-red-500 uppercase transition-all px-3 py-1.5 rounded-xl hover:bg-red-50 border border-transparent hover:border-red-200"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 h-full z-0 w-full pb-3 px-2">
          {view === 'dashboard' ? (
            <div className="h-full overflow-auto p-4"><Dashboard onSelectServer={(id) => setSelectedServerId(id)} userRole={userRole} /></div>
          ) : (
            <div className={`h-full w-full grid gap-3 ${
              slots.filter(s => s.sourceId).length <= 1 ? 'grid-cols-1 grid-rows-1' :
              slots.filter(s => s.sourceId).length === 2 ? 'grid-cols-2 grid-rows-1' :
              'grid-cols-2 grid-rows-2'
            }`}>
              {slots.map((slot, index) => slot.sourceId && (
                <TerminalViewer
                  key={`${index}-${slot.serverId}-${slot.sourceId}`}
                  serverId={slot.serverId}
                  logType={slot.logType}
                  sourceId={slot.sourceId}
                  isActiveSlot={activeSlotIndex === index}
                  onSlotClick={() => setActiveSlotIndex(index)}
                  onClose={() => updateSlot(index, { serverId: null, logType: null, sourceId: null })}
                  onStatusChange={activeSlotIndex === index ? setHeartbeatStatus : undefined}
                />
              ))}
              {slots.filter(s => s.sourceId).length === 0 && (
                 <div className="col-span-full row-span-full flex flex-col items-center justify-center text-slate-400 bg-white/20 backdrop-blur-sm rounded-[40px] border-2 border-dashed border-slate-200">
                    <Activity className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-sm font-bold uppercase tracking-widest">Select a log source to begin</p>
                    <p className="text-[10px] mt-1 text-slate-400">Click any server in the sidebar to browse logs</p>
                 </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
