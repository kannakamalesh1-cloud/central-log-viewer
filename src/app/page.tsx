"use client";

import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import TerminalViewer from "../components/TerminalViewer";
import Dashboard from "../components/Dashboard";
import { Lock, Eye, EyeOff, User, Activity, Globe, Disc } from "lucide-react";

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
          onSelect={(serverId, logType, sourceId) => {
            setActiveStream({ serverId, logType, sourceId });
            setView('terminal');
          }} 
          onShowDashboard={() => setView('dashboard')}
        />
        
        <main className="flex-1 flex flex-col p-2 h-full relative">
           <header className="flex justify-between items-center mb-1.5 px-6 h-10 z-10 w-full">
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

              {/* Action Zone: Log ID + Logout */}
              <div className="flex items-center gap-6">
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
                   className="text-[10px] font-black tracking-[0.2em] text-zinc-700 hover:text-red-500 uppercase transition-all flex items-center gap-2"
                 >
                    Logout
                 </button>
              </div>
           </header>

           <div className="flex-1 min-h-0 z-10 w-full pb-3 px-2">
              {view === 'dashboard' ? (
                <div className="h-full overflow-auto p-4"><Dashboard onSelectServer={(id) => setSelectedServerId(id)} /></div>
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
