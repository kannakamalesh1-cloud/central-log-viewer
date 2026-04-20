"use client";

import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import TerminalViewer from "../components/TerminalViewer";
import Dashboard from "../components/Dashboard";
import { Lock, Eye, EyeOff, User, Activity, Globe, Disc, Clock, ChevronDown } from "lucide-react";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [userRole, setUserRole] = useState("viewer");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [view, setView] = useState<'dashboard' | 'terminal'>('dashboard');
  const [activeStream, setActiveStream] = useState({
    serverId: null as number | null,
    logType: null as string | null,
    sourceId: null as string | null
  });

  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  // 3-state heartbeat: 'running' | 'dying' | 'stopped'
  const [heartbeatStatus, setHeartbeatStatus] = useState<'running' | 'dying' | 'stopped'>('stopped');
  const [recentSources, setRecentSources] = useState<{sourceId: string; logType: string; serverId: number; serverName?: string}[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  // Helper to add/move source to recent list
  const addToRecent = (serverId: number, logType: string, sourceId: string, serverName: string) => {
    setRecentSources(prev => {
      // Identity is serverId + sourceId to avoid collisions across servers
      const filtered = prev.filter(r => !(r.sourceId === sourceId && r.serverId === serverId)).slice(0, 4);
      const updated = [{ serverId, logType, sourceId, serverName }, ...filtered];
      try { localStorage.setItem('pulselog_recent', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  // Load connection history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('pulselog_recent');
      if (stored) setRecentSources(JSON.parse(stored));
    } catch {}
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
    } catch (e) {}
    setIsLoggedIn(false);
    setUserRole("viewer");
    setActiveStream({ serverId: null, logType: null, sourceId: null });
    setHeartbeatStatus('stopped');
  };

  if (isCheckingSession) return null;

  if (!isLoggedIn) {
     return (
       <div className="min-h-screen bg-[#020202] flex items-center justify-center p-4 relative overflow-hidden font-sans">
         <div className="absolute inset-0 z-0">
            <div className="absolute top-[15%] left-[-5%] w-[600px] h-[600px] bg-purple-600/20 rounded-full blur-[160px] pointer-events-none" />
            <div className="absolute bottom-[-5%] right-[-5%] w-[600px] h-[600px] bg-cyan-600/20 rounded-full blur-[140px] pointer-events-none" />
         </div>
         <div className="relative z-10 w-full max-w-[440px]">
            <div className="bg-black/40 backdrop-blur-[50px] border border-white/10 rounded-[48px] p-12 shadow-[0_40px_120px_rgba(0,0,0,0.9)] overflow-hidden">
               <div className="flex flex-col items-center mb-10">
                  <h1 className="text-[42px] font-black text-white tracking-[0.2em] mb-1 leading-none uppercase">PULSELOG</h1>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.5em] mt-3 opacity-90 text-center">High-Tech Infrastructure Monitoring</p>
               </div>
               <form onSubmit={handleLogin} className="flex flex-col gap-6">
                  <div className="relative"><input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-[#080808]/80 border border-white/5 rounded-2xl p-5 text-white outline-none focus:border-cyan-500/50 transition-all font-mono"/></div>
                  <div className="relative"><input type={showPassword ? "text" : "password"} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#080808]/80 border border-white/5 rounded-2xl p-5 text-white outline-none focus:border-purple-500/50 transition-all font-mono"/></div>
                  <button type="submit" className="mt-4 w-full bg-[#06B6D4] hover:bg-[#22D3EE] text-[#020202] font-black uppercase text-sm tracking-[0.3em] rounded-2xl py-5 transition-all shadow-[0_20px_50px_rgba(6,182,212,0.4)]">SIGN IN</button>
               </form>
            </div>
         </div>
       </div>
     );
  }

  return (
    <div className="fixed inset-0 w-full h-full bg-[#020202] flex text-white overflow-hidden overscroll-none font-sans select-none">
        <Sidebar 
          userRole={userRole}
          selectedServerId={selectedServerId}
          setSelectedServerId={setSelectedServerId}
          activeSourceId={activeStream.sourceId}
          onSelect={(serverId, logType, sourceId, serverName) => {
            setActiveStream({ serverId, logType, sourceId });
            setSelectedServerId(serverId); // Ensure server is selected in sidebar too
            setView('terminal');
            addToRecent(serverId, logType, sourceId, serverName);
          }} 
          onShowDashboard={() => setView('dashboard')}
        />
        
        <main className="flex-1 flex flex-col p-2 h-full relative overflow-hidden">
           {/* Ambient Background Glow */}
           <div className="absolute inset-0 pointer-events-none z-0">
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-violet-600/5 rounded-full blur-[120px]" style={{animation: 'ambientpulse 6s ease-in-out infinite'}} />
             <div className="absolute bottom-10 right-10 w-[300px] h-[200px] bg-purple-600/4 rounded-full blur-[100px]" style={{animation: 'ambientpulse 8s ease-in-out infinite reverse'}} />
           </div>
           <style>{`
             @keyframes ambientpulse {
               0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
               50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.1); }
             }
           `}</style>
           <header className="flex justify-between items-center mb-1.5 px-6 h-10 z-50 w-full">
              {/* Specialized Neon Heartbeat waveform */}
              <div className="flex items-center gap-8 bg-black/40 border border-white/5 rounded-full pl-6 pr-8 py-1 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] h-9 overflow-hidden group">
                 <div className="flex items-center gap-3">
                    <Activity className={`w-4 h-4 transition-colors duration-500 ${heartbeatStatus === 'running' ? 'text-violet-400' : 'text-zinc-800'}`} />
                    <span className={`text-[10px] font-black tracking-[0.4em] transition-colors duration-500 ${heartbeatStatus === 'running' ? 'text-violet-400/80' : heartbeatStatus === 'dying' ? 'text-violet-400/30' : 'text-zinc-800'}`}>PulseLog</span>
                 </div>
                 
                 {/* Smart Heartbeat Waveform: TRUE conditional render */}
                 <div className="w-[340px] h-8 relative overflow-hidden flex items-center pr-4">
                    {heartbeatStatus === 'running' ? (
                      // RUNNING: animated neon EKG
                      <svg key="running" viewBox="0 0 200 40" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                        <path d="M0 20 L40 20 L45 20 L48 5 L52 35 L55 20 L65 20 L75 20 L80 0 L85 40 L90 20 L110 20 L120 20 L125 15 L130 25 L135 20 L150 20 L160 20 L165 5 L170 35 L175 20 L200 20"
                          fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round"
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
                      // DYING: slowing, fading EKG — like a real heart stopping
                      <svg key="dying" viewBox="0 0 200 40" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                        <path d="M0 20 L40 20 L45 20 L48 5 L52 35 L55 20 L65 20 L75 20 L80 0 L85 40 L90 20 L110 20 L120 20 L125 15 L130 25 L135 20 L150 20 L160 20 L165 5 L170 35 L175 20 L200 20"
                          fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round"
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
                      // STOPPED: flat grey line
                      <svg key="stopped" viewBox="0 0 200 40" preserveAspectRatio="none" className="w-full h-full">
                        <line x1="0" y1="20" x2="200" y2="20" stroke="#27272a" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    )}
                 </div>
              </div>

              {/* Action Zone: Recent History + Log ID + Logout */}
              <div className="flex items-center gap-4">
                 {/* Connection History */}
                 <div className="relative">
                    <button
                      onClick={() => setShowRecent(r => !r)}
                      className={`flex items-center gap-2 transition-all ${showRecent ? 'text-purple-400' : 'text-zinc-500 hover:text-zinc-200'}`}
                      title="Recent connections"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <ChevronDown className={`w-3 h-3 transition-transform ${showRecent ? 'rotate-180' : ''}`} />
                    </button>
                    {showRecent && (
                      <div className="absolute right-0 top-10 w-64 bg-black/80 backdrop-blur-3xl border border-white/10 rounded-[20px] shadow-[0_25px_80px_rgba(0,0,0,0.8)] z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">History</span>
                          {recentSources.length > 0 && (
                            <button 
                              onClick={() => { setRecentSources([]); localStorage.removeItem('pulselog_recent'); }}
                              className="text-[8px] font-bold text-zinc-600 hover:text-red-400 transition-colors uppercase tracking-widest"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        
                        <div className="max-h-[280px] overflow-y-auto p-1 custom-scrollbar">
                          {recentSources.length === 0 ? (
                            <div className="py-8 flex flex-col items-center justify-center opacity-40">
                              <Clock className="w-6 h-6 text-zinc-700 mb-2 stroke-[1px]" />
                              <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest text-center px-4">
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
                                className="w-full group/item flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.05] transition-all text-left mb-0.5 last:mb-0"
                              >
                                <div className="w-7 h-7 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center group-hover/item:bg-purple-500/10 group-hover/item:border-purple-500/20 transition-all">
                                  <Disc className="w-3 h-3 text-zinc-600 group-hover/item:text-purple-400 group-hover/item:animate-spin" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-zinc-300 group-hover/item:text-white truncate">
                                      {r.sourceId.split('/').pop()?.toUpperCase()}
                                    </span>
                                    <span className="text-[7px] font-black text-purple-500/40 uppercase tracking-tighter shrink-0">{r.logType}</span>
                                  </div>
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <Globe className="w-2 h-2 text-zinc-700" />
                                    <span className="text-[8px] font-bold text-zinc-600 truncate">{r.serverName || 'Server'}</span>
                                  </div>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                 </div>

                 {activeStream.sourceId && (
                    <div className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-2xl px-5 h-9 group/id transition-all hover:bg-white/5">
                       <Disc className={`w-3.5 h-3.5 transition-all duration-500 ${heartbeatStatus === 'running' ? 'text-emerald-500 animate-spin' : 'text-zinc-800'}`} />
                       <span className="text-[10px] font-black tracking-widest text-zinc-500 uppercase group-hover/id:text-zinc-300 transition-colors">
                          {activeStream.sourceId.split('/').pop()?.toUpperCase()}
                       </span>
                    </div>
                 )}

                 <button 
                   onClick={handleLogout} 
                   className="text-[10px] font-black tracking-[0.2em] text-zinc-700 hover:text-red-500 uppercase transition-all"
                 >
                    Logout
                 </button>
              </div>
           </header>

           <div className="flex-1 min-h-0 z-0 w-full pb-3 px-2">
              {view === 'dashboard' ? (
                <div className="h-full overflow-auto p-4"><Dashboard onSelectServer={(id) => setSelectedServerId(id)} userRole={userRole} /></div>
              ) : (
                 <TerminalViewer 
                   serverId={activeStream.serverId} 
                   logType={activeStream.logType} 
                   sourceId={activeStream.sourceId} 
                   onStatusChange={setHeartbeatStatus} 
                 />
              )}
           </div>
        </main>
    </div>
  );
}
