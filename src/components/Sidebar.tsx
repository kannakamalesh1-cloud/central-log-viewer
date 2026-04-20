"use client";

import React, { useEffect, useState } from 'react';
import { Server, Activity, Lock, Loader2, Plus, X, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound, ChevronRight, Trash2, Settings, RotateCw, Search, XCircle, LayoutDashboard, Users, Box, Cloud, Shield, Database, ChevronDown } from 'lucide-react';

interface ServerData {
  id: number;
  name: string;
  host: string;
  username: string;
}

interface LogSource {
  type: string;
  identifier: string;
  status?: string | null;
}

interface UserData {
  id: number;
  email: string;
  role: string;
  createdAt: string;
}


interface SidebarProps {
  userRole: string;
  selectedServerId: number | null;
  setSelectedServerId: (id: number | null) => void;
  onSelect: (serverId: number, logType: string, sourceId: string) => void;
  onShowDashboard: () => void;
}


const defaultForm = { name: '', host: '', port: '22', username: '', privateKey: '' };

export default function Sidebar({ userRole, selectedServerId, setSelectedServerId, onSelect, onShowDashboard }: SidebarProps) {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [logSources, setLogSources] = useState<LogSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    system: false,
    auth: false,
    docker: false,
    k8s: false,
    nginx: false,
    apache: false,
    database: false,
    other: false
  });

  // Add Server Panel state
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  // User Management state
  const [users, setUsers] = useState<UserData[]>([]);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [userForm, setUserForm] = useState({ email: '', password: '', role: 'viewer' });
  const [userSaving, setUserSaving] = useState(false);

  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);

  const fetchServers = () => {
    fetch('/api/servers')
      .then(r => r.json())
      .then(data => setServers(data || []))
      .catch(console.error);
  };

  const fetchUsers = () => {
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setUsers(data);
        else setUsers([]);
      })
      .catch(err => {
        console.error('Fetch users error:', err);
        setUsers([]);
      });
  };

  useEffect(() => {
    fetchServers();
    if (userRole === 'admin') fetchUsers();
  }, [userRole]);

  const fetchSources = () => {
    if (!selectedServerId) { setLogSources([]); setSourceError(null); return; }
    setLoadingSources(true);
    setSourceError(null);
    fetch(`/api/servers/${selectedServerId}/sources`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setLogSources(data);
        } else {
          setLogSources([]);
          setSourceError(data.error || 'Failed to fetch sources');
        }
      })
      .catch(err => {
        setLogSources([]);
        setSourceError('Network error connecting to discovery API');
      })
      .finally(() => setLoadingSources(false));
  };

  useEffect(() => {
    fetchSources();
    if (!selectedServerId) {
      setSelectedSource(null);
      setSelectedType(null);
    }
  }, [selectedServerId]);

  const refreshSources = (e: React.MouseEvent) => {
    e.stopPropagation();
    fetchSources();
  };

  const handleServerChange = (id: number) => {
    setSelectedServerId(id);
    setSelectedType(null);
    setSelectedNamespace(null);
    setSelectedSource(null);
    setLogSources([]);
    setConfirmDelete(null);
  };

  const handleDeleteServer = async (id: number) => {
    try {
      const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmDelete(null);
        setSelectedServerId(null);
        setSelectedType(null);
        setSelectedSource(null);
        setLogSources([]);
        fetchServers();
      }
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const handleEditClick = async (id: number) => {
    setLoadingSources(true); // Reuse loader while fetching info
    setSaveStatus('idle');
    setSaveError('');
    try {
      const res = await fetch(`/api/servers/${id}`);
      if (res.ok) {
        const data = await res.json();
        setForm({
          name: data.name || '',
          host: data.host || '',
          port: data.port?.toString() || '22',
          username: data.username || '',
          privateKey: data.privateKey || '',
        });
        setEditingId(id);
        setShowAddPanel(true);
      }
    } catch (e) {
      console.error('Failed to fetch server details', e);
    } finally {
      setLoadingSources(false);
    }
  };

  const handleSourceSelect = (sourceId: string, type: string) => {
    setSelectedSource(sourceId);
    setSelectedType(type);
    if (selectedServerId) onSelect(selectedServerId, type, sourceId);
  };

  const filteredSources = logSources.filter(source => {
    const matchesSearch = source.identifier.toLowerCase().includes(searchTerm.toLowerCase());
    if (source.type === 'k8s' && selectedNamespace) {
      return matchesSearch && source.identifier.startsWith(selectedNamespace + '/');
    }
    return matchesSearch;
  });

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    if (saveStatus !== 'idle') setSaveStatus('idle');
  };

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.host || !form.username || !form.privateKey) {
      setSaveStatus('error');
      setSaveError('All fields are required.');
      return;
    }
    setSaving(true);
    setSaveStatus('idle');
    try {
      const url = editingId ? `/api/servers/${editingId}` : '/api/servers';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          host: form.host,
          port: parseInt(form.port) || 22,
          username: form.username,
          privateKey: form.privateKey,
        }),
      });
      if (res.ok) {
        setSaveStatus('success');
        setForm(defaultForm);
        setEditingId(null);
        fetchServers();
        setTimeout(() => { setShowAddPanel(false); setSaveStatus('idle'); }, 1800);
      } else {
        const data = await res.json();
        setSaveError(data.error || `Failed to ${editingId ? 'update' : 'add'} server.`);
        setSaveStatus('error');
      }
    } catch {
      setSaveError('Network error. Is the server running?');
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!form.host || !form.username || !form.privateKey) {
      setTestResult({ success: false, error: 'Host, user, and key are required for testing.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host,
          port: parseInt(form.port) || 22,
          username: form.username,
          privateKey: form.privateKey,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ success: false, error: 'Network error during test.' });
    } finally {
      setTesting(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.email || !userForm.password) return;
    setUserSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm),
      });
      if (res.ok) {
        setUserForm({ email: '', password: '', role: 'viewer' });
        fetchUsers();
      }
    } finally {
      setUserSaving(false);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm('Are you sure you want to remove this user?')) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) fetchUsers();
      else {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
      }
    } catch (e) { console.error(e); }
  };

  const openPanel = () => {
    setForm(defaultForm);
    setEditingId(null);
    setSaveStatus('idle');
    setSaveError('');
    setTestResult(null);
    setShowAddPanel(true);
    setShowUserPanel(false);
  };
  const closePanel = () => {
    setShowAddPanel(false);
    setEditingId(null);
    setSaveStatus('idle');
    setTestResult(null);
  };
  const openUserPanel = () => { setShowUserPanel(true); setShowAddPanel(false); };
  const closeUserPanel = () => { setShowUserPanel(false); };

  const toggleSection = (type: string) => {
    setExpandedSections(prev => ({ ...prev, [type]: !prev[type] }));
  };


  return (
    <div className="relative w-80 h-full flex-shrink-0 overflow-hidden">
      {/* Main Sidebar */}
      <div className={`w-80 h-full flex flex-col bg-white/5 dark:bg-black/30 backdrop-blur-xl border-r border-white/10 dark:border-zinc-800 p-6 overflow-y-auto transition-transform duration-300 ${showAddPanel ? '-translate-x-full' : 'translate-x-0'} absolute inset-0`}>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3 text-white">
            <div className="p-2.5 bg-purple-500/20 rounded-xl border border-purple-500/30">
              <Activity className="w-5 h-5 text-purple-400" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-blue-400">
              PulseLog
            </h1>
          </div>
          <div className="flex gap-2">
            {userRole === 'admin' && (
              <>
                <button
                  onClick={openUserPanel}
                  title="User Management"
                  className="p-2 rounded-xl bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/40 text-blue-400 hover:text-blue-300 transition-all font-semibold text-xs flex items-center gap-1.5"
                >
                  <KeyRound className="w-4 h-4" /> Users
                </button>
                <button
                  onClick={openPanel}
                  title="Add Server"
                  className="p-2 rounded-xl bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/40 text-purple-400 hover:text-purple-300 transition-all"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        <button
          onClick={onShowDashboard}
          className="mb-8 w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white transition-all group shadow-inner"
        >
          <LayoutDashboard className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-semibold">Dashboard Overview</span>
        </button>

        {/* Step 1 — Server */}
        <div className="mb-6 flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            1. Select Target Server
          </label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <button
                onClick={() => setIsServerDropdownOpen(!isServerDropdownOpen)}
                className={`w-full flex items-center justify-between bg-zinc-900/80 border text-white text-sm rounded-xl p-3.5 transition-all shadow-2xl backdrop-blur-xl hover:bg-zinc-800/80 ${isServerDropdownOpen ? 'border-purple-500 ring-2 ring-purple-500/10' : 'border-white/10'
                  }`}
              >
                <span className="font-medium truncate max-w-[150px]">
                  {selectedServerId ? (
                    servers.find(s => s.id === selectedServerId)?.name || "Server Selected"
                  ) : "Choose server..."}
                </span>
                <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform ${isServerDropdownOpen ? 'rotate-90' : 'rotate-0'}`} />
              </button>

              {isServerDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900/95 border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] py-2 z-[100] max-h-[300px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-3xl custom-scrollbar border-t-white/20">
                  {servers.length === 0 ? (
                    <div className="px-4 py-3 text-[11px] text-zinc-500 italic">No servers configured</div>
                  ) : (
                    servers.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { handleServerChange(s.id); setIsServerDropdownOpen(false); }}
                        className={`w-full text-left px-4 py-2 text-sm transition-all flex items-center gap-3 hover:bg-white/5 ${selectedServerId === s.id ? 'text-purple-400 bg-purple-500/5' : 'text-zinc-300'}`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors ${selectedServerId === s.id ? 'bg-purple-500/10 border-purple-500/20' : 'bg-black/20 border-white/5 group-hover:border-white/10'}`}>
                          <Server className={`w-4 h-4 ${selectedServerId === s.id ? 'text-purple-400' : 'text-zinc-500'}`} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold truncate leading-none">{s.name}</span>
                          <span className="text-[10px] text-zinc-500 font-mono mt-1 opacity-70 truncate">{s.host}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedServerId && userRole === 'admin' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleEditClick(selectedServerId)}
                  className="p-3 rounded-xl border border-zinc-700/50 bg-zinc-900/50 text-zinc-500 hover:text-purple-400 hover:border-purple-500/30 transition-all flex items-center justify-center"
                  title="Edit server"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDelete === selectedServerId) {
                      handleDeleteServer(selectedServerId);
                    } else {
                      setConfirmDelete(selectedServerId);
                    }
                  }}
                  className={`p-3 rounded-xl border transition-all flex items-center justify-center ${confirmDelete === selectedServerId
                    ? 'bg-red-500/20 border-red-500/50 text-red-400 font-bold text-[10px] uppercase min-w-[80px]'
                    : 'bg-zinc-900/50 border-zinc-700/50 text-zinc-500 hover:text-red-400 hover:border-red-500/30'
                    }`}
                  title={confirmDelete === selectedServerId ? "Click to confirm deletion" : "Delete server"}
                >
                  {confirmDelete === selectedServerId ? "Confirm" : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
          {servers.length === 0 && (
            <button
              onClick={openPanel}
              className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 mt-1 ml-1 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add your first server
            </button>
          )}
        </div>

        {/* Step 2 — Unified Log Selection */}
        {selectedServerId && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                2. Select Log Target
              </label>
              <button
                onClick={refreshSources}
                disabled={loadingSources}
                className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-purple-400 transition-all disabled:opacity-50"
                title="Refresh list"
              >
                <RotateCw className={`w-3.5 h-3.5 ${loadingSources ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Search Bar */}
            {!loadingSources && !sourceError && logSources.length > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search logs, containers, pods..."
                  className="w-full bg-zinc-900/30 border border-zinc-700/30 text-white text-xs rounded-xl pl-9 pr-3 py-2.5 outline-none focus:border-purple-500/50 focus:bg-zinc-900/60 transition-all placeholder:text-zinc-600"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            )}

            {loadingSources ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 border border-white/5 rounded-xl bg-black/10">
                <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                <span className="text-xs text-zinc-500 font-medium">Scanning server for logs...</span>
              </div>
            ) : sourceError ? (
              <div className="flex flex-col items-center gap-2 text-red-400 text-xs py-8 px-4 border border-red-500/10 rounded-xl bg-red-500/5 text-center">
                <AlertCircle className="w-5 h-5 mb-1 opacity-80" />
                <span className="font-bold uppercase tracking-widest text-[10px]">Discovery Failed</span>
                <span className="text-zinc-500 leading-relaxed font-mono text-[11px] max-w-[200px] break-words">{sourceError}</span>
                <button
                  onClick={fetchSources}
                  className="mt-3 px-4 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all text-[11px] font-semibold"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar pb-10">
                {logSources.length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-zinc-800 rounded-xl">
                    <span className="text-zinc-600 text-xs">No logs discovered on this server</span>
                  </div>
                ) : (
                  <>
                    {(() => {
                      const groups = filteredSources.reduce((acc, s) => {
                        const type = s.type || 'other';
                        if (!acc[type]) acc[type] = [];
                        acc[type].push(s);
                        return acc;
                      }, {} as Record<string, LogSource[]>);

                      const typeConfig: Record<string, { label: string, icon: any, color: string }> = {
                        docker: { label: 'Docker Containers', icon: Box, color: 'text-blue-400' },
                        k8s: { label: 'Kubernetes Pods', icon: Cloud, color: 'text-cyan-400' },
                        nginx: { label: 'NGINX Logs', icon: Activity, color: 'text-emerald-400' },
                        apache: { label: 'Apache2 Logs', icon: Activity, color: 'text-orange-400' },
                        system: { label: 'Core System', icon: Settings, color: 'text-zinc-400' },
                        auth: { label: 'Security Logs', icon: Shield, color: 'text-red-400' },
                        database: { label: 'Database Logs', icon: Database, color: 'text-yellow-400' },
                        other: { label: 'Other Logs', icon: Activity, color: 'text-zinc-500' }
                      };

                      const sortedTypes = Object.keys(groups).sort((a, b) => {
                        const order = ['system', 'auth', 'docker', 'k8s', 'nginx', 'apache', 'database'];
                        const idxA = order.indexOf(a);
                        const idxB = order.indexOf(b);
                        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                        if (idxA === -1) return 1;
                        if (idxB === -1) return -1;
                        return idxA - idxB;
                      });

                      const sections = sortedTypes.map(type => {
                        const config = typeConfig[type] || typeConfig.other;
                        const Icon = config.icon;
                        const sources = groups[type];
                        const isExpanded = expandedSections[type];

                        if (type === 'k8s' && !selectedNamespace && !searchTerm) {
                          const namespaces = Array.from(new Set(sources.map(s => s.identifier.split('/')[0]))).sort();
                          return (
                            <div key={type} className="flex flex-col gap-1 mb-1">
                              <div
                                onClick={() => toggleSection(type)}
                                className="flex items-center justify-between w-full px-1 py-3 group hover:bg-white/5 rounded-xl transition-all cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-1.5 h-3.5 bg-cyan-500 rounded-full transition-transform group-hover:scale-y-125`} />
                                  <span className="text-[11px] font-black text-zinc-500 uppercase tracking-widest leading-none">{config.label}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <ChevronDown className={`w-3.5 h-3.5 text-zinc-700 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="flex flex-col gap-1.5 pl-1.5 animate-in slide-in-from-top-1 duration-200">
                                  {namespaces.map(ns => (
                                    <button
                                      key={ns}
                                      onClick={() => setSelectedNamespace(ns)}
                                      className="w-full text-left text-[12px] px-3 py-3 rounded-xl border bg-white/[0.02] border-white/5 text-zinc-300 hover:bg-white/[0.05] hover:text-white transition-all flex items-center justify-between group"
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <Cloud className="w-4 h-4 text-cyan-500/60" />
                                        <span className="font-bold">{ns}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-500 font-bold">{sources.filter(s => s.identifier.startsWith(ns + '/')).length}</span>
                                        <ChevronRight className="w-3.5 h-3.5 text-zinc-700" />
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }

                        const displaySources = (type === 'k8s' && selectedNamespace && !searchTerm)
                          ? sources.filter(s => s.identifier.startsWith(selectedNamespace + '/'))
                          : sources;

                        if (displaySources.length === 0) return null;

                        return (
                          <div key={type} className="flex flex-col gap-1 mb-1">
                            <div
                              onClick={() => toggleSection(type)}
                              className="flex items-center justify-between w-full px-1 py-3 group hover:bg-white/5 rounded-xl transition-all cursor-pointer"
                            >
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-2">
                                  <div className={`w-1.5 h-3.5 bg-white/20 rounded-full transition-transform group-hover:scale-y-125`} style={{ backgroundColor: config.color.includes('text-') ? undefined : config.color }} />
                                  <span className="text-[11px] font-black text-zinc-500 uppercase tracking-widest leading-none">{config.label}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  {type === 'k8s' && selectedNamespace && !searchTerm && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setSelectedNamespace(null); }}
                                      className="text-[10px] font-bold text-cyan-500 hover:text-cyan-400 uppercase tracking-tighter"
                                    >
                                      Close {selectedNamespace}
                                    </button>
                                  )}
                                  <ChevronDown className={`w-3.5 h-3.5 text-zinc-700 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="flex flex-col gap-1.5 pl-1.5 animate-in slide-in-from-top-1 duration-200">
                                {displaySources.map((source, idx) => {
                                  let displayName = source.identifier;
                                  let suffix = '';
                                  if (type === 'k8s') {
                                    const nameOnly = source.identifier.split('/')[1] || source.identifier;
                                    const parts = nameOnly.split('-');
                                    if (parts.length > 2) {
                                      suffix = '-' + parts.pop() + '-' + parts.pop();
                                      displayName = nameOnly.replace(suffix, '');
                                    } else {
                                      displayName = nameOnly;
                                    }
                                  }

                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => handleSourceSelect(source.identifier, source.type)}
                                      className={`group w-full text-left px-3 py-3 rounded-xl border transition-all flex items-center justify-between ${selectedSource === source.identifier
                                        ? 'bg-purple-600/15 border-purple-500/40 text-white shadow-lg shadow-purple-500/5'
                                        : 'bg-white/[0.02] border-white/5 text-zinc-300 hover:bg-white/[0.05] hover:text-white hover:border-white/10'
                                        }`}
                                    >
                                      <div className="flex items-center gap-3.5 min-w-0">
                                        <div className={`p-2 rounded-lg border transition-colors ${selectedSource === source.identifier
                                          ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                                          : `bg-black/40 border-white/5 ${config.color} opacity-60 group-hover:opacity-100`
                                          }`}>
                                          <Icon className="w-4 h-4" />
                                        </div>

                                        <div className="flex flex-col min-w-0">
                                          <div className="flex items-center gap-2.5">
                                            <span className="font-bold truncate text-[13.5px] leading-tight tracking-tight font-sans">
                                              {displayName}
                                            </span>
                                            {(() => {
                                              const status = source.status?.toLowerCase() || '';
                                              // More flexible check for active states (including files)
                                              const isLive = /running|up|active|security|healthy/i.test(status);
                                              if (!isLive) return null;

                                              return (
                                                <div className="relative flex items-center gap-2">
                                                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.9)] animate-pulse" />
                                                  <span className="text-[9px] font-black text-green-500 uppercase tracking-widest">Live</span>
                                                </div>
                                              );
                                            })()}
                                          </div>
                                          {suffix && (
                                            <span className="text-[10px] text-zinc-600 font-mono truncate opacity-60 mt-0.5">
                                              {suffix.startsWith('-') ? suffix.substring(1) : suffix}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {selectedSource === source.identifier ? (
                                        <Activity className="w-4 h-4 text-purple-400 animate-pulse" />
                                      ) : (
                                        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      });

                      return (
                        <>
                          {sections}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-auto pt-6 text-xs text-zinc-600 flex items-center justify-center gap-2">
          <Lock className="w-3 h-3" />
          Stream is purely transient and secure.
        </div>
      </div>

      {/* Add Server Panel (slides in from right) */}
      <div className={`w-80 h-full absolute inset-0 flex flex-col bg-black/60 backdrop-blur-2xl border-r border-white/10 transition-transform duration-300 ${showAddPanel ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Panel Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-xl border border-purple-500/30">
              {editingId ? <Settings className="w-5 h-5 text-purple-400" /> : <Server className="w-5 h-5 text-purple-400" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{editingId ? 'Edit Server' : 'Add Server'}</h2>
              <p className="text-xs text-zinc-500">{editingId ? 'Updating configuration' : 'SSH key authentication'}</p>
            </div>
          </div>
          <button
            onClick={closePanel}
            className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500 hover:text-white transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleAddServer} className="flex flex-col gap-4 p-6 overflow-y-auto flex-1">

          {/* Server Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Server Name</label>
            <input
              name="name"
              value={form.name}
              onChange={handleFormChange}
              placeholder="e.g. Production Web"
              className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-purple-500 transition-colors placeholder:text-zinc-600"
            />
          </div>

          {/* Host */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">IP Address / Hostname</label>
            <input
              name="host"
              value={form.host}
              onChange={handleFormChange}
              placeholder="e.g. 192.168.1.100 or server.com"
              className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-purple-500 transition-colors placeholder:text-zinc-600 font-mono"
            />
          </div>

          {/* Port + Username row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">SSH Port</label>
              <input
                name="port"
                value={form.port}
                onChange={handleFormChange}
                placeholder="22"
                type="number"
                min="1"
                max="65535"
                className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-purple-500 transition-colors placeholder:text-zinc-600 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">SSH User</label>
              <input
                name="username"
                value={form.username}
                onChange={handleFormChange}
                placeholder="ubuntu"
                className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-purple-500 transition-colors placeholder:text-zinc-600 font-mono"
              />
            </div>
          </div>

          {/* Private Key */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" /> Private Key
              </label>
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="text-xs text-zinc-500 hover:text-purple-400 flex items-center gap-1 transition-colors"
              >
                {showKey ? <><EyeOff className="w-3 h-3" /> Hide</> : <><Eye className="w-3 h-3" /> Show</>}
              </button>
            </div>
            <textarea
              name="privateKey"
              value={form.privateKey}
              onChange={handleFormChange}
              placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
              rows={6}
              className={`w-full bg-black/40 border border-white/10 text-white text-xs rounded-xl px-3 py-2.5 outline-none focus:border-purple-500 transition-colors placeholder:text-zinc-600 font-mono resize-none leading-relaxed ${!showKey ? 'text-security-disc' : ''}`}
              style={!showKey ? { WebkitTextSecurity: 'disc' } as React.CSSProperties : {}}
            />
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              Paste the contents of your <span className="text-zinc-500 font-mono">~/.ssh/id_ed25519</span> private key. It will be AES-256 encrypted before storage.
            </p>
          </div>

          {/* Status Messages */}
          {saveStatus === 'error' && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          {saveStatus === 'success' && (
            <div className="flex items-center gap-2 text-green-400 text-xs bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>Server {editingId ? 'updated' : 'added'} successfully!</span>
            </div>
          )}

          {/* Test Button */}
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || saving}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all text-xs font-bold disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            Test Connection
          </button>

          {testResult && (
            <div className={`text-[10px] px-3 py-2 rounded-lg border flex flex-col gap-1 ${testResult.success ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                {testResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {testResult.success ? 'Test Successful' : 'Test Failed'}
              </div>
              {!testResult.success && <span className="font-mono opacity-80 break-words">{testResult.error}</span>}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={saving}
            className="mt-2 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-purple-500/20 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {editingId ? 'Update Server' : 'Save Server'}
          </button>
        </form>
      </div>

      {/* User Management Panel */}
      <div className={`w-80 h-full absolute inset-0 flex flex-col bg-black/60 backdrop-blur-2xl border-r border-white/10 transition-transform duration-300 ${showUserPanel ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-xl border border-blue-500/30">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">User Access</h2>
              <p className="text-xs text-zinc-500">Manage team permissions</p>
            </div>
          </div>
          <button onClick={closeUserPanel} className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          <form onSubmit={handleAddUser} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Email Address</label>
              <input
                type="email"
                required
                value={userForm.email}
                onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-blue-500"
                placeholder="user@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Password</label>
              <input
                type="password"
                required
                value={userForm.password}
                onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-blue-500"
                placeholder="••••••••"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Role</label>
              <select
                value={userForm.role}
                onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-blue-500"
              >
                <option value="viewer">Viewer (Read Only)</option>
                <option value="admin">Admin (Full Control)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={userSaving}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {userSaving ? 'Adding...' : 'Add User'}
            </button>
          </form>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest px-1">Active Users</h3>
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 group">
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-white truncate">{u.email}</span>
                  <span className={`text-[9px] uppercase font-black tracking-tighter ${u.role === 'admin' ? 'text-purple-400' : 'text-zinc-500'}`}>{u.role}</span>
                </div>
                {u.role !== 'admin' && (
                  <button
                    onClick={() => handleDeleteUser(u.id)}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
