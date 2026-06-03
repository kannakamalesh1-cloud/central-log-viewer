"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Shield, Activity, Search, Plus, Trash2, Save,
  ArrowLeft, Loader2, CheckCircle2, AlertCircle, Eye,
  Crown, UserCheck, Wifi, WifiOff, Calendar, Lock, X,
  RefreshCw, ChevronDown, Folder
} from "lucide-react";

interface UserData {
  id: number;
  email: string;
  role: string;
  createdAt: string;
  isOnline?: boolean;
}

interface ServerGroup {
  id: number;
  name: string;
  description: string;
  servers: { id: number; name: string; host: string }[];
}

const ROLE_CONFIG = {
  admin: { label: "Admin", color: "text-sky-600", bg: "bg-sky-500/10", border: "border-sky-500/20", icon: Crown },
  viewer: { label: "Viewer", color: "text-slate-500", bg: "bg-slate-100", border: "border-slate-200", icon: Eye },
};

function getInitial(email: string) {
  return email.charAt(0).toUpperCase();
}

function getAvatarColor(email: string) {
  const colors = [
    "from-sky-500 to-blue-600",
    "from-violet-500 to-purple-600",
    "from-emerald-500 to-teal-600",
    "from-orange-500 to-amber-600",
    "from-pink-500 to-rose-600",
    "from-cyan-500 to-sky-600",
  ];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return dateStr; }
}

function isSSO(email: string) {
  return email.includes("@") && email.includes(".");
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [search, setSearch] = useState("");
  const [editingRole, setEditingRole] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [saveMsg, setSaveMsg] = useState<Record<number, "ok" | "err">>({});
  const [addForm, setAddForm] = useState({ email: "", password: "", role: "viewer" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addSuccess, setAddSuccess] = useState(false);
  const [filterRole, setFilterRole] = useState<"all" | "admin" | "viewer">("all");
  const [refreshing, setRefreshing] = useState(false);

  // Group permission states
  const [groups, setGroups] = useState<ServerGroup[]>([]);
  const [selectedUserForGroups, setSelectedUserForGroups] = useState<UserData | null>(null);
  const [assignedGroupIds, setAssignedGroupIds] = useState<number[]>([]);
  const [loadingUserGroups, setLoadingUserGroups] = useState(false);
  const [savingUserGroups, setSavingUserGroups] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/groups/with-servers");
      const data = await res.json();
      if (Array.isArray(data)) setGroups(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchUserGroups = async (userId: number) => {
    setLoadingUserGroups(true);
    try {
      const res = await fetch(`/api/users/${userId}/groups`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setAssignedGroupIds(data.map((g: any) => g.id));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingUserGroups(false);
    }
  };

  const handleSaveUserGroups = async () => {
    if (!selectedUserForGroups) return;
    setSavingUserGroups(true);
    try {
      const res = await fetch(`/api/users/${selectedUserForGroups.id}/groups`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: assignedGroupIds })
      });
      if (res.ok) {
        setSelectedUserForGroups(null);
      } else {
        alert("Failed to save group permissions");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingUserGroups(false);
    }
  };

  const fetchUsers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/users");
      if (res.status === 403) { router.push("/"); return; }
      const data = await res.json();
      if (Array.isArray(data)) setUsers(data);
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, [router]);

  useEffect(() => {
    fetch("/api/auth/verify").then(r => r.json()).then(d => {
      if (!d.authenticated || d.user.role !== "admin") { router.push("/"); return; }
      setCurrentUserEmail(d.user.email || "");
      fetchUsers();
      fetchGroups();
    }).catch(() => router.push("/"));
  }, [fetchUsers, router]);

  // Auto-refresh every 8s
  useEffect(() => {
    const id = setInterval(() => fetchUsers(true), 8000);
    return () => clearInterval(id);
  }, [fetchUsers]);

  const handleRoleChange = (userId: number, newRole: string) => {
    setEditingRole(prev => ({ ...prev, [userId]: newRole }));
    setSaveMsg(prev => { const n = { ...prev }; delete n[userId]; return n; });
  };

  const handleSaveRole = async (user: UserData) => {
    const newRole = editingRole[user.id];
    if (!newRole || newRole === user.role) return;
    setSavingId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setSaveMsg(prev => ({ ...prev, [user.id]: "ok" }));
        setEditingRole(prev => { const n = { ...prev }; delete n[user.id]; return n; });
        fetchUsers(true);
        setTimeout(() => setSaveMsg(prev => { const n = { ...prev }; delete n[user.id]; return n; }), 2500);
      } else {
        setSaveMsg(prev => ({ ...prev, [user.id]: "err" }));
      }
    } catch { setSaveMsg(prev => ({ ...prev, [user.id]: "err" })); }
    finally { setSavingId(null); }
  };

  const handleDelete = async (userId: number) => {
    setDeletingId(userId);
    try {
      await fetch(`/api/users/${userId}`, { method: "DELETE" });
      fetchUsers(true);
    } catch { }
    finally { setDeletingId(null); setConfirmDeleteId(null); }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true); setAddError(""); setAddSuccess(false);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        setAddSuccess(true);
        setAddForm({ email: "", password: "", role: "viewer" });
        fetchUsers(true);
        setTimeout(() => setAddSuccess(false), 3000);
      } else {
        const d = await res.json();
        setAddError(d.error || "Failed to add user");
      }
    } catch { setAddError("Network error"); }
    finally { setAdding(false); }
  };

  // Derived stats
  const totalUsers = users.length;
  const adminCount = users.filter(u => u.role === "admin").length;
  const onlineCount = users.filter(u => u.isOnline).length;

  const filtered = users.filter(u => {
    const matchesSearch = u.email.toLowerCase().includes(search.toLowerCase());
    const matchesRole = filterRole === "all" || u.role === filterRole;
    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-slate-50 font-sans">
      {/* Top Nav */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-500 hover:text-sky-600 hover:bg-sky-50 border border-transparent hover:border-sky-200 transition-all text-xs font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="h-5 w-px bg-slate-200" />
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/15 rounded-xl border border-sky-500/25">
              <Shield className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h1 className="text-sm font-black text-slate-900 tracking-tight">User Permissions</h1>
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">Access Control Management</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => fetchUsers(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-sky-50 hover:border-sky-200 text-xs font-bold transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-sky-500" : ""}`} />
          Refresh
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Users", value: totalUsers, icon: Users, color: "text-slate-600", bg: "bg-white", iconBg: "bg-slate-100 border-slate-200" },
            { label: "Admins", value: adminCount, icon: Crown, color: "text-sky-600", bg: "bg-white", iconBg: "bg-sky-500/10 border-sky-500/20" },
            { label: "Online Now", value: onlineCount, icon: Wifi, color: "text-emerald-600", bg: "bg-white", iconBg: "bg-emerald-500/10 border-emerald-500/20" },
          ].map(stat => (
            <div key={stat.label} className={`${stat.bg} border border-slate-200 rounded-2xl p-5 flex items-center gap-4 shadow-sm`}>
              <div className={`p-3 rounded-xl border ${stat.iconBg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900">{stat.value}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Add User Form */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-sky-600" />
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Add User</h2>
                </div>
              </div>
              <form onSubmit={handleAddUser} className="p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email / Username</label>
                  <input
                    type="text"
                    required
                    value={addForm.email}
                    onChange={e => setAddForm({ ...addForm, email: e.target.value })}
                    placeholder="user@company.com"
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-400 focus:bg-white transition-all placeholder:text-slate-300"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Password</label>
                    <span className="text-[9px] text-sky-500 font-bold">Optional for SSO</span>
                  </div>
                  <input
                    type="password"
                    value={addForm.password}
                    onChange={e => setAddForm({ ...addForm, password: e.target.value })}
                    placeholder="Leave blank for Microsoft SSO"
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-400 focus:bg-white transition-all placeholder:text-slate-300"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Role</label>
                  <select
                    value={addForm.role}
                    onChange={e => setAddForm({ ...addForm, role: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-sky-400 focus:bg-white transition-all"
                  >
                    <option value="viewer">Viewer — Read Only</option>
                    <option value="admin">Admin — Full Control</option>
                  </select>
                </div>

                {addError && (
                  <div className="flex items-center gap-2 text-red-500 text-xs bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />{addError}
                  </div>
                )}
                {addSuccess && (
                  <div className="flex items-center gap-2 text-emerald-600 text-xs bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />User added successfully!
                  </div>
                )}

                <button
                  type="submit"
                  disabled={adding}
                  className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl transition-all shadow-md shadow-sky-500/20 disabled:opacity-50"
                >
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add User
                </button>
              </form>

              {/* Role Legend */}
              <div className="px-6 pb-6 flex flex-col gap-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Role Permissions</p>
                <div className="flex items-start gap-2.5 p-3 bg-sky-50 border border-sky-100 rounded-xl">
                  <Crown className="w-3.5 h-3.5 text-sky-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black text-sky-700 uppercase tracking-wide">Admin</p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">Add/remove servers, manage users, view audit trail, full log access</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <Eye className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-wide">Viewer</p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">Can browse servers and stream logs. Cannot modify any settings</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Users Table */}
          <div className="lg:col-span-2">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              {/* Table Header + Filters */}
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-slate-500" />
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">Active Users</h2>
                    <span className="text-[10px] font-black bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{filtered.length}</span>
                  </div>
                  {/* Role filter pills */}
                  <div className="flex items-center gap-1">
                    {(["all", "admin", "viewer"] as const).map(role => (
                      <button
                        key={role}
                        onClick={() => setFilterRole(role)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${filterRole === role
                          ? "bg-sky-500 text-white shadow-md shadow-sky-500/20"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by email..."
                    className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl pl-9 pr-4 py-2 outline-none focus:border-sky-400 transition-all placeholder:text-slate-300"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* User rows */}
              <div className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
                    <Users className="w-8 h-8 opacity-30" />
                    <p className="text-xs font-bold uppercase tracking-widest">No users found</p>
                  </div>
                )}
                {filtered.map(user => {
                  const isCurrent = user.email.toLowerCase() === currentUserEmail.toLowerCase();
                  const pendingRole = editingRole[user.id];
                  const hasChange = pendingRole && pendingRole !== user.role;
                  const roleCfg = ROLE_CONFIG[user.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.viewer;
                  const RoleIcon = roleCfg.icon;
                  const sso = isSSO(user.email) && !user.email.includes("root");

                  return (
                    <div key={user.id} className={`px-6 py-4 flex items-center gap-4 transition-colors hover:bg-slate-50/80 ${isCurrent ? "bg-sky-50/40" : ""}`}>
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getAvatarColor(user.email)} flex items-center justify-center shrink-0 shadow-md`}>
                        <span className="text-white font-black text-sm">{getInitial(user.email)}</span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-800 truncate max-w-[180px]" title={user.email}>{user.email}</span>
                          {user.isOnline && (
                            <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 uppercase tracking-wide">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.7)]" />
                              Online
                            </span>
                          )}
                          {!user.isOnline && (
                            <span className="flex items-center gap-1 text-[9px] font-semibold text-slate-300 uppercase">
                              <WifiOff className="w-2.5 h-2.5" />Offline
                            </span>
                          )}
                          {isCurrent && (
                            <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-widest">You</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {/* Auth type badge */}
                          <span className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide border ${sso ? "bg-violet-50 text-violet-600 border-violet-200" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
                            {sso ? (
                              <><svg className="w-2.5 h-2.5" viewBox="0 0 23 23" fill="none"><rect width="10" height="10" fill="#F35325" /><rect x="11" width="10" height="10" fill="#81BC06" /><rect y="11" width="10" height="10" fill="#05A6F0" /><rect x="11" y="11" width="10" height="10" fill="#FFBA08" /></svg>Microsoft SSO</>
                            ) : (
                              <><Lock className="w-2.5 h-2.5" />Password</>
                            )}
                          </span>
                          {/* Joined date */}
                          <span className="flex items-center gap-1 text-[9px] text-slate-400 font-semibold">
                            <Calendar className="w-2.5 h-2.5" />
                            {formatDate(user.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* Role editor */}
                      <div className="flex items-center gap-2 shrink-0">
                        {!isCurrent ? (
                          <>
                            {user.role === "viewer" && (
                              <button
                                onClick={() => {
                                  setSelectedUserForGroups(user);
                                  fetchUserGroups(user.id);
                                }}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-sky-500/20 bg-sky-50 hover:bg-sky-100 text-sky-600 text-[10px] font-black uppercase tracking-wide transition-all shadow-sm"
                                title="Manage Server Group Access"
                              >
                                <Folder className="w-3.5 h-3.5" />
                                <span>Groups</span>
                              </button>
                            )}

                            <div className="relative">
                              <select
                                value={pendingRole ?? user.role}
                                onChange={e => handleRoleChange(user.id, e.target.value)}
                                className={`appearance-none pl-7 pr-6 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide border outline-none transition-all cursor-pointer ${hasChange
                                  ? "bg-amber-50 border-amber-300 text-amber-700"
                                  : `${roleCfg.bg} ${roleCfg.border} ${roleCfg.color}`
                                  }`}
                              >
                                <option value="viewer">Viewer</option>
                                <option value="admin">Admin</option>
                              </select>
                              <RoleIcon className={`absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none ${hasChange ? "text-amber-500" : roleCfg.color}`} />
                              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 pointer-events-none text-slate-400" />
                            </div>

                            {/* Save button — only appears when role changed */}
                            {hasChange && (
                              <button
                                onClick={() => handleSaveRole(user)}
                                disabled={savingId === user.id}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-black uppercase tracking-wide transition-all shadow-md shadow-sky-500/20 disabled:opacity-50"
                              >
                                {savingId === user.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Save
                              </button>
                            )}

                            {/* Save feedback */}
                            {saveMsg[user.id] === "ok" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                            {saveMsg[user.id] === "err" && <AlertCircle className="w-4 h-4 text-red-500" />}

                            {/* Delete */}
                            {confirmDeleteId === user.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleDelete(user.id)}
                                  disabled={deletingId === user.id}
                                  className="px-2 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[10px] font-black uppercase transition-all"
                                >
                                  {deletingId === user.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase transition-all"
                                >Cancel</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(user.id)}
                                className="p-1.5 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all"
                                title="Delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        ) : (
                          // Current user — show role badge only, no edit
                          <span className={`flex items-center gap-1 pl-2 pr-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide border ${roleCfg.bg} ${roleCfg.border} ${roleCfg.color}`}>
                            <RoleIcon className="w-3 h-3" />
                            {roleCfg.label}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {filtered.length > 0 && (
                <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50">
                  <p className="text-[10px] text-slate-400 font-semibold">
                    Showing {filtered.length} of {totalUsers} users
                    {search && ` · filtered by "${search}"`}
                    {filterRole !== "all" && ` · role: ${filterRole}`}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Server Group Access Modal */}
      {selectedUserForGroups && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-[24px] shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-sky-500/20 border border-sky-500/30 rounded-xl">
                  <Folder className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Server Group Access</h3>
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider truncate max-w-[200px]" title={selectedUserForGroups.email}>
                    For {selectedUserForGroups.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedUserForGroups(null)}
                className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex-1 overflow-y-auto max-h-[300px] flex flex-col gap-4">
              <p className="text-xs text-slate-500 leading-relaxed font-medium">
                Assign which server groups this user is allowed to access. If no groups are assigned, the user will have an empty dashboard.
              </p>

              {loadingUserGroups ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Loading permissions...</span>
                </div>
              ) : groups.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-400 italic">No groups defined. Create groups in the sidebar first.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {groups.map(g => {
                    const isChecked = assignedGroupIds.includes(g.id);
                    return (
                      <label
                        key={g.id}
                        className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                          isChecked
                            ? "bg-sky-50/50 border-sky-500/30 text-sky-900"
                            : "bg-white border-slate-200 hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-4">
                          <span className="text-xs font-bold truncate">{g.name}</span>
                          {g.description && <span className="text-[10px] text-slate-400 truncate mt-0.5">{g.description}</span>}
                          <span className="text-[9px] font-mono text-sky-600/70 mt-1 uppercase tracking-tight font-black">
                            {g.servers?.length || 0} servers
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            setAssignedGroupIds(prev =>
                              isChecked ? prev.filter(id => id !== g.id) : [...prev, g.id]
                            );
                          }}
                          className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 w-4 h-4 shrink-0"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setSelectedUserForGroups(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUserGroups}
                disabled={savingUserGroups || loadingUserGroups}
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-black uppercase tracking-widest shadow-md transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {savingUserGroups ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
