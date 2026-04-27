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
          
          {/* Decorative Floating "Infrastructure" Elements in a strict grid alignment */}
          
          {/* Row 1 (5%) - Outer Tracks */}
          <div className="absolute top-[5%] left-[1%] w-44 h-24 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-2xl p-2.5 shadow-sm hidden lg:block animate-in fade-in slide-in-from-left-8 duration-1000 pointer-events-none">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-sky-500/10 rounded-lg flex items-center justify-center">
                <Activity className="w-4 h-4 text-sky-600" />
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Real-time Stream</span>
            </div>
            <div className="flex gap-1 items-end h-8">
              {[40, 70, 45, 90, 65, 80, 50, 85].map((h, i) => (
                <div key={i} className="flex-1 bg-sky-400/20 rounded-t-sm" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>

          <div className="absolute top-[5%] right-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-2xl p-2.5 shadow-sm hidden lg:block animate-in fade-in slide-in-from-top-8 duration-1000 delay-500 pointer-events-none">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-indigo-500/10 rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-indigo-600" />
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Terminal Speed</span>
            </div>
            <div className="bg-slate-900/5 rounded-xl p-2 font-mono text-[8px] text-indigo-600/50">
              $ tail -f access.log<br />
              [OK] Stream 0.4ms
            </div>
          </div>

          {/* Row 2 (17%) - Inner Tracks */}
          <div className="absolute top-[17%] left-[13%] w-40 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-2xl p-2.5 shadow-sm hidden lg:block animate-in fade-in slide-in-from-top-12 duration-1000 delay-1200 pointer-events-none">
             <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center">
                   <Activity className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cluster Health</span>
             </div>
             <div className="grid grid-cols-5 gap-1">
                {[1, 1, 1, 1, 1, 1, 1, 1, 1, 0].map((v, i) => (
                   <div key={i} className={`h-1 rounded-full ${v ? 'bg-blue-400' : 'bg-slate-200'}`} />
                ))}
             </div>
          </div>

          <div className="absolute top-[17%] right-[13%] w-40 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-top-12 duration-1000 delay-800 pointer-events-none">
             <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center">
                   <Activity className="w-4 h-4 text-purple-600" />
                </div>
                <div className="flex flex-col">
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">AI Insights</span>
                   <span className="text-[10px] font-bold text-slate-700">Patterns Detected</span>
                </div>
             </div>
          </div>

          {/* Row 3 (29%) - Outer Tracks */}
          <div className="absolute top-[29%] left-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-left-12 duration-1000 delay-200 pointer-events-none">
             <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-pink-500/10 rounded-lg flex items-center justify-center">
                   <Activity className="w-4 h-4 text-pink-600" />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Network Latency</span>
             </div>
             <div className="flex items-center gap-1.5 px-2 py-1 bg-pink-500/5 rounded-lg border border-pink-500/10">
                <div className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
                <span className="text-[10px] font-bold text-pink-600 font-mono">12ms Avg</span>
             </div>
          </div>

          <div className="absolute top-[29%] right-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-right-12 duration-1000 delay-1400 pointer-events-none">
             <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-teal-500/10 rounded-lg flex items-center justify-center">
                   <Activity className="w-4 h-4 text-teal-600" />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Memory Load</span>
             </div>
             <div className="flex justify-between items-end gap-0.5 h-6">
                {[30, 50, 40, 60, 80, 55, 45, 70].map((h, i) => (
                   <div key={i} className="flex-1 bg-teal-400/30 rounded-t-sm" style={{ height: `${h}%` }} />
                ))}
             </div>
          </div>

          {/* Row 4 (41%) - Inner Tracks */}
          <div className="absolute top-[41%] left-[13%] w-40 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-top-12 duration-1000 delay-400 pointer-events-none">
             <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CPU Load</span>
                <span className="text-[9px] font-bold text-sky-600">24%</span>
             </div>
             <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                <div className="bg-sky-500 h-full w-[24%]" />
             </div>
          </div>

          <div className="absolute top-[41%] right-[13%] w-40 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-1100 pointer-events-none">
             <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                   <Activity className="w-4 h-4 text-yellow-600" />
                </div>
                <div className="flex flex-col">
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stream Latency</span>
                   <span className="text-[10px] font-bold text-slate-700">2.1ms Avg</span>
                </div>
             </div>
          </div>

          {/* Row 5 (53%) - Outer Tracks */}
          <div className="absolute top-[53%] left-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-left-12 duration-1000 delay-1300 pointer-events-none">
             <div className="flex items-center gap-2 mb-2">
                <Globe className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Traffic Flow</span>
             </div>
             <div className="text-[10px] font-bold text-slate-700 flex items-baseline gap-1">
                <span>1.4k</span>
                <span className="text-[8px] text-slate-400 uppercase">req/s</span>
             </div>
          </div>

          <div className="absolute top-[53%] right-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-2xl p-3 shadow-sm hidden lg:block animate-in fade-in slide-in-from-right-8 duration-1000 delay-300 pointer-events-none">
             <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-red-500/10 rounded-lg flex items-center justify-center">
                   <Activity className="w-4 h-4 text-red-600" />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">System Health</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-red-500/20 rounded-full overflow-hidden">
                   <div className="bg-red-500 h-full w-[98%]" />
                </div>
                <span className="text-[9px] font-bold text-red-600">98%</span>
             </div>
          </div>

          {/* Row 6 (65%) - Inner Tracks */}
          <div className="absolute top-[65%] left-[13%] w-40 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-600 pointer-events-none">
             <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-cyan-500/10 rounded-lg flex items-center justify-center">
                   <Disc className="w-4 h-4 text-cyan-600" />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Buffers</span>
             </div>
             <div className="grid grid-cols-4 gap-1">
                {[1, 1, 1, 1, 1, 1, 0, 0].map((v, i) => (
                   <div key={i} className={`h-1.5 rounded-full ${v ? 'bg-cyan-400' : 'bg-slate-200'}`} />
                ))}
             </div>
          </div>

          <div className="absolute top-[65%] right-[13%] w-40 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-2xl p-2.5 shadow-sm hidden lg:block animate-in fade-in slide-in-from-right-12 duration-1000 delay-900 pointer-events-none">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                <Shield className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">SSH Security</span>
            </div>
            <div className="flex flex-wrap gap-1 opacity-40">
              {[1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0].map((v, i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-emerald-400" />
              ))}
            </div>
          </div>

          {/* Row 7 (77%) - Outer Tracks */}
          <div className="absolute top-[77%] left-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-2xl p-2.5 shadow-sm hidden lg:block animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-1500 pointer-events-none">
             <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-violet-500/10 rounded-lg flex items-center justify-center">
                   <Activity className="w-4 h-4 text-violet-600" />
                </div>
                <div className="flex flex-col">
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Stream Throughput</span>
                   <span className="text-[10px] font-bold text-slate-700">1.2 MB / sec</span>
                </div>
             </div>
          </div>

          {/* Row 8 (89%) - Outer Tracks Balanced */}
          <div className="absolute top-[87%] left-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-700 pointer-events-none">
             <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center">
                   <User className="w-4 h-4 text-amber-600" />
                </div>
                <div className="flex flex-col">
                   <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">RBAC Active</span>
                   <div className="flex gap-1 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                   </div>
                </div>
             </div>
          </div>

          <div className="absolute top-[87%] right-[1%] w-44 bg-white/40 backdrop-blur-md border border-slate-200/50 rounded-xl p-2 shadow-sm hidden lg:block animate-in fade-in slide-in-from-right-12 duration-1000 delay-1000 pointer-events-none">
             <div className="flex items-center gap-2 mb-2">
                <Globe className="w-3.5 h-3.5 text-sky-500" />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cloud Sync</span>
             </div>
             <div className="flex items-center justify-center gap-4">
                <div className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                <div className="h-px flex-1 bg-slate-200 dashed" />
                <div className="w-2 h-2 rounded-full bg-slate-300" />
             </div>
          </div>

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

            {activeStream.sourceId && (
              <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-2xl px-4 h-9 shadow-sm group/id transition-all hover:border-sky-300 hover:bg-sky-50">
                <Disc className={`w-3.5 h-3.5 transition-all duration-500 ${heartbeatStatus === 'running' ? 'text-sky-500 animate-spin' : 'text-slate-300'}`} />
                <span className="text-[10px] font-black tracking-widest text-slate-500 uppercase group-hover/id:text-sky-700 transition-colors">
                  {activeStream.sourceId.split('/').pop()?.toUpperCase()}
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
