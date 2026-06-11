"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { Server, Activity, Lock, Loader2, Plus, X, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound, ChevronRight, Trash2, Settings, RotateCw, Search, XCircle, LayoutDashboard, Users, Box, Cloud, Shield, Database, ChevronDown, HelpCircle, BookOpen, Globe, Info, Download, Cpu, HardDrive, Monitor, Clock, Terminal as TerminalIcon, Zap, Copy, Check, Folder, FolderOpen, Layers, Sparkles } from 'lucide-react';

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
  isOnline?: boolean;
}


interface SidebarProps {
  userRole: string;
  currentUserEmail: string;
  selectedServerId: number | null;
  setSelectedServerId: (id: number | null) => void;
  activeSourceId: string | null;
  onSelect: (serverId: number, logType: string, sourceId: string, serverName: string) => void;
  onShowDashboard: () => void;
}


const defaultForm = { name: '', host: '', port: '22', username: '', privateKey: '' };

export default function Sidebar({ userRole, currentUserEmail, selectedServerId, setSelectedServerId, activeSourceId, onSelect, onShowDashboard }: SidebarProps) {
  const router = useRouter();
  const [servers, setServers] = useState<ServerData[]>([]);
  const [logSources, setLogSources] = useState<LogSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [serverSearchTerm, setServerSearchTerm] = useState('');
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
  const [showGuide, setShowGuide] = useState(false);

  // Quick Setup / Master Key states
  const [activeTab, setActiveTab] = useState<'quick' | 'manual'>('quick');
  const [setupToken, setSetupToken] = useState('');
  const [copied, setCopied] = useState(false);

  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);
  const [isAdminDropdownOpen, setIsAdminDropdownOpen] = useState(false);

  // Expanded accordion state for K8s pods / Docker containers in the source list
  const [expandedSourceItems, setExpandedSourceItems] = useState<Record<string, boolean>>({});
  const toggleSourceItem = (key: string) =>
    setExpandedSourceItems(prev => ({ ...prev, [key]: !prev[key] }));

  // Sub-logs fetched per pod/container: key → LogSource[]
  const [subLogs, setSubLogs] = useState<Record<string, { type: string; identifier: string; status: string | null }[]>>({});
  const [loadingSubLogs, setLoadingSubLogs] = useState<Record<string, boolean>>({});

  const fetchSubLogs = async (type: 'k8s' | 'docker', key: string) => {
    if (subLogs[key] !== undefined || loadingSubLogs[key]) return; // already fetched
    setLoadingSubLogs(prev => ({ ...prev, [key]: true }));
    try {
      if (type === 'k8s') {
        const res = await fetch(`/api/servers/${selectedServerId}/pod-files?pod=${encodeURIComponent(key)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setSubLogs(prev => ({ ...prev, [key]: data }));
        }
      } else {
        const res = await fetch(`/api/servers/${selectedServerId}/container-files?container=${encodeURIComponent(key)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setSubLogs(prev => ({ ...prev, [key]: data }));
        }
      }
    } catch { }
    finally { setLoadingSubLogs(prev => ({ ...prev, [key]: false })); }
  };

  // Server Groups state
  interface ServerGroup { id: number; name: string; description: string; servers: { id: number; name: string; host: string }[]; }
  const [serverGroups, setServerGroups] = useState<ServerGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: '', description: '', serverIds: [] as number[] });
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupSaveMsg, setGroupSaveMsg] = useState<'ok' | 'err' | null>(null);
  const [allServersForGroup, setAllServersForGroup] = useState<{ id: number; name: string; host: string }[]>([]);
  const [groupServerSearchTerm, setGroupServerSearchTerm] = useState('');

  // Keep a stable ref to selectedServerId so the socket effect never needs to re-run
  const selectedServerIdRef = useRef<number | null>(selectedServerId);
  useEffect(() => { selectedServerIdRef.current = selectedServerId; }, [selectedServerId]);

  const serversRef = useRef<ServerData[]>(servers);
  useEffect(() => { serversRef.current = servers; }, [servers]);

  // Drag to scroll state
  const scrollRef = useRef<HTMLDivElement>(null);
  const adminDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (adminDropdownRef.current && !adminDropdownRef.current.contains(e.target as Node)) {
        setIsAdminDropdownOpen(false);
      }
    };
    if (isAdminDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isAdminDropdownOpen]);

  const [isGrabDragging, setIsGrabDragging] = useState(false);
  const [grabStartY, setGrabStartY] = useState(0);
  const [grabScrollTop, setGrabScrollTop] = useState(0);

  const handleGrabMouseDown = (e: React.MouseEvent) => {
    // Only drag if clicking the background, not buttons or inputs
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;

    if (!scrollRef.current) return;
    setIsGrabDragging(true);
    setGrabStartY(e.pageY - scrollRef.current.offsetTop);
    setGrabScrollTop(scrollRef.current.scrollTop);
  };

  const handleGrabMouseMove = (e: React.MouseEvent) => {
    if (!isGrabDragging || !scrollRef.current) return;
    e.preventDefault();
    const y = e.pageY - scrollRef.current.offsetTop;
    const walk = (y - grabStartY) * 1.5;
    scrollRef.current.scrollTop = grabScrollTop - walk;
  };

  const handleGrabMouseUp = () => {
    setIsGrabDragging(false);
  };

  const fetchServers = () => {
    fetch('/api/servers')
      .then(r => r.json())
      .then(data => setServers(data || []))
      .catch(console.error);
    // Also fetch grouped structure for the dropdown
    fetch('/api/groups/with-servers')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setServerGroups(data); })
      .catch(console.error);
  };

  const fetchAllServersForGroup = () => {
    fetch('/api/servers')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAllServersForGroup(data); })
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

  useEffect(() => {
    if (showUserPanel && userRole === 'admin') {
      fetchUsers();
      const interval = setInterval(fetchUsers, 5000);
      return () => clearInterval(interval);
    }
  }, [showUserPanel, userRole]);

  useEffect(() => {
    if (showAddPanel && userRole === 'admin' && !editingId) {
      fetch('/api/setup/token')
        .then(res => res.json())
        .then(data => {
          if (data.token) setSetupToken(data.token);
        })
        .catch(err => console.error('Failed to fetch setup token:', err));
    } else if (!showAddPanel) {
      setSetupToken('');
      setCopied(false);
    }
  }, [showAddPanel, userRole, editingId]);

  // useCallback with no deps: reads serverId from ref so the socket's stable closure always gets the latest value
  const fetchSources = useCallback(() => {
    const serverId = selectedServerIdRef.current;
    if (!serverId) { setLogSources([]); setSourceError(null); return; }
    setLoadingSources(true);
    setSourceError(null);
    fetch(`/api/servers/${serverId}/sources`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Stable reference — reads server from ref, not closure

  useEffect(() => {
    fetchSources();
    if (!selectedServerId) {
      setSelectedSource(null);
      setSelectedType(null);
    }
  }, [selectedServerId]);

  // Socket for real-time status updates — created ONCE, uses ref so it never reconnects on server change
  useEffect(() => {
    const socket = io({ path: '/socket.io' });

    socket.on('docker_event', (event: any) => {
      // Read the latest serverId via ref — no stale closure, no socket reconnect needed
      const currentId = selectedServerIdRef.current;
      if (currentId) {
        const currentServer = serversRef.current.find((s: any) => s.id === currentId);
        const isLocal = currentServer && (
          currentServer.host === 'localhost' ||
          currentServer.host === '127.0.0.1' ||
          currentServer.host === 'local' ||
          currentServer.host === '::1'
        );
        if (isLocal) {
          console.log('Real-time Docker event received for local system:', event.action, event.name);
          fetchSources();
        }
      }
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps: socket is intentionally created only once

  // Sync selectedSource with prop from parent
  useEffect(() => {
    if (activeSourceId) setSelectedSource(activeSourceId);
  }, [activeSourceId]);

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
    if (selectedServerId) {
      const srv = servers.find(s => s.id === selectedServerId);
      onSelect(selectedServerId, type, sourceId, srv?.name || 'Server');
    }
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
    if (!userForm.email) return;
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

  const handleDeleteUser = async (user: UserData) => {
    const isCurrent = user.email.toLowerCase() === currentUserEmail.toLowerCase();
    if (isCurrent) {
      alert('Security Alert: You cannot delete your own currently logged-in account.');
      return;
    }

    // First confirmation
    const firstConfirm = confirm(`Are you sure you want to remove user "${user.email}"?`);
    if (!firstConfirm) return;

    // Second confirmation if they are an admin
    if (user.role === 'admin') {
      const secondConfirm = confirm(`[CRITICAL ACTION] "${user.email}" is an ADMINISTRATOR. Deleting this user will remove all of their administrative privileges. Are you absolutely certain you want to proceed?`);
      if (!secondConfirm) return;
    }

    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
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
  const openUserPanel = () => { setShowUserPanel(true); setShowAddPanel(false); setShowGroupPanel(false); };
  const closeUserPanel = () => { setShowUserPanel(false); };

  const openGroupPanel = () => {
    setGroupForm({ name: '', description: '', serverIds: [] });
    setEditingGroupId(null);
    setGroupSaveMsg(null);
    setGroupServerSearchTerm('');
    setShowGroupPanel(true);
    setShowAddPanel(false);
    setShowUserPanel(false);
    fetchAllServersForGroup();
  };
  const closeGroupPanel = () => {
    setShowGroupPanel(false);
    setEditingGroupId(null);
    setGroupSaveMsg(null);
    setGroupServerSearchTerm('');
  };

  useEffect(() => {
    if (serverGroups.length > 0) {
      setExpandedGroups(prev => {
        const next = { ...prev };
        serverGroups.forEach((g: any) => {
          if (next[g.id] === undefined) {
            next[g.id] = true;
          }
        });
        if (next[-1] === undefined) {
          next[-1] = true;
        }
        return next;
      });
    }
  }, [serverGroups]);

  const handleGroupFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name) return;
    setGroupSaving(true);
    setGroupSaveMsg(null);
    try {
      const url = editingGroupId ? `/api/groups/${editingGroupId}` : '/api/groups';
      const method = editingGroupId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupForm)
      });
      if (res.ok) {
        setGroupSaveMsg('ok');
        setGroupForm({ name: '', description: '', serverIds: [] });
        setEditingGroupId(null);
        fetchServers();
        setTimeout(() => setGroupSaveMsg(null), 2500);
      } else {
        setGroupSaveMsg('err');
      }
    } catch {
      setGroupSaveMsg('err');
    } finally {
      setGroupSaving(false);
    }
  };

  const handleEditGroupClick = (group: any) => {
    setEditingGroupId(group.id);
    setGroupForm({
      name: group.name,
      description: group.description || '',
      serverIds: group.servers.map((s: any) => s.id)
    });
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (!confirm('Are you sure you want to delete this group? Servers in this group will not be deleted, they will simply be ungrouped.')) return;
    try {
      const res = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchServers();
      }
    } catch (e) {
      console.error('Delete group failed', e);
    }
  };

  const toggleGroupServerSelection = (serverId: number) => {
    setGroupForm(prev => {
      const alreadyChecked = prev.serverIds.includes(serverId);
      const newIds = alreadyChecked
        ? prev.serverIds.filter(id => id !== serverId)
        : [...prev.serverIds, serverId];
      return { ...prev, serverIds: newIds };
    });
  };

  const toggleSection = (type: string) => {
    setExpandedSections(prev => ({ ...prev, [type]: !prev[type] }));
  };


  return (
    <div className={`relative w-80 h-full flex-shrink-0 overflow-hidden select-none`}>
      {/* Main Sidebar */}
      <div
        ref={scrollRef}
        onMouseDown={handleGrabMouseDown}
        onMouseMove={handleGrabMouseMove}
        onMouseUp={handleGrabMouseUp}
        onMouseLeave={handleGrabMouseUp}
        className={`w-80 h-full flex flex-col bg-slate-50 backdrop-blur-xl border-r border-slate-200 p-6 overflow-y-auto transition-transform duration-300 ${showAddPanel ? '-translate-x-full' : 'translate-x-0'} absolute inset-0 ${isGrabDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >

        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-sky-500/20 rounded-xl border border-sky-500/30 shadow-[0_0_15px_rgba(14,165,233,0.15)]">
              <Activity className="w-5 h-5 text-sky-600" />
            </div>
            <h1 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-sky-600 via-sky-500 to-sky-400 tracking-tight">
              PulseLog
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGuide(true)}
              title={`${userRole === 'admin' ? 'Admin' : 'User'} Guide`}
              className="p-1.5 rounded-xl bg-slate-100 border border-slate-200 hover:bg-sky-500/20 hover:border-sky-500/30 text-slate-500 hover:text-sky-600 transition-all shadow-inner"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            {userRole === 'admin' && (
              <div
                className="relative"
                ref={adminDropdownRef}
              >
                <button
                  onClick={() => setIsAdminDropdownOpen(!isAdminDropdownOpen)}
                  className={`p-1.5 rounded-xl border transition-all flex items-center justify-center ${isAdminDropdownOpen
                      ? 'bg-sky-500/20 border-sky-500/30 text-sky-600 shadow-inner'
                      : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-sky-500/20 hover:border-sky-500/30 hover:text-sky-600'
                    }`}
                  title="Admin Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
                {isAdminDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2.5 w-56 bg-white border border-slate-200/80 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.08)] p-2.5 z-[100] animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col gap-1">
                    <div className="px-2.5 py-1.5 mb-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                        Control Panel
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setIsAdminDropdownOpen(false);
                        router.push('/users');
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs font-bold text-slate-600 hover:bg-sky-55/70 hover:text-sky-700 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <div className="p-1.5 bg-slate-100 group-hover:bg-sky-500/15 text-slate-500 group-hover:text-sky-600 rounded-lg transition-all">
                        <KeyRound className="w-3.5 h-3.5" />
                      </div>
                      <span>User Permissions</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsAdminDropdownOpen(false);
                        openGroupPanel();
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs font-bold text-slate-600 hover:bg-sky-55/70 hover:text-sky-700 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <div className="p-1.5 bg-slate-100 group-hover:bg-sky-500/15 text-slate-500 group-hover:text-sky-600 rounded-lg transition-all">
                        <Folder className="w-3.5 h-3.5" />
                      </div>
                      <span>Server Groups</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsAdminDropdownOpen(false);
                        openPanel();
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs font-bold text-slate-600 hover:bg-sky-55/70 hover:text-sky-700 rounded-xl transition-all flex items-center gap-3 group"
                    >
                      <div className="p-1.5 bg-slate-100 group-hover:bg-sky-500/15 text-slate-500 group-hover:text-sky-600 rounded-lg transition-all">
                        <Plus className="w-3.5 h-3.5" />
                      </div>
                      <span>Add Server</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onShowDashboard}
          className="mb-8 w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:bg-sky-500/10 hover:border-sky-500/30 hover:text-sky-700 transition-all group shadow-sm"
        >
          <LayoutDashboard className="w-4 h-4 text-sky-600 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-semibold">Dashboard Overview</span>
        </button>

        {/* Step 1 — Server */}
        <div className="mb-7 flex flex-col gap-2.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            1. Select Target Server
          </label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <button
                onClick={() => setIsServerDropdownOpen(!isServerDropdownOpen)}
                className={`w-full flex items-center justify-between bg-white border text-slate-800 text-sm rounded-xl p-3.5 transition-all shadow-sm hover:bg-slate-50 ${isServerDropdownOpen ? 'border-sky-500 ring-2 ring-sky-500/10' : 'border-slate-200'
                  }`}
              >
                <span className="font-medium truncate text-left mr-2 flex-1">
                  {selectedServerId ? (
                    servers.find(s => s.id === selectedServerId)?.name || "Server Selected"
                  ) : "Choose server..."}
                </span>
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${isServerDropdownOpen ? 'rotate-90' : 'rotate-0'}`} />
              </button>

              {isServerDropdownOpen && (
                <div className="absolute top-full left-0 w-[272px] mt-2 bg-white border border-slate-200 rounded-2xl shadow-[0_12px_36px_rgba(0,0,0,0.12)] py-2 z-[100] max-h-[400px] flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-3 pb-2 pt-1 border-b border-slate-100 mb-1">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search servers..."
                        autoFocus
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs rounded-lg pl-8 pr-3 py-2 outline-none focus:border-sky-500 transition-all"
                        value={serverSearchTerm}
                        onChange={(e) => setServerSearchTerm(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto custom-scrollbar flex-1">
                    {/* Groups */}
                    {serverGroups.map(group => {
                      const isExpanded = !!expandedGroups[group.id];
                      const groupMatches = group.name.toLowerCase().includes(serverSearchTerm.toLowerCase());
                      const matchedServers = groupMatches
                        ? group.servers
                        : group.servers.filter(s =>
                          s.name.toLowerCase().includes(serverSearchTerm.toLowerCase()) ||
                          s.host.toLowerCase().includes(serverSearchTerm.toLowerCase())
                        );

                      if (serverSearchTerm && matchedServers.length === 0 && !groupMatches) return null;

                      return (
                        <div key={group.id} className="border-b border-slate-100 last:border-b-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }));
                            }}
                            className="w-full flex items-center justify-between px-4 py-2 bg-slate-50 hover:bg-slate-100/80 transition-all text-xs font-bold text-slate-500 uppercase tracking-wider"
                          >
                            <span className="flex items-center gap-2">
                              {isExpanded ? <FolderOpen className="w-3.5 h-3.5 text-sky-500" /> : <Folder className="w-3.5 h-3.5 text-sky-400" />}
                              {group.name} ({matchedServers.length})
                            </span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {isExpanded && (
                            <div className="bg-white pl-2">
                              {matchedServers.length === 0 ? (
                                <p className="px-4 py-2 text-[10px] text-slate-400 italic">No servers in this group</p>
                              ) : (
                                matchedServers.map(s => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => { handleServerChange(s.id); setIsServerDropdownOpen(false); setServerSearchTerm(''); }}
                                    className={`w-full text-left px-4 py-2 text-sm transition-all flex items-center gap-3 bg-sky-50/40 hover:bg-sky-100/60 border-b border-sky-500/5 last:border-b-0 ${selectedServerId === s.id ? 'text-sky-700 bg-sky-100/80 ring-1 ring-inset ring-sky-500/20' : 'text-slate-600'}`}
                                  >
                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-colors ${selectedServerId === s.id ? 'bg-sky-500/20 border-sky-500/30' : 'bg-white border-sky-200'}`}>
                                      <Server className={`w-3 h-3 ${selectedServerId === s.id ? 'text-sky-600' : 'text-sky-400'}`} />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-semibold truncate leading-none text-slate-800 text-xs">{s.name}</span>
                                      <span className="text-[9px] text-sky-600/60 font-mono mt-0.5 opacity-70 truncate">{s.host}</span>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Ungrouped Servers */}
                    {(() => {
                      const ungrouped = servers.filter(s => !serverGroups.some(g => g.servers.some(gs => gs.id === s.id)));
                      const ungroupedMatches = 'ungrouped servers'.includes(serverSearchTerm.toLowerCase());
                      const matchedUngrouped = ungroupedMatches
                        ? ungrouped
                        : ungrouped.filter(s =>
                          s.name.toLowerCase().includes(serverSearchTerm.toLowerCase()) ||
                          s.host.toLowerCase().includes(serverSearchTerm.toLowerCase())
                        );

                      if (matchedUngrouped.length === 0 && !ungroupedMatches) return null;

                      const isExpanded = !!expandedGroups[-1]; // use -1 for ungrouped
                      return (
                        <div className="border-b border-slate-100 last:border-b-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedGroups(prev => ({ ...prev, [-1]: !prev[-1] }));
                            }}
                            className="w-full flex items-center justify-between px-4 py-2 bg-slate-50 hover:bg-slate-100/80 transition-all text-xs font-bold text-slate-500 uppercase tracking-wider"
                          >
                            <span className="flex items-center gap-2">
                              <Layers className="w-3.5 h-3.5 text-slate-400" />
                              Ungrouped Servers ({matchedUngrouped.length})
                            </span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {isExpanded && (
                            <div className="bg-white pl-2">
                              {matchedUngrouped.map(s => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => { handleServerChange(s.id); setIsServerDropdownOpen(false); setServerSearchTerm(''); }}
                                  className={`w-full text-left px-4 py-2 text-sm transition-all flex items-center gap-3 bg-sky-50/40 hover:bg-sky-100/60 border-b border-sky-500/5 last:border-b-0 ${selectedServerId === s.id ? 'text-sky-700 bg-sky-100/80 ring-1 ring-inset ring-sky-500/20' : 'text-slate-600'}`}
                                >
                                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-colors ${selectedServerId === s.id ? 'bg-sky-500/20 border-sky-500/30' : 'bg-white border-sky-200'}`}>
                                    <Server className={`w-3 h-3 ${selectedServerId === s.id ? 'text-sky-600' : 'text-sky-400'}`} />
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-semibold truncate leading-none text-slate-800 text-xs">{s.name}</span>
                                    <span className="text-[9px] text-sky-600/60 font-mono mt-0.5 opacity-70 truncate">{s.host}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {servers.length === 0 && (
                      <div className="px-4 py-8 text-center">
                        <p className="text-[11px] text-slate-500 italic">No servers found</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {selectedServerId && userRole === 'admin' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleEditClick(selectedServerId)}
                  className="p-3.5 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-sky-600 hover:border-sky-500/30 transition-all flex items-center justify-center shadow-sm"
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
                  className={`p-3.5 rounded-xl border transition-all flex items-center justify-center ${confirmDelete === selectedServerId
                    ? 'bg-red-500/20 border-red-500/50 text-red-400 font-bold text-[10px] uppercase min-w-[80px]'
                    : 'bg-white border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-500/30 shadow-sm'
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
              className="flex items-center gap-2 text-xs text-sky-600 hover:text-sky-500 mt-1 ml-1 transition-colors"
            >
              <Plus className="w-3 h-3" /> Add your first server
            </button>
          )}
        </div>

        {/* Step 2 — Unified Log Selection */}
        {selectedServerId && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                2. Select Log Target
              </label>
              <button
                onClick={refreshSources}
                disabled={loadingSources}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-sky-600 transition-all disabled:opacity-50"
                title="Refresh list"
              >
                <RotateCw className={`w-3.5 h-3.5 ${loadingSources ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Search Bar */}
            {!loadingSources && !sourceError && logSources.length > 0 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search logs, containers, pods..."
                  className="w-full bg-white border border-slate-200 text-slate-900 text-xs rounded-xl pl-9 pr-3 py-2.5 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/10 transition-all placeholder:text-slate-400 shadow-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            )}

            {loadingSources ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 border border-slate-200 rounded-xl bg-slate-100/60">
                <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
                <span className="text-xs text-slate-500 font-medium">Scanning server for logs...</span>
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
                        php: { label: 'PHP Services', icon: Cpu, color: 'text-purple-400' },
                        monitor: { label: 'Monitor Daemons', icon: Monitor, color: 'text-pink-400' },
                        other: { label: 'Other Logs', icon: Activity, color: 'text-zinc-500' }
                      };

                      const sortedTypes = Object.keys(groups).sort((a, b) => {
                        const order = ['system', 'auth', 'docker', 'k8s', 'nginx', 'apache', 'database', 'php', 'monitor', 'other'];
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
                                className="flex items-center justify-between w-full px-1 py-3 group hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-1 h-3.5 bg-sky-500 rounded-full transition-transform group-hover:scale-y-125`} />
                                  <Icon className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">{config.label}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="flex flex-col gap-1.5 pl-1.5 animate-in slide-in-from-top-1 duration-200">
                                  {namespaces.map(ns => (
                                    <button
                                      key={ns}
                                      onClick={() => setSelectedNamespace(ns)}
                                      className="w-full text-left text-[12px] px-3 py-3 rounded-xl border bg-white border-slate-200 text-slate-800 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-900 transition-all flex items-center justify-between group shadow-sm"
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <Cloud className="w-4 h-4 text-sky-500" />
                                        <span className="font-bold">{ns}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 rounded-lg text-sky-700 font-bold">{sources.filter(s => s.identifier.startsWith(ns + '/')).length}</span>
                                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition-colors" />
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
                              className="flex items-center justify-between w-full px-1 py-3 group hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
                            >
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-2">
                                  <div className={`w-1 h-3.5 rounded-full transition-transform group-hover:scale-y-125 ${config.color.replace('text-', 'bg-')}`} />
                                  <Icon className={`w-3.5 h-3.5 ${config.color} shrink-0`} />
                                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest leading-none">{config.label}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  {type === 'k8s' && selectedNamespace && !searchTerm && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setSelectedNamespace(null); }}
                                      className="text-[10px] font-bold text-sky-600 hover:text-sky-500 uppercase tracking-tighter"
                                    >
                                      Close {selectedNamespace}
                                    </button>
                                  )}
                                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="flex flex-col gap-1.5 pl-1.5 animate-in slide-in-from-top-1 duration-200">
                                {displaySources.map((source, idx) => {
                                  let displayName = source.identifier;
                                  let suffix = '';
                                  const isK8s = type === 'k8s';
                                  const isDocker = type === 'docker';
                                  const isAccordionType = isK8s || isDocker;

                                  if (isK8s) {
                                    const nameOnly = source.identifier.split('/')[1] || source.identifier;
                                    const parts = nameOnly.split('-');
                                    if (parts.length > 2) {
                                      suffix = '-' + parts.pop() + '-' + parts.pop();
                                      displayName = nameOnly.replace(suffix, '');
                                    } else {
                                      displayName = nameOnly;
                                    }
                                  } else if (isDocker) {
                                    displayName = source.identifier;
                                  }

                                  const itemKey = source.identifier;
                                  const isItemExpanded = !!expandedSourceItems[itemKey];
                                  const itemSubLogs = subLogs[itemKey] || [];
                                  const isLoadingSub = !!loadingSubLogs[itemKey];
                                  const childSources = itemSubLogs.filter((s: any) => s.identifier !== itemKey && s.identifier.startsWith(itemKey + '|'));
                                  const isLive = /running|up|active|security|healthy/i.test(source.status?.toLowerCase() || '');

                                  if (!isAccordionType) {
                                    return (
                                      <button
                                        key={idx}
                                        onClick={() => handleSourceSelect(source.identifier, source.type)}
                                        className={`group w-full text-left px-3 py-3 rounded-xl border transition-all flex items-center justify-between ${selectedSource === source.identifier
                                          ? 'bg-sky-500/15 border-sky-500/40 text-sky-900 shadow-md shadow-sky-500/10'
                                          : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-sky-50 hover:text-slate-900 hover:border-sky-300 shadow-sm'
                                          }`}
                                      >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                          <div className={`p-2 rounded-lg border transition-colors ${selectedSource === source.identifier
                                            ? 'bg-sky-500/20 border-sky-500/30 text-sky-600'
                                            : `bg-white border-slate-200 ${config.color} opacity-70 group-hover:opacity-100`
                                            }`}>
                                            <Icon className="w-4 h-4" />
                                          </div>
                                          <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-2.5">
                                              <span className="font-bold truncate text-[13.5px] leading-tight tracking-tight font-sans">{displayName}</span>
                                              {isLive && <div className="relative flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.9)] animate-pulse" /><span className="text-[9px] font-black text-green-500 uppercase tracking-widest">Live</span></div>}
                                            </div>
                                            {suffix && <span className="text-[10px] text-zinc-600 font-mono truncate opacity-60 mt-0.5">{suffix.startsWith('-') ? suffix.substring(1) : suffix}</span>}
                                          </div>
                                        </div>
                                        {selectedSource === source.identifier ? <Activity className="w-4 h-4 text-sky-500 animate-pulse" /> : <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600" />}
                                      </button>
                                    );
                                  }

                                  // Accordion for K8s / Docker
                                  return (
                                    <div key={idx} className="flex flex-col gap-0.5">
                                      <div
                                        className={`group w-full text-left px-3 py-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${selectedSource === source.identifier
                                            ? 'bg-sky-500/15 border-sky-500/40 text-sky-900 shadow-md shadow-sky-500/10'
                                            : isItemExpanded
                                              ? 'bg-slate-200/60 border-slate-300 text-slate-800'
                                              : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-sky-50 hover:text-slate-900 hover:border-sky-300 shadow-sm'
                                          }`}
                                        onClick={() => handleSourceSelect(source.identifier, source.type)}
                                      >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                          <div className={`p-2 rounded-lg border transition-colors ${selectedSource === source.identifier || isItemExpanded
                                              ? 'bg-sky-500/20 border-sky-500/30 text-sky-600'
                                              : `bg-white border-slate-200 ${config.color} opacity-70 group-hover:opacity-100`
                                            }`}>
                                            <Icon className="w-4 h-4" />
                                          </div>
                                          <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-2.5">
                                              <span className="font-bold truncate text-[13.5px] leading-tight tracking-tight font-sans">{displayName}</span>
                                              {isLive && <div className="relative flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.9)] animate-pulse" /><span className="text-[9px] font-black text-green-500 uppercase tracking-widest">Live</span></div>}
                                            </div>
                                            {suffix && <span className="text-[10px] text-zinc-600 font-mono truncate opacity-60 mt-0.5">{suffix.startsWith('-') ? suffix.substring(1) : suffix}</span>}
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className={`p-1.5 rounded-lg hover:bg-slate-300/40 text-slate-500 hover:text-slate-800 transition-all shrink-0 z-10 flex items-center justify-center ${selectedSource === source.identifier ? 'hover:bg-sky-500/20 text-sky-700' : ''
                                            }`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleSourceItem(itemKey);
                                            if (!isItemExpanded) fetchSubLogs(type as 'k8s' | 'docker', itemKey);
                                          }}
                                          title={isItemExpanded ? "Collapse additional logs" : "Expand additional logs"}
                                        >
                                          {isLoadingSub ? (
                                            <Loader2 className="w-3.5 h-3.5 text-sky-500 animate-spin" />
                                          ) : (
                                            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isItemExpanded ? 'rotate-180' : ''}`} />
                                          )}
                                        </button>
                                      </div>

                                      {isItemExpanded && (
                                        <div className="ml-4 pl-3 border-l-2 border-sky-400/30 flex flex-col gap-0.5 animate-in slide-in-from-top-1 duration-200">
                                          {(() => {
                                            const hasContainers = childSources.some((s: any) => s.type === 'k8s-container');
                                            if (hasContainers) return null;

                                            return (
                                              <button
                                                onClick={() => handleSourceSelect(source.identifier, source.type)}
                                                className={`group w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center gap-2.5 ${selectedSource === source.identifier ? 'bg-sky-500/15 border-sky-500/30 text-sky-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-sky-50 hover:border-sky-300'}`}
                                              >
                                                <TerminalIcon className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                                <div className="flex flex-col min-w-0">
                                                  <span className="text-[12px] font-bold truncate">stdout / stderr</span>
                                                  <span className="text-[9px] text-slate-400 font-mono">Live container output</span>
                                                </div>
                                                {selectedSource === source.identifier ? <Activity className="w-3.5 h-3.5 text-sky-500 animate-pulse ml-auto shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 ml-auto shrink-0 transition-opacity" />}
                                              </button>
                                            );
                                          })()}

                                          {childSources.map((child: any, ci: number) => {
                                            if (child.type === 'k8s-container') {
                                              return (
                                                <button
                                                  key={ci}
                                                  onClick={() => handleSourceSelect(child.identifier, child.type)}
                                                  className={`group w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center gap-2.5 ${selectedSource === child.identifier
                                                      ? 'bg-sky-500/15 border-sky-500/30 text-sky-800'
                                                      : 'bg-white border-slate-200 text-slate-600 hover:bg-sky-50 hover:border-sky-300'
                                                    }`}
                                                >
                                                  <TerminalIcon className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                                  <div className="flex flex-col min-w-0">
                                                    <span className="text-[12px] font-bold truncate">Container: {child.containerName}</span>
                                                    <span className="text-[9px] text-slate-400 font-mono">Live container output</span>
                                                  </div>
                                                  {selectedSource === child.identifier
                                                    ? <Activity className="w-3.5 h-3.5 text-sky-500 animate-pulse ml-auto shrink-0" />
                                                    : <ChevronRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 ml-auto shrink-0 transition-opacity" />}
                                                </button>
                                              );
                                            }

                                            const logFilePath = child.filePath || child.identifier.split('|')[1] || child.identifier;
                                            const shortName = logFilePath.split('/').pop() || logFilePath;
                                            return (
                                              <button
                                                key={ci}
                                                onClick={() => handleSourceSelect(child.identifier, child.type)}
                                                className={`group w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center gap-2.5 ${selectedSource === child.identifier
                                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800'
                                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-emerald-50 hover:border-emerald-300'
                                                  }`}
                                              >
                                                <BookOpen className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                                <div className="flex flex-col min-w-0">
                                                  <span className="text-[12px] font-bold truncate">{shortName}</span>
                                                  <span className="text-[9px] text-slate-400 font-mono truncate">{logFilePath}</span>
                                                </div>
                                                {selectedSource === child.identifier
                                                  ? <Activity className="w-3.5 h-3.5 text-emerald-500 animate-pulse ml-auto shrink-0" />
                                                  : <ChevronRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 ml-auto shrink-0 transition-opacity" />}
                                              </button>
                                            );
                                          })}

                                          {childSources.length === 0 && !isLoadingSub && (
                                            <p className="text-[10px] text-slate-400 italic pl-2 py-1.5">
                                              No additional log files found inside this {isK8s ? 'pod' : 'container'}.
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
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

        <div className="mt-auto pt-6 text-xs text-slate-400 flex items-center justify-center gap-2">
          <Lock className="w-3 h-3" />
          Stream is purely transient and secure.
        </div>
      </div>

      {/* Add Server Panel (slides in from right) */}
      <div className={`h-full absolute inset-0 flex flex-col bg-slate-50 backdrop-blur-2xl border-r border-slate-200 transition-transform duration-300 ${showAddPanel ? 'translate-x-0' : 'translate-x-full'} overflow-y-auto ${isGrabDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleGrabMouseDown}
        onMouseMove={handleGrabMouseMove}
        onMouseUp={handleGrabMouseUp}
        onMouseLeave={handleGrabMouseUp}
      >

        {/* Panel Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/20 rounded-xl border border-sky-500/30">
              {editingId ? <Settings className="w-5 h-5 text-sky-600" /> : <Server className="w-5 h-5 text-sky-600" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">{editingId ? 'Edit Server' : 'Add Server'}</h2>
              <p className="text-xs text-slate-500">{editingId ? 'Updating configuration' : 'SSH key authentication'}</p>
            </div>
          </div>
          <button
            onClick={closePanel}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher - only for new server */}
        {!editingId && (
          <div className="flex px-6 pt-4 gap-2 bg-slate-50 border-b border-slate-200/50 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('quick')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${activeTab === 'quick' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              ⚡ Quick Setup
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-all border-b-2 text-center ${activeTab === 'manual' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              Manual Config
            </button>
          </div>
        )}

        {!editingId && activeTab === 'quick' ? (
          <div className="flex flex-col gap-5 p-6 overflow-y-auto flex-1">
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-[20px] p-4 flex flex-col gap-2">
              <span className="text-xs font-bold text-sky-700 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-sky-600 animate-pulse" /> Zero-Touch Installation
              </span>
              <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                Run this single secure command on your remote server. The script will automatically deploy the security wrapper, configure restricted SSH access, and register the node back to this dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Run this command on your remote server:</label>
              <div className="relative bg-slate-900 text-slate-100 rounded-xl p-3.5 font-mono text-[10px] break-all leading-normal border border-slate-800 shadow-inner select-all">
                {setupToken ? (
                  `curl -fsSL -k "https://${typeof window !== 'undefined' ? window.location.host : ''}/api/setup-node?token=${setupToken}" | bash`
                ) : (
                  <span className="text-slate-500 animate-pulse">Generating secure registration command...</span>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={!setupToken}
              onClick={() => {
                const appHost = typeof window !== 'undefined' ? window.location.host : '';
                const cmd = `curl -fsSL -k "https://${appHost}/api/setup-node?token=${setupToken}" | bash`;
                navigator.clipboard.writeText(cmd);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg ${copied ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20' : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-500/20'} disabled:opacity-50 flex items-center justify-center gap-2`}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" /> Copied successfully!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> Copy Command
                </>
              )}
            </button>

            <div className="border-t border-slate-200/60 my-2" />

            <div className="flex flex-col gap-4">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Setup Steps Details</span>

              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-slate-200/60 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">1</div>
                  <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                    Log into your remote server as a user with <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded font-mono text-[10px]">sudo</code> access.
                  </p>
                </div>

                <div className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-slate-200/60 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">2</div>
                  <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                    Paste the copied command and press <kbd className="text-slate-700 bg-slate-200/60 px-1.5 py-0.5 rounded font-mono shadow-sm text-[10px]">Enter</kbd>.
                  </p>
                </div>

                <div className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-slate-200/60 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">3</div>
                  <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                    Watch the terminal. Once completed, the server will instantly show up in the left-hand sidebar as <span className="text-emerald-500 font-bold">Online</span>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleAddServer} className="flex flex-col gap-4 p-6 overflow-y-auto flex-1">

            {/* Server Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Server Name</label>
              <input
                name="name"
                value={form.name}
                onChange={handleFormChange}
                placeholder="e.g. Production Web"
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder:text-slate-400 shadow-sm"
              />
            </div>

            {/* Host */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">IP Address / Hostname</label>
              <input
                name="host"
                value={form.host}
                onChange={handleFormChange}
                placeholder="e.g. 192.168.1.100 or server.com"
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder:text-slate-400 font-mono shadow-sm"
              />
            </div>

            {/* Port + Username row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">SSH Port</label>
                <input
                  name="port"
                  value={form.port}
                  onChange={handleFormChange}
                  placeholder="22"
                  type="number"
                  min="1"
                  max="65535"
                  className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder:text-slate-400 font-mono shadow-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">SSH User</label>
                <input
                  name="username"
                  value={form.username}
                  onChange={handleFormChange}
                  placeholder="ubuntu"
                  className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder:text-slate-400 font-mono shadow-sm"
                />
              </div>
            </div>

            {/* Private Key */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound className="w-3 h-3" /> Private Key
                </label>
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="text-xs text-slate-400 hover:text-sky-600 flex items-center gap-1 transition-colors"
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
                className={`w-full bg-white border border-slate-200 text-slate-900 text-xs rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder:text-slate-400 font-mono resize-none leading-relaxed shadow-sm ${!showKey ? 'text-security-disc' : ''}`}
                style={!showKey ? { WebkitTextSecurity: 'disc' } as React.CSSProperties : {}}
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Paste the contents of your <span className="text-slate-500 font-mono">~/.ssh/id_ed25519</span> private key. It will be AES-256 encrypted before storage.
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
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-300 transition-all text-xs font-bold disabled:opacity-50 shadow-sm"
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
              className="mt-2 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-black uppercase tracking-widest py-3.5 rounded-xl shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {editingId ? 'Update Server' : 'Save Server'}
            </button>
          </form>
        )}
      </div>

      {/* User Management Panel */}
      <div className={`w-80 h-full absolute inset-0 flex flex-col bg-slate-50 backdrop-blur-2xl border-r border-slate-200 transition-transform duration-300 ${showUserPanel ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/20 rounded-xl border border-sky-500/30">
              <Users className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">User Access</h2>
              <p className="text-xs text-slate-500">Manage team permissions</p>
            </div>
          </div>
          <button onClick={closeUserPanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-900">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">
          <form onSubmit={handleAddUser} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Username / Email Address</label>
              <input
                type="text"
                required
                value={userForm.email}
                onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 shadow-sm"
                placeholder="dev or user@email.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center justify-between">
                <span>Password</span>
                <span className="text-[8px] text-sky-500 font-bold lowercase normal-case tracking-normal">Optional for Microsoft SSO</span>
              </label>
              <input
                type="password"
                value={userForm.password}
                onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 shadow-sm"
                placeholder="Leave blank for SSO login..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Role</label>
              <select
                value={userForm.role}
                onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 shadow-sm"
              >
                <option value="viewer">Viewer (Read Only)</option>
                <option value="admin">Admin (Full Control)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={userSaving}
              className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-md"
            >
              {userSaving ? 'Adding...' : 'Add User'}
            </button>
          </form>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Active Users</h3>
            {users.map(u => {
              const isCurrent = u.email.toLowerCase() === currentUserEmail.toLowerCase();
              return (
                <div key={u.id} className="flex items-center justify-between p-3 rounded-xl bg-white border border-slate-200 group shadow-sm">
                  <div className="flex flex-col min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-bold text-slate-800 truncate" title={u.email}>{u.email}</span>
                      {u.isOnline && (
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)] shrink-0" title="Online now" />
                      )}
                      {isCurrent && (
                        <span className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 text-[8px] font-black tracking-widest px-1.5 py-0.5 rounded-full uppercase shrink-0">
                          You
                        </span>
                      )}
                    </div>
                    <span className={`text-[9px] uppercase font-black tracking-tighter ${u.role === 'admin' ? 'text-sky-600' : 'text-slate-400'}`}>{u.role}</span>
                  </div>
                  {!isCurrent && (
                    <button
                      onClick={() => handleDeleteUser(u)}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Server Group Management Panel */}
      <div className={`w-80 h-full absolute inset-0 flex flex-col bg-slate-50 backdrop-blur-2xl border-r border-slate-200 transition-transform duration-300 ${showGroupPanel ? 'translate-x-0' : 'translate-x-full'} z-[90]`}>
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/20 rounded-xl border border-sky-500/30">
              <Folder className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Server Groups</h2>
              <p className="text-xs text-slate-500">Organize and control access</p>
            </div>
          </div>
          <button onClick={closeGroupPanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-900">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6 custom-scrollbar">
          <form onSubmit={handleGroupFormSubmit} className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                {editingGroupId ? 'Edit Server Group' : 'Create New Group'}
              </h3>
              {editingGroupId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingGroupId(null);
                    setGroupForm({ name: '', description: '', serverIds: [] });
                  }}
                  className="text-[10px] font-bold text-sky-600 hover:underline"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Group Name</label>
              <input
                type="text"
                required
                value={groupForm.name}
                onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all shadow-sm"
                placeholder="e.g. Production, Staging"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Description</label>
              <textarea
                value={groupForm.description}
                onChange={e => setGroupForm({ ...groupForm, description: e.target.value })}
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all shadow-sm resize-none h-16"
                placeholder="Optional group description..."
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Select Servers</label>
              {allServersForGroup.length > 0 && (
                <div className="relative mb-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search servers..."
                    className="w-full bg-white border border-slate-200 text-slate-900 text-xs rounded-xl pl-9 pr-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/10 transition-all placeholder:text-slate-400 shadow-sm"
                    value={groupServerSearchTerm}
                    onChange={(e) => setGroupServerSearchTerm(e.target.value)}
                  />
                  {groupServerSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setGroupServerSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <div className="bg-white border border-slate-200 rounded-xl p-3 max-h-40 overflow-y-auto custom-scrollbar flex flex-col gap-2">
                {(() => {
                  const filtered = allServersForGroup.filter(server =>
                    server.name.toLowerCase().includes(groupServerSearchTerm.toLowerCase()) ||
                    server.host.toLowerCase().includes(groupServerSearchTerm.toLowerCase())
                  );
                  if (filtered.length === 0) {
                    return (
                      <p className="text-[10px] text-slate-400 italic text-center py-2">
                        {allServersForGroup.length === 0 ? "No servers available. Add a server first." : "No matching servers found."}
                      </p>
                    );
                  }
                  return filtered.map(server => (
                    <label
                      key={server.id}
                      className="flex items-center justify-between w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-sky-100 hover:bg-sky-50/60 transition-all cursor-pointer select-none group/item"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={groupForm.serverIds.includes(server.id)}
                          onChange={() => toggleGroupServerSelection(server.id)}
                          className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 w-3.5 h-3.5"
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-slate-700 group-hover/item:text-sky-900 truncate">{server.name}</span>
                          <span className="text-[9px] font-mono text-slate-400 truncate">{server.host}</span>
                        </div>
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-400 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0 ml-2" />
                    </label>
                  ));
                })()}
              </div>
            </div>

            <button
              type="submit"
              disabled={groupSaving}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-500/20 flex items-center justify-center gap-2"
            >
              {groupSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Group...</span>
                </>
              ) : (
                <span>{editingGroupId ? 'Update Group' : 'Create Group'}</span>
              )}
            </button>

            {groupSaveMsg === 'ok' && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Group saved successfully!</span>
              </div>
            )}
            {groupSaveMsg === 'err' && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>Failed to save group.</span>
              </div>
            )}
          </form>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Configured Groups</h3>
            {serverGroups.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-4 bg-white border border-slate-100 rounded-xl">No groups created yet</p>
            ) : (
              serverGroups.map(g => (
                <div key={g.id} className="flex items-center justify-between p-3 rounded-xl bg-white border border-slate-200 group shadow-sm">
                  <div className="flex flex-col min-w-0 flex-1 pr-2">
                    <span className="text-xs font-bold text-slate-800 truncate" title={g.name}>{g.name}</span>
                    {g.description && (
                      <span className="text-[10px] text-slate-400 truncate mt-0.5" title={g.description}>{g.description}</span>
                    )}
                    <span className="text-[9px] text-sky-600 font-bold uppercase tracking-tight mt-1">{g.servers?.length || 0} servers</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                    <button
                      onClick={() => handleEditGroupClick(g)}
                      className="p-1 rounded text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-all"
                      title="Edit group"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(g.id)}
                      className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                      title="Delete group"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Admin User Guide Panel */}
      <div className={`absolute inset-0 bg-slate-50 z-50 transition-transform duration-500 ease-in-out flex flex-col p-6 overflow-y-auto select-text ${showGuide ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/20 rounded-xl border border-cyan-500/30">
              <BookOpen className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 leading-tight">{userRole === 'admin' ? 'Admin' : 'User'} Guide</h2>
              <p className="text-[10px] font-black text-sky-600 uppercase tracking-widest opacity-80">Platform Documentation</p>
            </div>
          </div>
          <button onClick={() => setShowGuide(false)} className="p-2 hover:bg-slate-200 rounded-xl transition-all text-slate-400 hover:text-slate-900">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex flex-col gap-8 pb-10">
          <section className="bg-white border border-slate-200 rounded-[24px] p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                <Globe className="w-4 h-4 text-blue-400" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">What is PulseLog?</h3>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              PulseLog is a mission-critical infrastructure monitoring platform. It allows real-time log streaming from remote servers via secure SSH tunnels. No sensitive logs are stored on this server; they are streamed directly to your browser using <span className="text-cyan-400">Socket.io</span> and rendered in a high-performance Xterm.js terminal.
            </p>
          </section>

          {userRole === 'admin' ? (
            <>
              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center border border-sky-500/30">
                    <Plus className="w-4 h-4 text-sky-600" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Adding Servers</h3>
                </div>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">1</div>
                    <p className="text-xs text-slate-500 font-medium">Click the <span className="text-slate-900">+</span> button in the header.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">2</div>
                    <p className="text-xs text-slate-500 font-medium">Provide SSH credentials. Use a private key for maximum security.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">3</div>
                    <p className="text-xs text-slate-500 font-medium">Test connection. The app automatically deploys and verifies <span className="text-cyan-400">log-wrapper.sh</span> integrity using MD5 sync.</p>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
                    <Cpu className="w-4 h-4 text-orange-400" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Target Node Setup</h3>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">
                  Follow these steps to prepare a remote server (node) for PulseLog monitoring:
                </p>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 text-[10px] font-black text-cyan-400">01</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-1">Deploy Wrapper Script</p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Copy <code className="text-cyan-500">log-wrapper.sh</code> from the PulseLog root directory to the target server, ideally in <code className="text-zinc-500 font-bold">/usr/log/bin/</code>.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 text-[10px] font-black text-cyan-400">02</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-1">Grant Permissions</p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Make the script executable: <br />
                        <code className="text-sky-600">chmod +x /usr/log/bin/log-wrapper.sh</code>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 text-[10px] font-black text-cyan-400">03</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-1">Configure SSH Access</p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        1. Prepare the SSH directory: <br />
                        <code className="text-sky-600">mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys</code> <br /><br />
                        2. Add the public key to <code className="text-zinc-500 font-bold">~/.ssh/authorized_keys</code>, prepending these security restrictions (all on one line): <br />
                        <code className="text-sky-600 bg-sky-50 p-2 rounded block mt-1 break-all border border-sky-100 font-mono">
                          command="/usr/log/bin/log-wrapper.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAA...
                        </code>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 text-[10px] font-black text-cyan-400">04</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-1">Register in Sidebar</p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Use the <span className="text-slate-900">+</span> button to add the server. PulseLog will now securely tunnel through SSH to execute the wrapper.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                    <Monitor className="w-4 h-4 text-indigo-400" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Windows Node Setup</h3>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">
                  To monitor a Windows server, follow these PowerShell steps as Administrator:
                </p>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 text-[10px] font-black text-indigo-400">01</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-2">Install & Start SSH</p>
                      <div className="space-y-2">
                        <code className="text-[9px] text-sky-600 bg-slate-50 p-2 rounded block font-mono border border-slate-100 break-all">
                          Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
                        </code>
                        <code className="text-[9px] text-sky-600 bg-slate-50 p-2 rounded block font-mono border border-slate-100 break-all">
                          Start-Service sshd; Set-Service -Name sshd -StartupType 'Automatic'
                        </code>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 text-[10px] font-black text-indigo-400">02</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-2">Configure Firewall</p>
                      <code className="text-[9px] text-sky-600 bg-slate-50 p-2 rounded block font-mono border border-slate-100 break-all">
                        New-NetFirewallRule -Name sshd -DisplayName 'SSH' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
                      </code>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-6 h-6 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0 text-[10px] font-black text-indigo-400">03</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-1">Fix Permissions</p>
                      <p className="text-[10px] text-slate-400 leading-normal mb-3">
                        Run these 3 commands to secure your <code className="text-zinc-500 font-bold">authorized_keys</code>:
                      </p>
                      <div className="space-y-3">
                        <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">A. Enable Scripts</p>
                          <code className="text-[9px] text-sky-600 bg-slate-50 p-2 rounded block font-mono border border-slate-100 break-all">
                            Set-ExecutionPolicy RemoteSigned -Force
                          </code>
                        </div>
                        <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">B. Restrict Key</p>
                          <code className="text-[9px] text-sky-600 bg-slate-50 p-2 rounded block font-mono border border-slate-100 break-all">
                            icacls "C:\Users\username\.ssh\authorized_keys" /inheritance:r
                          </code>
                        </div>
                        <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">C. Grant Access</p>
                          <code className="text-[9px] text-sky-600 bg-slate-50 p-2 rounded block font-mono border border-slate-100 break-all">
                            icacls "C:\Users\username\.ssh\authorized_keys" /grant:r "username:F"
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                    <Users className="w-4 h-4 text-blue-400" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Access & User Control</h3>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">
                  Configure access levels, server groups, and user accounts via the <span className="font-semibold text-slate-700 bg-slate-100 px-1 py-0.5 rounded">Admin Settings</span> (gear icon next to the user guide):
                </p>

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-sky-600">A</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-0.5">User Permissions Panel</p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Create user accounts, update security roles (Admin vs. Viewer), or restrict Viewer access to specific server groups.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-sky-600">B</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-0.5">Server Group Controls</p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Organize remote nodes into logical server groups to partition access visibility.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-sky-600">C</div>
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-700 mb-0.5">Secure Role Levels</p>
                      <ul className="space-y-1.5 mt-1">
                        <li className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                          <Shield className="w-3 h-3 text-red-500 shrink-0" /> Admins: Full permissions over nodes, groups, and users.
                        </li>
                        <li className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                          <Activity className="w-3 h-3 text-green-500 shrink-0" /> Viewers: Stream logs only for assigned server groups.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <Shield className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Security Audit Engine</h3>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">
                  PulseLog features a high-performance, immutable audit trail. Every interaction is cryptographically associated with a user and server.
                </p>

                <div className="space-y-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="w-3 h-3 text-cyan-400" />
                      <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Smart Search Features</span>
                    </div>
                    <ul className="space-y-2">
                      <li className="text-[10px] font-medium text-slate-500 leading-normal">
                        • <span className="text-slate-700 font-bold">Time Range:</span> Search <code className="text-cyan-600 font-bold">"5:00 pm to 6:00 pm"</code> to filter specific shift windows.
                      </li>
                      <li className="text-[10px] font-medium text-slate-500 leading-normal">
                        • <span className="text-slate-700 font-bold">Date Range:</span> Use <code className="text-cyan-600 font-bold">"apr 20 to 21"</code> for multi-day investigations.
                      </li>
                      <li className="text-[10px] font-medium text-slate-500 leading-normal">
                        • <span className="text-slate-700 font-bold">Multi-Field:</span> Search by email, server name, or log source simultaneously.
                      </li>
                    </ul>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Download className="w-3 h-3 text-emerald-400" />
                      <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Compliance & Export</span>
                    </div>
                    <p className="text-[10px] font-medium text-slate-500 leading-normal">
                      Export the entire filtered result set to <span className="text-slate-700 font-bold">CSV format</span> for offline compliance reporting or SOC integration.
                    </p>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center border border-sky-500/30">
                    <LayoutDashboard className="w-4 h-4 text-sky-600" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Platform Features</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Real-time Terminal:</span> Experience near-zero latency streaming using high-performance socket technology.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Log Auto-Discovery:</span> Automatically scans remote servers to group log files (PHP, Nginx, System, etc.) dynamically.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Stream Buffer:</span> Pause the live stream at any time to inspect specific events without losing incoming data.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Watch Alerts:</span> Type keywords in the <span className="font-semibold text-slate-700 bg-slate-100 px-1 py-0.5 rounded">Watch</span> slot to highlight them in red and track session hits.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Quick Recall:</span> Access your recently viewed log sources instantly via the <Clock className="inline w-3 h-3 mb-0.5" /> icon in the top header.
                    </p>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center border border-pink-500/30">
                    <Sparkles className="w-4 h-4 text-pink-500" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">AI Anomaly Diagnostics</h3>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">
                  PulseLog integrates AI-powered diagnostics for real-time error analysis.
                </p>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">1</div>
                    <p className="text-xs text-slate-500 font-medium">Configure <span className="text-slate-900 font-mono text-[11px]">GROQ_API_KEY</span> in your server environment variables.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">2</div>
                    <p className="text-xs text-slate-500 font-medium">When a spike occurs (3+ errors in 10s), the system exposes a diagnosis banner to operators.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">3</div>
                    <p className="text-xs text-slate-500 font-medium">The diagnostic engine uses Llama 3.3 (70B) to compile objective incident summaries, root causes, and correct web-server configurations.</p>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center border border-sky-500/30">
                    <LayoutDashboard className="w-4 h-4 text-sky-600" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Key Features</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Real-time Terminal:</span> Experience near-zero latency streaming using high-performance socket technology.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Smart Search:</span> Filter live logs using plain text or powerful Regular Expressions (Regex).
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Log Auto-Discovery:</span> Scans remote servers dynamically to auto-group log files (PHP Services, Monitor Daemons, etc.).
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Stream Buffer:</span> Pause the live stream at any time to inspect specific events without losing incoming data.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Watch Alerts:</span> Type words in the <span className="font-semibold text-slate-700 bg-slate-100 px-1 py-0.5 rounded">Watch</span> slot to highlight them in red and track session hits.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                      <span className="text-slate-900">Quick Recall:</span> Access your recently viewed log sources instantly via the <Clock className="inline w-3 h-3 mb-0.5" /> icon in the top header.
                    </p>
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-[24px] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center border border-pink-500/30">
                    <Sparkles className="w-4 h-4 text-pink-500" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">AI Incident Diagnostics</h3>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium mb-4">
                  PulseLog features intelligent error tracking to help you troubleshoot incidents faster.
                </p>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">1</div>
                    <p className="text-xs text-slate-500 font-medium">If a stream registers 3 or more errors within 10 seconds, a red <span className="text-red-500 font-bold">Error Spike</span> button appears.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">2</div>
                    <p className="text-xs text-slate-500 font-medium">Click the banner to send the surrounding log window for instant, secure AI analysis.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">3</div>
                    <p className="text-xs text-slate-500 font-medium">Review the objective breakdown of the issue, what happened, and production-ready server fixes.</p>
                  </div>
                </div>
              </section>
            </>
          )}

          <section className="bg-white border border-slate-200 rounded-[24px] p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center border border-orange-500/30">
                <Search className="w-4 h-4 text-orange-400" />
              </div>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">How to View Logs</h3>
            </div>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">1</div>
                <p className="text-xs text-slate-500 font-medium">Click <span className="text-slate-900">"Choose server..."</span> in the sidebar and select a target node.</p>
              </div>
              <div className="flex gap-4">
                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">2</div>
                <p className="text-xs text-slate-500 font-medium">Browse through auto-discovered groups like <span className="text-purple-500 font-semibold">PHP Services</span>, <span className="text-pink-500 font-semibold">Monitor Daemons</span>, or <span className="text-cyan-400">Docker</span>.</p>
              </div>
              <div className="flex gap-4">
                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">3</div>
                <p className="text-xs text-slate-500 font-medium">Click on a specific log source to launch the terminal monitor.</p>
              </div>
              <div className="flex gap-4">
                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-400">4</div>
                <p className="text-xs text-slate-500 font-medium">Use the <span className="text-orange-400">Search</span> bar, the <span className="text-sky-500 font-semibold">Watch</span> keyword input, or the <span className="text-cyan-400">Pause</span> button to interact.</p>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-200 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">PulseLog System Secure</span>
          </div>
          <p className="text-[9px] font-bold text-zinc-700 uppercase tracking-widest">Version 2.4.0 • Infrastructure First</p>
        </div>
      </div>
    </div>
  );
}
