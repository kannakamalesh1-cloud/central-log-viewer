"use client";

import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import TerminalViewer from "../components/TerminalViewer";
import Dashboard from "../components/Dashboard";
import { Terminal, Lock, Eye, EyeOff, LayoutDashboard } from "lucide-react";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
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

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-[#0a0a0a] to-black">
        {/* Decorative background blobs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[128px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[128px] pointer-events-none" />

        <div className="w-full max-w-md bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10 animate-in fade-in zoom-in-95 duration-500">
           <div className="flex flex-col items-center mb-8">
             <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center mb-4">
                <Terminal className="w-8 h-8 text-purple-400" />
             </div>
             <h1 className="text-2xl font-bold text-white tracking-tight">PulseLog Secure</h1>
             <p className="text-sm text-zinc-400 mt-2">Centralized Live Log Viewer</p>
           </div>
           
           <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-300 ml-1">User</label>
                <input 
                  type="text" 
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 text-white rounded-xl px-4 py-3 outline-none focus:border-purple-500 focus:bg-black/60 transition-all font-mono text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-300 ml-1">Password</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"} 
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 text-white rounded-xl px-4 py-3 pr-11 outline-none focus:border-purple-500 focus:bg-black/60 transition-all font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-purple-400 transition-colors focus:outline-none"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              
              {error && <div className="text-red-400 text-sm font-medium text-center">{error}</div>}
              
              <button type="submit" className="mt-4 w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl py-3.5 transition-colors flex items-center justify-center gap-2">
                <Lock className="w-4 h-4" /> Secure Login
              </button>
           </form>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-[#0a0a0a] flex text-white overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900 via-[#0a0a0a] to-black">
       <Sidebar 
         userRole={userRole}
         onSelect={(serverId, logType, sourceId) => {
           setActiveStream({ serverId, logType, sourceId });
           setView('terminal');
         }} 
         onShowDashboard={() => setView('dashboard')}
       />
       
       <main className="flex-1 flex flex-col p-6 h-full relative">
          {/* Background flares */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[128px] pointer-events-none" />
          
          <header className="flex justify-between items-center mb-6 pl-2 z-10 w-full">
            <div>
               <h2 className="text-2xl font-semibold tracking-tight text-white">
                 {view === 'dashboard' ? 'Infrastructure Overview' : 'Live Stream Interface'}
               </h2>
               <p className="text-zinc-400 text-sm mt-1">
                 {view === 'dashboard' ? 'Real-time health of your connected nodes.' : `Tailing ${activeStream.sourceId} in real-time.`}
               </p>
            </div>
            
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                {activeStream.serverId ? "Ready to Stream" : "Awaiting Selection"}
              </span>
              <button 
                onClick={async () => {
                  try {
                    await fetch('/api/auth/logout', { method: 'POST' });
                  } catch (e) {}
                  setIsLoggedIn(false);
                  setUserRole("viewer");
                  setActiveStream({ serverId: null, logType: null, sourceId: null });
                }}
                className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </header>

          <div className="flex-1 min-h-0 z-10 w-full">
             {view === 'dashboard' ? (
               <Dashboard onSelectServer={(id) => {
                 // Trigger server selection in sidebar? 
                 // For now just keep dashboard view but you could auto-switch
               }} />
             ) : (
               <TerminalViewer 
                  serverId={activeStream.serverId}
                  logType={activeStream.logType}
                  sourceId={activeStream.sourceId}
               />
             )}
          </div>
       </main>
    </div>
  );
}
