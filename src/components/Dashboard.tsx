"use client";

import React, { useEffect, useState } from 'react';
import { Server, Activity, Users, Shield, RefreshCw, ChevronRight, CheckCircle2, XCircle, Loader2, List, Search, Download, Box, Cloud, Database, Settings, ChevronUp, ChevronDown } from 'lucide-react';

interface ServerData {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  createdAt: string;
}

interface AuditLogData {
  id: number;
  userEmail: string;
  serverId: number;
  serverName: string;
  logType: string;
  sourceId: string;
  timestamp: string;
}

interface DashboardProps {
  onSelectServer: (serverId: number) => void;
  userRole: string;
}

export default function Dashboard({ onSelectServer, userRole }: DashboardProps) {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogData[]>([]);
  const [auditSearchTerm, setAuditSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalServers: 0,
    activeUsers: 0,
    systemHealthy: true
  });

  const [sortConfig, setSortConfig] = useState<{key: keyof AuditLogData, dir: 'asc'|'desc'}>({ key: 'timestamp', dir: 'desc' });

  const exportAuditLogs = () => {
    if (auditLogs.length === 0) return;
    const headers = ['Timestamp', 'User', 'Server', 'Log Type', 'Source ID'];
    const rows = auditLogs.map(log => {
      const fixedTime = log.timestamp.includes('Z') ? log.timestamp : log.timestamp.replace(' ', 'T') + 'Z';
      return [
        new Date(fixedTime).toLocaleString(),
        log.userEmail,
        log.serverName,
        log.logType,
        log.sourceId
      ];
    });
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `pulselog_audit_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredAuditLogs = auditLogs.filter(log => {
    const fixedTime = log.timestamp.includes('Z') ? log.timestamp : log.timestamp.replace(' ', 'T') + 'Z';
    const dateObj = new Date(fixedTime);
    const dateStr = dateObj.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    
    const rowString = `${log.userEmail} ${log.serverName} ${log.logType} ${log.sourceId} ${dateStr}`.toLowerCase();
    let searchInput = auditSearchTerm.toLowerCase();
    let matchesRange = true;

    // 1. Check for time ranges: "5:00 pm to 6:00 pm" or "5:10-5:30pm"
    const timeRangeMatch = searchInput.match(/([0-9]{1,2}:[0-9]{2}\s*(?:am|pm)?)\s*(?:to|-)\s*([0-9]{1,2}:[0-9]{2}\s*(?:am|pm)?)/);
    if (timeRangeMatch) {
       searchInput = searchInput.replace(timeRangeMatch[0], '');
       const parseTime = (timeStr: string) => {
         let match = timeStr.trim().match(/([0-9]{1,2}):([0-9]{2})\s*(am|pm)?/);
         if (!match) return 0;
         let hours = parseInt(match[1]);
         let minutes = parseInt(match[2]);
         let modifier = match[3];
         if (!modifier) modifier = timeRangeMatch[2].includes('pm') ? 'pm' : 'am';
         if (hours === 12) hours = 0;
         if (modifier === 'pm') hours += 12;
         return hours * 60 + minutes;
       };
       try {
         const startMins = parseTime(timeRangeMatch[1]);
         const endMins = parseTime(timeRangeMatch[2]);
         const logMins = dateObj.getHours() * 60 + dateObj.getMinutes();
         if (logMins < startMins || logMins > endMins) matchesRange = false;
       } catch(e) {}
    }

    // 2. Check for date ranges: "apr 20-apr 21" or "apr20 to 21"
    const dateRangeMatch = searchInput.match(/([a-z]{3})\s*([0-9]{1,2})\s*(?:to|-)\s*(?:([a-z]{3})\s*)?([0-9]{1,2})/);
    if (dateRangeMatch) {
       searchInput = searchInput.replace(dateRangeMatch[0], '');
       const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
       const startMonth = months[dateRangeMatch[1] as keyof typeof months];
       const startDay = parseInt(dateRangeMatch[2]);
       const endMonth = dateRangeMatch[3] ? months[dateRangeMatch[3] as keyof typeof months] : startMonth;
       const endDay = parseInt(dateRangeMatch[4]);
       
       const logMonth = dateObj.getMonth();
       const logDay = dateObj.getDate();
       
       const startScore = startMonth * 100 + startDay;
       const endScore = endMonth * 100 + endDay;
       const logScore = logMonth * 100 + logDay;
       
       if (logScore < startScore || logScore > endScore) matchesRange = false;
    }

    if (!matchesRange) return false;

    // Smart time parsing: if user types "5:00", match the entire 5:xx hour block.
    const smartSearch = searchInput.replace(/([0-9]{1,2}):00(?=\s|$|a|p)/g, '$1:');
    const searchTerms = smartSearch.split(/\s+/).filter(Boolean);
    
    return searchTerms.every(term => rowString.includes(term));
  }).sort((a, b) => {
    let aVal = a[sortConfig.key];
    let bVal = b[sortConfig.key];
    if (sortConfig.key === 'timestamp') {
      aVal = new Date(a.timestamp.includes('Z') ? a.timestamp : a.timestamp.replace(' ', 'T') + 'Z').getTime() as any;
      bVal = new Date(b.timestamp.includes('Z') ? b.timestamp : b.timestamp.replace(' ', 'T') + 'Z').getTime() as any;
    }
    if (aVal < bVal) return sortConfig.dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key: keyof AuditLogData) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const ts = new Date().getTime();
      const serverRes = await fetch(`/api/servers?_t=${ts}`, { cache: 'no-store', headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' } });
      const serversData = await serverRes.json();
      setServers(serversData);

      if (userRole === 'admin') {
        const userRes = await fetch(`/api/users?_t=${ts}`, { cache: 'no-store', headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' } });
        const usersData = await userRes.json();
        
        const auditRes = await fetch(`/api/audit?_t=${ts}`, { cache: 'no-store', headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' } });
        if (auditRes.ok) {
          const auditData = await auditRes.json();
          setAuditLogs(Array.isArray(auditData) ? auditData : []);
        } else if (auditRes.status === 401 || auditRes.status === 403) {
          window.location.reload();
        }

        setStats({
          totalServers: serversData.length,
          activeUsers: Array.isArray(usersData) ? usersData.length : 0,
          systemHealthy: true
        });
      } else {
        setStats({
          totalServers: serversData.length,
          activeUsers: 0,
          systemHealthy: true
        });
      }
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
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm transition-all hover:shadow-md group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-sky-500/10 rounded-2xl border border-sky-500/20 group-hover:scale-110 transition-transform">
              <Server className="w-6 h-6 text-sky-600" />
            </div>
            <div>
              <p className="text-slate-500 text-sm font-medium">Total Infrastructure</p>
              <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{stats.totalServers} Nodes</h3>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm transition-all hover:shadow-md group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-sky-500/10 rounded-2xl border border-sky-500/20 group-hover:scale-110 transition-transform">
              <Users className="w-6 h-6 text-sky-600" />
            </div>
            <div>
              <p className="text-slate-500 text-sm font-medium">Authorized Users</p>
              <h3 className="text-2xl font-bold text-slate-900 tracking-tight">{stats.activeUsers} Operators</h3>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm transition-all hover:shadow-md group">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-2xl border border-green-500/20 group-hover:scale-110 transition-transform">
              <Shield className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-slate-500 text-sm font-medium">System Integrity</p>
              <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Active & Secure</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-slate-800 tracking-tight">Connected Servers</h2>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 rounded-xl hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-all disabled:opacity-50"
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
              className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm transition-all hover:shadow-md hover:translate-y-[-4px] cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 bg-slate-100 rounded-2xl border border-slate-200 group-hover:bg-sky-500/10 group-hover:border-sky-500/30 transition-all">
                  <Server className="w-5 h-5 text-slate-400 group-hover:text-sky-600" />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Connected</span>
                </div>
              </div>

              <h4 className="text-base font-bold text-slate-800 mb-1 group-hover:text-sky-600 transition-colors uppercase tracking-tight">{server.name}</h4>
              <p className="text-xs text-slate-500 font-mono mb-4">{server.host}:{server.port}</p>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <span className="text-[10px] text-slate-400 font-medium">
                  {server.username} • Added {new Date(server.createdAt).toLocaleDateString()}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Audit Logs Section */}
      {userRole === 'admin' && (
        <div className="mt-8 mb-8 flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-sky-500/15 rounded-xl border border-sky-400/25">
                <List className="w-5 h-5 text-sky-600" />
              </div>
              <div>
                 <h2 className="text-lg font-bold text-slate-800 tracking-tight">Security Audit Trail</h2>
                 <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Immutable Access Logs</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-sky-500 transition-colors" />
                <input 
                  type="text" 
                  placeholder="Filter logs..." 
                  value={auditSearchTerm}
                  onChange={(e) => setAuditSearchTerm(e.target.value)}
                  className="w-64 bg-white border border-slate-200 text-slate-800 text-sm rounded-xl pl-9 pr-4 py-2 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 transition-all placeholder:text-slate-400 shadow-sm"
                />
              </div>
              <button 
                onClick={exportAuditLogs}
                disabled={auditLogs.length === 0}
                className="flex items-center gap-2 bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-slate-600 hover:text-sky-700 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed group shadow-sm"
              >
                <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
                Export CSV
              </button>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto custom-scrollbar max-h-[500px]">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="text-[10px] font-black uppercase tracking-[0.18em] bg-slate-50 text-slate-400 sticky top-0 z-10 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 cursor-pointer hover:text-sky-600 transition-colors" onClick={() => handleSort('timestamp')}>
                      <div className="flex items-center gap-1">Timestamp {sortConfig.key === 'timestamp' && (sortConfig.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-sky-600 transition-colors" onClick={() => handleSort('userEmail')}>
                      <div className="flex items-center gap-1">Operator {sortConfig.key === 'userEmail' && (sortConfig.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-sky-600 transition-colors" onClick={() => handleSort('serverName')}>
                      <div className="flex items-center gap-1">Server Node {sortConfig.key === 'serverName' && (sortConfig.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-sky-600 transition-colors" onClick={() => handleSort('logType')}>
                      <div className="flex items-center gap-1">Context {sortConfig.key === 'logType' && (sortConfig.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-sky-600 transition-colors" onClick={() => handleSort('sourceId')}>
                      <div className="flex items-center gap-1">Target Source {sortConfig.key === 'sourceId' && (sortConfig.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAuditLogs.length === 0 ? (
                     <tr>
                        <td colSpan={5} className="px-6 py-12">
                           <div className="flex flex-col items-center justify-center text-slate-400">
                              <Search className="w-8 h-8 mb-3 opacity-20" />
                              <span className="font-semibold text-sm">No audit records found</span>
                              {auditSearchTerm && <span className="text-xs mt-1">Try adjusting your filters</span>}
                           </div>
                        </td>
                     </tr>
                  ) : (
                    filteredAuditLogs.map((log) => {
                      const fixedTime = log.timestamp.includes('Z') ? log.timestamp : log.timestamp.replace(' ', 'T') + 'Z';
                      const date = new Date(fixedTime);
                      const isRoot = log.userEmail === 'root';
                      return (
                        <tr key={log.id} className="hover:bg-sky-50/60 transition-colors group">
                          <td className="px-6 py-3.5 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-slate-700 text-[13px] font-semibold">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                              <span className="text-slate-400 font-mono text-[10px]">{date.toLocaleTimeString()}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5">
                            <div className="flex items-center gap-2">
                               <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-inner ${isRoot ? 'bg-red-500' : 'bg-sky-500'}`}>
                                  {log.userEmail.substring(0, 2).toUpperCase()}
                               </div>
                               <span className={`font-semibold ${isRoot ? 'text-red-500' : 'text-sky-700'}`}>{log.userEmail}</span>
                            </div>
                          </td>
                          <td className="px-6 py-3.5">
                             <div className="flex items-center gap-2">
                                <Server className="w-3.5 h-3.5 text-slate-400" />
                                <span className="font-medium text-slate-700">{log.serverName}</span>
                             </div>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                               {log.logType === 'docker' && <Box className="w-3 h-3 text-blue-400" />}
                               {log.logType === 'k8s' && <Cloud className="w-3 h-3 text-sky-500" />}
                               {log.logType === 'database' && <Database className="w-3 h-3 text-yellow-400" />}
                               {log.logType === 'system' && <Settings className="w-3 h-3 text-slate-500" />}
                               {log.logType === 'auth' && <Shield className="w-3 h-3 text-red-400" />}
                               {!['docker','k8s','database','system','auth'].includes(log.logType) && <Activity className="w-3 h-3 text-slate-400" />}
                               {log.logType}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 font-mono text-xs text-slate-500 max-w-[250px] truncate group-hover:text-sky-700 transition-colors" title={log.sourceId}>
                             {log.sourceId}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
