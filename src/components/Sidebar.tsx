"use client";

import React, { useEffect, useState } from 'react';
import { Server, Activity, Lock, Loader2, Plus, X, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound, ChevronRight, Trash2, Settings, RotateCw, Search, XCircle, LayoutDashboard, Users } from 'lucide-react';

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
  onSelect: (serverId: number, logType: string, sourceId: string) => void;
  onShowDashboard: () => void;
}


const defaultForm = { name: '', host: '', port: '22', username: '', privateKey: '' };

export default function Sidebar({ userRole, onSelect, onShowDashboard }: SidebarProps) {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [selectedServer, setSelectedServer] = useState<number | null>(null);
  const [logSources, setLogSources] = useState<LogSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);

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
    if (!selectedServer || !selectedType) { setLogSources([]); setSourceError(null); return; }
    setLoadingSources(true);
    setSourceError(null);
    fetch(`/api/servers/${selectedServer}/sources?type=${selectedType}`)
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
    if (!selectedServer || !selectedType) setSelectedSource(null);
  }, [selectedServer, selectedType]);

  const refreshSources = (e: React.MouseEvent) => {
    e.stopPropagation();
    fetchSources();
  };

  const handleServerChange = (id: number) => {
    setSelectedServer(id);
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
        setSelectedServer(null);
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

  const handleSourceSelect = (sourceId: string) => {
    setSelectedSource(sourceId);
    if (selectedServer && selectedType) onSelect(selectedServer, selectedType, sourceId);
  };

  const k8sNamespaces = selectedType === 'k8s' 
    ? Array.from(new Set(logSources.map(s => s.identifier.split('/')[0]))).sort()
    : [];

  const filteredSources = logSources.filter(source => {
    const matchesSearch = source.identifier.toLowerCase().includes(searchTerm.toLowerCase());
    if (selectedType === 'k8s' && selectedNamespace) {
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
            <select
              className="flex-1 bg-zinc-900/50 border border-zinc-700/50 text-white text-sm rounded-xl p-3 outline-none focus:border-purple-500 transition-colors cursor-pointer appearance-none"
              value={selectedServer || ""}
              onChange={(e) => handleServerChange(Number(e.target.value))}
            >
              <option value="" disabled>Choose a server...</option>
              {servers.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
              ))}
            </select>
            {selectedServer && userRole === 'admin' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleEditClick(selectedServer)}
                  className="p-3 rounded-xl border border-zinc-700/50 bg-zinc-900/50 text-zinc-500 hover:text-purple-400 hover:border-purple-500/30 transition-all flex items-center justify-center"
                  title="Edit server"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDelete === selectedServer) {
                      handleDeleteServer(selectedServer);
                    } else {
                      setConfirmDelete(selectedServer);
                    }
                  }}
                  className={`p-3 rounded-xl border transition-all flex items-center justify-center ${
                    confirmDelete === selectedServer
                      ? 'bg-red-500/20 border-red-500/50 text-red-400 font-bold text-[10px] uppercase min-w-[80px]'
                      : 'bg-zinc-900/50 border-zinc-700/50 text-zinc-500 hover:text-red-400 hover:border-red-500/30'
                  }`}
                  title={confirmDelete === selectedServer ? "Click to confirm deletion" : "Delete server"}
                >
                  {confirmDelete === selectedServer ? "Confirm" : <Trash2 className="w-4 h-4" />}
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

        {/* Step 2 — Log Type */}
        {selectedServer && (
          <div className="mb-6 flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              2. Select Log Application
            </label>
            <select
              className="w-full bg-zinc-900/50 border border-zinc-700/50 text-white text-sm rounded-xl p-3 outline-none focus:border-purple-500 transition-colors cursor-pointer appearance-none"
              value={selectedType || ""}
              onChange={(e) => { setSelectedType(e.target.value); setSelectedNamespace(null); }}
            >
              <option value="" disabled>Choose application...</option>
              <option value="nginx">NGINX (Web Server logs)</option>
              <option value="apache">Apache2 (Web Server logs)</option>
              <option value="docker">Docker Containers</option>
              <option value="k8s">Kubernetes Pods</option>
            </select>
          </div>
        )}

        {/* Step 3 — Log Source */}
        {selectedType && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                3. Select Target Log File / Pod
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
            {/* Step 3 Logic: K8s Namespace Selection vs Pod/Log Selection */}
            {selectedType === 'k8s' && !selectedNamespace && !loadingSources && !sourceError ? (
              <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                <label className="text-[10px] font-bold text-zinc-600 uppercase mb-1 ml-1 tracking-widest">Select Namespace</label>
                {k8sNamespaces.map(ns => (
                  <button
                    key={ns}
                    onClick={() => { setSelectedNamespace(ns); setSearchTerm(''); }}
                    className="w-full text-left text-sm px-4 py-3 rounded-xl border bg-zinc-800/20 border-zinc-700/30 text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                        <Activity className="w-4 h-4 text-blue-400" />
                      </div>
                      <span className="font-medium">{ns}</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded-md text-zinc-500">{logSources.filter(s => s.identifier.startsWith(ns + '/')).length} pods</span>
                       <ChevronRight className="w-4 h-4 text-zinc-600" />
                    </div>
                  </button>
                ))}
                {k8sNamespaces.length === 0 && (
                   <span className="text-zinc-600 text-xs text-center py-8 italic">No namespaces found</span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* Search & Back Header */}
                {!loadingSources && !sourceError && logSources.length > 0 && (
                  <div className="flex flex-col gap-2 mb-1">
                    {selectedNamespace && (
                      <button 
                        onClick={() => { setSelectedNamespace(null); setSelectedSource(null); setSearchTerm(''); }}
                        className="flex items-center gap-2 text-[10px] font-bold text-purple-400 hover:text-purple-300 uppercase tracking-widest transition-colors mb-1 ml-1 w-fit"
                      >
                        <ChevronRight className="w-3 h-3 rotate-180" />
                        Back to Namespaces
                      </button>
                    )}
                    
                    {/* Only show search for non-k8s or when k8s namespace is selected */}
                    {(selectedType !== 'k8s' || selectedNamespace) && (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                        <input
                          type="text"
                          placeholder={selectedNamespace ? `Search pods in ${selectedNamespace}...` : `Search ${selectedType}...`}
                          className="w-full bg-zinc-900/30 border border-zinc-700/30 text-white text-xs rounded-xl pl-9 pr-3 py-2.5 outline-none focus:border-purple-500/50 focus:bg-zinc-900/60 transition-all placeholder:text-zinc-600"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}

                {loadingSources ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 border border-white/5 rounded-xl bg-black/10">
                    <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                    <span className="text-xs text-zinc-500 font-medium">Scanning for {selectedType} logs...</span>
                  </div>
                ) : sourceError ? (
                  <div className="flex flex-col items-center gap-2 text-red-400 text-xs py-8 px-4 border border-red-500/10 rounded-xl bg-red-500/5 text-center">
                    <AlertCircle className="w-5 h-5 mb-1 opacity-80" />
                    <span className="font-bold uppercase tracking-widest text-[10px]">Discovery Failed</span>
                    <span className="text-zinc-500 leading-relaxed font-mono text-[11px] max-w-[200px] break-words">{sourceError}</span>
                    <button 
                      onClick={() => { setSelectedType(null); setSelectedNamespace(null); }}
                      className="mt-3 px-4 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all text-[11px] font-semibold"
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
                    {filteredSources.length === 0 && (
                      <div className="py-8 text-center border border-dashed border-zinc-800 rounded-xl">
                        <span className="text-zinc-600 text-xs">No items match your search</span>
                      </div>
                    )}
                    {filteredSources.map((source, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSourceSelect(source.identifier)}
                        className={`w-full text-left text-sm px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
                          selectedSource === source.identifier
                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                            : 'bg-zinc-800/20 border-zinc-700/30 text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {source.status && source.status !== 'file' && (
                            <div 
                              className={`w-1.5 h-1.5 rounded-full ${
                                 source.status.toLowerCase().includes('up') || source.status.toLowerCase().includes('running')
                                 ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                                 : 'bg-zinc-600'
                              }`}
                              title={`Status: ${source.status}`}
                            />
                          )}
                          <span className="truncate max-w-[180px]">
                            {selectedType === 'k8s' && source.identifier.includes('/') 
                              ? source.identifier.split('/')[1] 
                              : source.identifier}
                          </span>
                        </div>
                        {selectedSource === source.identifier && <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
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
          {/* Test Connection feedback */}
          {testResult && (
            <div className={`flex items-center gap-2 text-xs border rounded-xl px-3 py-2.5 ${
              testResult.success 
                ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span>{testResult.success ? 'Connection Successful!' : `Failed: ${testResult.error}`}</span>
            </div>
          )}

          {saveStatus === 'success' && (
            <div className="flex items-center gap-2 text-green-400 text-xs bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>Server added successfully!</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 mt-2">
            <button
              type="button"
              disabled={testing || saving || saveStatus === 'success'}
              onClick={handleTestConnection}
              className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition-all flex items-center justify-center gap-2 text-sm border border-white/5"
            >
              {testing ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</> : <><KeyRound className="w-4 h-4" /> Test Connection</>}
            </button>

            <button
              type="submit"
              disabled={saving || saveStatus === 'success'}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900/50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-all flex items-center justify-center gap-2 text-sm"
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {editingId ? 'Saving...' : 'Connecting...'}</>
              ) : saveStatus === 'success' ? (
                <><CheckCircle2 className="w-4 h-4" /> {editingId ? 'Updated!' : 'Added!'}</>
              ) : (
                <>{editingId ? <><Settings className="w-4 h-4" /> Save Changes</> : <><Plus className="w-4 h-4" /> Add Server</>}</>
              )}
            </button>
          </div>

          {/* Security note */}
          <div className="flex items-start gap-2 text-[10px] text-zinc-600 bg-white/3 border border-white/5 rounded-xl p-3">
            <Lock className="w-3 h-3 mt-0.5 flex-shrink-0 text-zinc-500" />
            <span>Connections use SSH key authentication. Your private key is encrypted with AES-256-GCM before being stored and never leaves this server.</span>
          </div>
        </form>
      </div>

      {/* User Management Panel */}
      <div className={`w-80 h-full absolute inset-0 flex flex-col bg-black/60 backdrop-blur-3xl border-r border-white/10 transition-transform duration-300 ${showUserPanel ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-500/20 rounded-xl border border-blue-500/30">
               <KeyRound className="w-5 h-5 text-blue-400" />
             </div>
             <h2 className="text-sm font-bold text-white">Manage Users</h2>
          </div>
          <button onClick={closeUserPanel} className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          <form onSubmit={handleAddUser} className="flex flex-col gap-3">
             <label className="text-[10px] font-bold text-zinc-500 uppercase">Add New Account</label>
             <input 
               value={userForm.email}
               onChange={e => setUserForm({...userForm, email: e.target.value})}
               placeholder="User identifier" 
               className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-blue-500" 
             />
             <input 
               type="password"
               value={userForm.password}
               onChange={e => setUserForm({...userForm, password: e.target.value})}
               placeholder="Password" 
               className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-xl px-3 py-2.5 outline-none focus:border-blue-500" 
             />
             <button disabled={userSaving} className="w-full bg-blue-600 py-2.5 rounded-xl text-white text-sm font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98]">
                {userSaving ? 'Adding...' : 'Create Account'}
             </button>
          </form>

          <div className="flex flex-col gap-3">
             <label className="text-[10px] font-bold text-zinc-500 uppercase">Existing Users</label>
             {users.map(u => (
               <div key={u.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl group">
                 <div className="flex flex-col">
                   <span className="text-sm text-white font-medium">{u.email}</span>
                   <span className="text-[10px] text-zinc-500">{u.role} • Joined {new Date(u.createdAt).toLocaleDateString()}</span>
                 </div>
                 <button onClick={() => handleDeleteUser(u.id)} className="p-2 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all">
                   <Trash2 className="w-4 h-4" />
                 </button>
               </div>
             ))}
          </div>
        </div>
      </div>
    </div>
  );
}
