"use client";

import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import TerminalViewer from "../components/TerminalViewer";
import Dashboard from "../components/Dashboard";
import { Lock, Eye, EyeOff, User } from "lucide-react";

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
    setActiveStream({ serverId: null, logType: null, sourceId: null });
  };

  if (isCheckingSession) return null;

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#020202] flex items-center justify-center p-4 relative overflow-hidden font-sans">
        <div className="absolute inset-0 z-0">
          <div className="absolute top-[15%] left-[-5%] w-[600px] h-[600px] bg-purple-600/20 rounded-full blur-[160px] pointer-events-none" />
          <div className="absolute bottom-[-5%] right-[-5%] w-[600px] h-[600px] bg-cyan-600/20 rounded-full blur-[140px] pointer-events-none" />
        </div>
        <div
          className="absolute bottom-0 left-[-50%] w-[200%] h-[45vh] z-0 opacity-40 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to top, #020202 10%, transparent), 
                              repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(168, 85, 247, 0.5) 40px),
                              repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(6, 182, 212, 0.5) 40px)`,
            transform: 'perspective(1000px) rotateX(70deg)',
            transformOrigin: 'bottom center',
          }}
        />
        <div className="relative z-10 w-full max-w-[440px]">
          <div className="bg-black/40 backdrop-blur-[50px] border border-white/10 rounded-[48px] p-12 shadow-[0_40px_120px_rgba(0,0,0,0.9)] overflow-hidden">
            <div className="flex flex-col items-center mb-10">
              <div className="w-24 h-24 mb-6 relative">
                <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(34,211,238,0.7)]">
                  <defs><linearGradient id="p-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#A855F7" /><stop offset="100%" stopColor="#06B6D4" /></linearGradient></defs>
                  <circle cx="50" cy="50" r="48" fill="none" stroke="url(#p-logo-grad)" strokeWidth="0.8" strokeDasharray="8 8" className="animate-[spin_40s_linear_infinite]" />
                  <circle cx="28" cy="40" r="3.5" fill="#A855F7" /> <path d="M28 40 H42" stroke="#A855F7" strokeWidth="1.5" />
                  <circle cx="22" cy="50" r="3.5" fill="#06B6D4" /> <path d="M22 50 H42" stroke="#06B6D4" strokeWidth="1.5" />
                  <circle cx="28" cy="60" r="3.5" fill="#A855F7" /> <path d="M28 60 H42" stroke="#A855F7" strokeWidth="1.5" />
                  <path d="M42 30 V70 M42 30 Q68 30 68 50 Q68 70 42 70" fill="none" stroke="url(#p-logo-grad)" strokeWidth="5.5" strokeLinecap="round" />
                  <path d="M48 50 L54 50 L57 42 L62 58 L65 50 L72 50" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" rotate="45" className="animate-pulse" />
                </svg>
              </div>
              <h1 className="text-[42px] font-black text-white tracking-[0.2em] mb-1 leading-none uppercase">PULSELOG</h1>
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.5em] mt-3 opacity-90 text-center text-center">High-Tech Infrastructure Monitoring</p>
            </div>
            <form onSubmit={handleLogin} className="flex flex-col gap-6">
              <div className="relative group/field"><div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within/field:text-cyan-400"><User className="w-5 h-5" /></div><input type="text" placeholder="Username / Email" value={username} onChange={e => setUsername(e.target.value)} className="w-full bg-[#080808]/80 border border-white/5 rounded-2xl pl-14 pr-4 py-5 text-white text-sm outline-none focus:border-cyan-500/50 transition-all font-mono" /></div>
              <div className="relative group/field font-sans"><div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within/field:text-purple-400"><Lock className="w-5 h-5" /></div><input type={showPassword ? "text" : "password"} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#080808]/80 border border-white/5 rounded-2xl pl-14 pr-12 py-5 text-white text-sm outline-none focus:border-purple-500/50 transition-all font-mono" /><button type="button" onClick={() => setShowPassword(u => !u)} className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white transition-colors">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
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

      <main className="flex-1 flex flex-col p-6 h-full relative">
        <header className="flex justify-between items-center mb-6 pl-2 z-10 w-full">
          <h2 className="text-2xl font-black tracking-tighter text-white uppercase italic">Infrastructure</h2>
          <button onClick={handleLogout} className="text-[10px] font-black tracking-widest text-zinc-600 hover:text-white uppercase transition-colors">Logout</button>
        </header>

        <div className="flex-1 min-h-0 z-10 w-full">
          {view === 'dashboard' ? (
            <div className="h-full overflow-auto"><Dashboard onSelectServer={(id) => setSelectedServerId(id)} /></div>
          ) : (
            <TerminalViewer serverId={activeStream.serverId} logType={activeStream.logType} sourceId={activeStream.sourceId} />
          )}
        </div>
      </main>
    </div>
  );
}
