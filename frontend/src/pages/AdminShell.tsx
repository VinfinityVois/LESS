import { useEffect, useState, useCallback } from "react";
import {
  Video, BadgeCheck, History, AlertTriangle, FolderOpen, Settings2,
  Radio, Server, Brain, Nfc, Clock, Bell, User, LockOpen, Ban, RefreshCw, UserCheck,
} from "lucide-react";
import VideoFeed from "../components/VideoFeed";
import FaceEnroll from "../components/FaceEnroll";
import { useSystemStore } from "../stores/systemStore";
import {
  listUsers, createUser, updateUser, deleteUser, getUser, getLogs,
  createGuestCode, User as UserType, AccessLog,
} from "../services/api";

type NavId = "live" | "logs" | "incidents" | "users" | "user-detail" | "diagnostics" | "guests";

const NAV: { id: NavId; label: string; icon: typeof Video }[] = [
  { id: "live", label: "Live \u041c\u043e\u043d\u0438\u0442\u043e\u0440\u0438\u043d\u0433", icon: Video },
  { id: "logs", label: "\u0416\u0443\u0440\u043d\u0430\u043b \u041f\u0440\u043e\u0445\u043e\u0434\u043e\u0432", icon: History },
  { id: "incidents", label: "\u0418\u043d\u0446\u0438\u0434\u0435\u043d\u0442\u044b", icon: AlertTriangle },
  { id: "users", label: "\u0411\u0430\u0437\u0430 \u041b\u0438\u0446 / \u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438", icon: FolderOpen },
  { id: "guests", label: "\u0413\u043e\u0441\u0442\u0435\u0432\u044b\u0435 \u043a\u043e\u0434\u044b", icon: BadgeCheck },
  { id: "diagnostics", label: "\u0414\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0430", icon: Settings2 },
];

function fmt(iso?: string | null) {
  if (!iso) return "\u2014";
  try { return new Date(iso).toLocaleString("ru-RU"); } catch { return iso; }
}

export default function AdminShell() {
  const { status, backendOnline, refresh } = useSystemStore();
  const [nav, setNav] = useState<NavId>("live");
  const [clock, setClock] = useState("");
  const [users, setUsers] = useState<UserType[]>([]);
  const [selected, setSelected] = useState<UserType | null>(null);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [enrollUser, setEnrollUser] = useState<UserType | null>(null);
  const [form, setForm] = useState({ name: "", position: "", nfc_uid: "", pin: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [guestMsg, setGuestMsg] = useState("");

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setClock(n.toLocaleTimeString("ru-RU", { hour12: false }) + "." + String(n.getMilliseconds()).padStart(3, "0"));
    };
    tick();
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }, []);

  const loadUsers = useCallback(async () => { try { setUsers(await listUsers(true)); } catch { setUsers([]); } }, []);
  const loadLogs = useCallback(async () => { try { setLogs(await getLogs(40)); } catch { setLogs([]); } }, []);
  useEffect(() => {
    if (nav === "users" || nav === "user-detail") loadUsers();
    if (nav === "logs" || nav === "live") loadLogs();
  }, [nav, loadUsers, loadLogs]);

  const openUser = async (id: number) => { setSelected(await getUser(id)); setNav("user-detail"); };
  const saveUser = async () => {
    setMsg("");
    try {
      if (editId) await updateUser(editId, { name: form.name, position: form.position, nfc_uid: form.nfc_uid, pin: form.pin || undefined });
      else await createUser({ name: form.name, position: form.position, nfc_uid: form.nfc_uid, pin: form.pin || undefined });
      setForm({ name: "", position: "", nfc_uid: "", pin: "" }); setEditId(null); await loadUsers(); setMsg("\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e");
    } catch (e: any) { setMsg(e?.response?.data?.error || e.message || "\u041e\u0448\u0438\u0431\u043a\u0430"); }
  };

  return (
    <div className="h-screen bg-surface text-[#dfe2ee] flex overflow-hidden">
      <aside className="w-64 shrink-0 bg-[#0a0e16] flex flex-col border-r border-surface-highest/40 z-20">
        <div className="p-4 flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-surface-high flex items-center justify-center"><Radio className="w-5 h-5 text-primary" /></div>
          <div><div className="font-display font-bold text-primary tracking-tight">LESS AI</div><div className="font-mono-label text-secondary">\u0421\u041a\u0423\u0414 MONITORING</div></div>
        </div>
        <div className="px-4 mb-3"><div className="px-2 py-2 rounded bg-surface-low"><div className="flex justify-between font-mono-label text-outline"><span>ZONE SELECT</span><span className="text-secondary">CH 01</span></div><div className="text-xs mt-0.5 truncate">Main Turnstile Zone</div></div></div>
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = nav === item.id || (nav === "user-detail" && item.id === "users");
            return (
              <button key={item.id} onClick={() => setNav(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition ${active ? "bg-primary-container text-slate-950 font-semibold" : "text-[#bcc9cd] hover:bg-surface-high hover:text-white"}`}>
                <Icon className="w-[18px] h-[18px] shrink-0" /><span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 space-y-2">
          <div className="p-2 rounded-lg bg-surface-low text-[10px] font-mono space-y-1">
            <div className="flex justify-between"><span className="text-outline">BACKEND</span><span className={backendOnline ? "text-secondary" : "text-error"}>{backendOnline ? "ONLINE" : "OFFLINE"}</span></div>
          </div>
          <div className="text-center font-mono-label text-outline">LESS VISION OS</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 px-4 border-b border-surface-highest/40 bg-surface/90 backdrop-blur flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label text-secondary"><span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />LIVE</span>
            <span className={`flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label ${backendOnline ? "text-secondary" : "text-error"}`}><Server className="w-3.5 h-3.5" />{backendOnline ? "BACKEND ONLINE" : "OFFLINE"}</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label text-primary"><Brain className="w-3.5 h-3.5" />AI ENGINE</span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label text-secondary"><Nfc className="w-3.5 h-3.5" />NFC</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-mono text-primary text-sm bg-[#0a0e16] px-2 py-1 rounded"><Clock className="w-4 h-4" />{clock}<span className="font-mono-label text-outline ml-1">MSK</span></div>
            <Bell className="w-5 h-5 text-[#bcc9cd]" />
            <div className="flex items-center gap-2 pl-2 border-l border-surface-highest">
              <div className="text-right hidden sm:block"><div className="text-sm font-semibold leading-tight">\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440</div><div className="font-mono-label text-secondary">\u041e\u043f\u0435\u0440\u0430\u0442\u043e\u0440 \u0421\u0411</div></div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center"><User className="w-4 h-4 text-slate-950" /></div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4">
          {nav === "live" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0a0e16] p-2 rounded-xl">
                <div className="flex items-center gap-2 font-mono-label">
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse" />
                  <span className="text-secondary font-bold">\u041f\u041e\u0421\u0422 \u041e\u0425\u0420\u0410\u041d\u042b: \u041a\u041f\u041f-1</span>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-8 space-y-3">
                  <div className="relative aspect-[16/10] bg-[#0a0e16] rounded-xl overflow-hidden border border-surface-highest/30">
                    <VideoFeed />
                    <div className="absolute top-3 left-3 z-10 flex gap-1.5">
                      <span className="px-2 py-1 rounded bg-[#0a0e16]/90 text-error font-mono-label flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" /> REC</span>
                      <span className="px-2 py-1 rounded bg-[#0a0e16]/90 font-mono-label"><span className="text-primary font-bold">CAM_01 //</span> \u0422\u0423\u0420\u041d\u0418\u041a\u0415\u0422 \u0410</span>
                    </div>
                    <div className="absolute top-[22%] left-1/2 -translate-x-1/2 w-[160px] h-[190px] pointer-events-none z-10">
                      <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-secondary" />
                      <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-secondary" />
                      <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-secondary" />
                      <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-secondary" />
                    </div>
                    <div className="absolute bottom-3 left-3 z-10">
                      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0a0e16]/95 border-l-4 border-secondary">
                        <LockOpen className="w-5 h-5 text-secondary" />
                        <div><div className="text-sm font-semibold text-secondary">\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435 \u0441\u0443\u0431\u044a\u0435\u043a\u0442\u0430</div><div className="font-mono-label text-[#bcc9cd]">\u041f\u043e\u0434\u043d\u0435\u0441\u0438\u0442\u0435 \u043a\u0430\u0440\u0442\u0443 \u0438\u043b\u0438 \u0432\u0441\u0442\u0430\u043d\u044c\u0442\u0435 \u0432 \u043a\u0430\u0434\u0440</div></div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-surface-low rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2"><History className="w-4 h-4 text-primary" /><span className="font-display font-semibold text-sm">\u041f\u041e\u0421\u041b\u0415\u0414\u041d\u0418\u0415 \u0421\u041e\u0411\u042b\u0422\u0418\u042f</span></div>
                    <div className="max-h-40 overflow-y-auto">
                      {logs.slice(0, 8).map((l) => (
                        <div key={l.id} className="flex justify-between text-xs border-t border-surface-highest/20 py-1">
                          <span className="font-mono text-primary">{fmt(l.created_at)}</span>
                          <span className="font-mono">{l.nfc_uid || "\u2014"}</span>
                          <span className={l.event_type === "granted" ? "text-secondary" : "text-error"}>{l.event_type}</span>
                        </div>
                      ))}
                      {!logs.length && <p className="text-outline text-center py-4">\u041d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439</p>}
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-4 space-y-3">
                  <div className="bg-surface-low rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><BadgeCheck className="w-5 h-5 text-secondary" /><span className="font-display font-semibold text-sm">\u0412\u0415\u0420\u0418\u0424\u0418\u041a\u0410\u0426\u0418\u042f</span></div>
                      <span className="px-1.5 py-0.5 rounded bg-secondary text-slate-950 font-mono-label animate-pulse">STANDBY</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {["LIVE", "\u0410\u041d\u0424\u0410\u0421", "\u041f\u0420\u041e\u0424\u0418\u041b\u042c"].map((t) => (
                        <div key={t} className="aspect-square rounded-lg bg-[#0a0e16] border border-surface-highest flex items-center justify-center"><span className="font-mono-label text-outline">{t}</span></div>
                      ))}
                    </div>
                    <div className="bg-[#0a0e16] p-3 rounded-lg">
                      <div className="flex justify-between items-end"><span className="font-mono-label text-outline">\u0421\u041e\u0412\u041f\u0410\u0414\u0415\u041d\u0418\u0415</span><span className="font-display text-2xl font-bold text-secondary">\u2014</span></div>
                    </div>
                  </div>
                  <div className="bg-surface-low rounded-xl p-4 space-y-2">
                    <div className="font-mono-label text-outline">\u0414\u0415\u0419\u0421\u0422\u0412\u0418\u042f</div>
                    <button className="w-full py-2.5 rounded-lg bg-secondary text-slate-950 font-semibold text-sm flex items-center justify-center gap-2"><LockOpen className="w-4 h-4" /> \u041e\u0422\u041a\u0420\u042b\u0422\u042c</button>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="py-2 rounded-lg bg-surface-high text-sm flex items-center justify-center gap-1"><UserCheck className="w-4 h-4 text-primary" /> OK</button>
                      <button className="py-2 rounded-lg bg-error-container text-error text-sm flex items-center justify-center gap-1"><Ban className="w-4 h-4" /> \u0411\u043b\u043e\u043a</button>
                    </div>
                    <button className="w-full py-2 rounded-lg bg-[#0a0e16] text-outline text-xs font-mono-label flex items-center justify-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> RESET</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {nav === "users" && (
            <div className="grid lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2 bg-surface-low rounded-xl p-4 space-y-3">
                <h2 className="font-display font-semibold">{editId ? "\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435" : "\u041d\u043e\u0432\u044b\u0439 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c"}</h2>
                {([["name", "\u0424\u0418\u041e"], ["position", "\u0414\u043e\u043b\u0436\u043d\u043e\u0441\u0442\u044c"], ["nfc_uid", "NFC UID"], ["pin", "\u041f\u0418\u041d"]] as const).map(([k, lab]) => (
                  <div key={k}>
                    <label className="font-mono-label text-outline block mb-1">{lab}</label>
                    <input type={k === "pin" ? "password" : "text"} className="w-full px-3 py-2 rounded-lg bg-surface border border-surface-highest text-sm focus:border-primary focus:outline-none" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                  </div>
                ))}
                <button onClick={saveUser} disabled={!form.nfc_uid} className="w-full py-2 rounded-lg bg-primary-container text-slate-950 font-semibold text-sm disabled:opacity-40">{editId ? "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c" : "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c"}</button>
                {msg && <p className="text-xs text-outline">{msg}</p>}
              </div>
              <div className="lg:col-span-3 bg-surface-low rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="font-mono-label text-outline bg-[#0a0e16]"><tr><th className="text-left p-2">\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a</th><th className="text-left p-2">\u0421\u0442\u0430\u0442\u0443\u0441</th><th className="text-left p-2">\u0412\u0445\u043e\u0434/\u0412\u044b\u0445\u043e\u0434</th><th className="p-2" /></tr></thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-t border-surface-highest/30 hover:bg-surface-high/40">
                        <td className="p-2"><button onClick={() => openUser(u.id)} className="text-left hover:text-primary"><div className="font-medium">{u.name || "\u2014"}</div><div className="font-mono text-[10px] text-outline">{u.nfc_uid}</div></button></td>
                        <td className="p-2"><span className={`text-[10px] px-1.5 py-0.5 rounded font-mono-label ${u.is_active ? "bg-secondary/20 text-secondary" : "bg-surface-highest text-outline"}`}>{u.is_active ? "\u0410\u041a\u0422\u0418\u0412\u0415\u041d" : "OFF"}</span></td>
                        <td className="p-2 text-[10px] text-[#bcc9cd]"><div>\u2193 {fmt(u.last_entry)}</div><div>\u2191 {fmt(u.last_exit)}</div></td>
                        <td className="p-2 text-right text-xs">
                          <button className="text-outline mr-2" onClick={() => { setEditId(u.id); setForm({ name: u.name || "", position: u.position || "", nfc_uid: u.nfc_uid, pin: "" }); }}>\u0438\u0437\u043c.</button>
                          <button className="text-primary mr-2" onClick={() => setEnrollUser(u)}>\u043b\u0438\u0446\u043e</button>
                          <button className="text-error" onClick={async () => { if (confirm("?")) { await deleteUser(u.id); loadUsers(); } }}>\u0443\u0434\u0430\u043b.</button>
                        </td>
                      </tr>
                    ))}
                    {!users.length && <tr><td colSpan={4} className="p-8 text-center text-outline">\u041d\u0435\u0442 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {nav === "user-detail" && selected && (
            <div className="max-w-3xl space-y-3">
              <button onClick={() => setNav("users")} className="text-sm text-outline hover:text-white">\u2190 \u041a \u0441\u043f\u0438\u0441\u043a\u0443</button>
              <div className="bg-surface-low rounded-xl p-6">
                <h2 className="font-display text-2xl font-bold">{selected.name || "\u2014"}</h2>
                <p className="text-primary">{selected.position}</p>
                <p className="font-mono text-xs text-outline mt-1">{selected.nfc_uid}</p>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEnrollUser(selected)} className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-sm">\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u043b\u0438\u0446\u0430</button>
                  <button onClick={async () => { await updateUser(selected.id, { is_active: !selected.is_active }); openUser(selected.id); }} className="px-3 py-1.5 rounded-lg bg-surface-high text-sm">{selected.is_active ? "\u041e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c" : "\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c"}</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
                  {[["\u0421\u0442\u0430\u0442\u0443\u0441", selected.is_active ? "\u0410\u043a\u0442\u0438\u0432\u0435\u043d" : "OFF"], ["\u041b\u0438\u0446\u043e", selected.face_enrolled ? "\u0414\u0430" : "\u041d\u0435\u0442"], ["\u0412\u0445\u043e\u0434", fmt(selected.last_entry)], ["\u0412\u044b\u0445\u043e\u0434", fmt(selected.last_exit)], ["\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f", fmt(selected.created_at)]].map(([l, v]) => (
                    <div key={l} className="bg-[#0a0e16] rounded-lg p-2"><div className="font-mono-label text-outline">{l}</div><div className="text-sm mt-0.5">{v}</div></div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {nav === "logs" && (
            <div className="bg-surface-low rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="font-mono-label text-outline bg-[#0a0e16]"><tr><th className="text-left p-2">\u0412\u0440\u0435\u043c\u044f</th><th className="text-left p-2">\u0421\u043e\u0431\u044b\u0442\u0438\u0435</th><th className="text-left p-2">UID</th><th className="text-left p-2">\u041f\u0440\u0438\u0447\u0438\u043d\u0430</th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t border-surface-highest/20">
                      <td className="p-2 font-mono text-xs text-primary">{fmt(l.created_at)}</td>
                      <td className={`p-2 ${l.event_type === "granted" ? "text-secondary" : "text-error"}`}>{l.event_type}</td>
                      <td className="p-2 font-mono text-xs">{l.nfc_uid}</td>
                      <td className="p-2 text-xs text-[#bcc9cd] truncate max-w-xs">{l.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nav === "guests" && (
            <div className="max-w-md space-y-3">
              <button className="px-4 py-2.5 rounded-lg bg-secondary text-slate-950 font-semibold text-sm" onClick={async () => {
                const r = await createGuestCode({ label: "\u0413\u043e\u0441\u0442\u044c", valid_hours: 2, max_uses: 1 });
                setGuestMsg(`\u041a\u043e\u0434: ${r.code} \u00b7 \u0434\u043e ${r.expires_at}`);
              }}>\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0433\u043e\u0441\u0442\u0435\u0432\u043e\u0439 \u043a\u043e\u0434 (2 \u0447)</button>
              {guestMsg && <p className="font-mono text-sm text-secondary bg-surface-low border border-surface-highest rounded-lg p-3">{guestMsg}</p>}
            </div>
          )}

          {nav === "incidents" && <p className="text-outline text-sm">\u0418\u043d\u0446\u0438\u0434\u0435\u043d\u0442\u044b \u043f\u043e\u044f\u0432\u044f\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 lockout / AI.</p>}
          {nav === "diagnostics" && (
            <div className="bg-surface-low rounded-xl p-4 space-y-2 font-mono text-sm">
              <div>Backend: {backendOnline ? "ok" : "down"}</div>
              <div>Camera: {status?.camera ?? "\u2014"}</div>
              <div>Serial: {status?.serial ?? "\u2014"}</div>
              <div>DB: {status?.db ?? "\u2014"}</div>
            </div>
          )}
        </main>
      </div>

      {enrollUser && (
        <FaceEnroll userId={enrollUser.id} userName={enrollUser.name || enrollUser.nfc_uid}
          onDone={() => { setEnrollUser(null); loadUsers(); if (selected?.id === enrollUser.id) openUser(enrollUser.id); }}
          onCancel={() => setEnrollUser(null)} />
      )}
    </div>
  );
}
