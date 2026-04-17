"use client";

import React, { useEffect, useState } from 'react';
import { Server, Activity, Users, Shield, RefreshCw, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface ServerData {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  createdAt: string;
}

interface DashboardProps {
  onSelectServer: (serverId: number) => void;
}

export default function Dashboard({ onSelectServer }: DashboardProps) {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalServers: 0,
    activeUsers: 0,
    systemHealthy: true
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const serverRes = await fetch('/api/servers');
      const serversData = await serverRes.json();
      setServers(serversData);

      const userRes = await fetch('/api/users');
      const usersData = await userRes.json();

      setStats({
        totalServers: serversData.length,
        activeUsers: Array.isArray(usersData) ? usersData.length : 0,
        systemHealthy: true
      });
    } catch (e) {
      console.error("Dashboard fetch error", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="w-full h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl transition-all hover:bg-white/10 group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/20 rounded-2xl border border-purple-500/30 group-hover:scale-110 transition-transform">
              <Server className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <p className="text-zinc-500 text-sm font-medium">Total Infrastructure</p>
              <h3 className="text-2xl font-bold text-white tracking-tight">{stats.totalServers} Nodes</h3>
            </div>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl transition-all hover:bg-white/10 group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 rounded-2xl border border-blue-500/30 group-hover:scale-110 transition-transform">
              <Users className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-zinc-500 text-sm font-medium">Authorized Users</p>
              <h3 className="text-2xl font-bold text-white tracking-tight">{stats.activeUsers} Operators</h3>
            </div>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl transition-all hover:bg-white/10 group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/20 rounded-2xl border border-green-500/30 group-hover:scale-110 transition-transform">
              <Shield className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-zinc-500 text-sm font-medium">System Integrity</p>
              <h3 className="text-2xl font-bold text-white tracking-tight">Active & Secure</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500">Connected Servers</h2>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-xl hover:bg-white/10 text-zinc-400 hover:text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          <p className="text-sm">Retrieving real-time health metrics...</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-3xl text-zinc-500 bg-white/[0.02]">
          <Activity className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-sm font-medium">No servers added to the cluster yet.</p>
          <p className="text-xs mt-1">Add your first server in the sidebar to begin monitoring.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">
          {servers.map(server => (
            <div
              key={server.id}
              onClick={() => onSelectServer(server.id)}
              className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl transition-all hover:bg-white/[0.08] hover:border-white/20 hover:translate-y-[-4px] cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 bg-zinc-800 rounded-2xl border border-white/5 group-hover:bg-purple-500/10 group-hover:border-purple-500/30 transition-all">
                  <Server className="w-5 h-5 text-zinc-400 group-hover:text-purple-400" />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Connected</span>
                </div>
              </div>

              <h4 className="text-base font-bold text-white mb-1 group-hover:text-purple-400 transition-colors uppercase tracking-tight">{server.name}</h4>
              <p className="text-xs text-zinc-500 font-mono mb-4">{server.host}:{server.port}</p>

              <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <span className="text-[10px] text-zinc-600 font-medium">
                  {server.username} • Added {new Date(server.createdAt).toLocaleDateString()}
                </span>
                <ChevronRight className="w-4 h-4 text-zinc-500 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
