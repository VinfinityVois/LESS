import { useEffect, useState } from "react";
import {
  Video, BadgeCheck, History, AlertTriangle, FolderOpen, Settings2,
  Radio, Server, Brain, Nfc, Clock, Bell, User,
} from "lucide-react";
import { useSystemStore } from "../stores/systemStore";
import { ru } from "../i18n/ru";
import LivePage from "./LivePage";
import UsersPage from "./UsersPage";
import LogsPage from "./LogsPage";
import FaceEnroll from "../components/FaceEnroll";
import type { User as UserType } from "../services/api";

type NavId = "live" | "logs" | "incidents" | "users" | "diagnostics" | "guests";

const NAV: { id: NavId; label: string; icon: typeof Video }[] = [
  { id: "live", label: ru.navLive, icon: Video },
  { id: "logs", label: ru.navLogs, icon: History },
  { id: "incidents", label: ru.navIncidents, icon: AlertTriangle },
  { id: "users", label: ru.navUsers, icon: FolderOpen },
  { id: "guests", label: ru.navGuests, icon: BadgeCheck },
  { id: "diagnostics", label: ru.navDiag, icon: Settings2 },
];

export default function AdminShell() {
  const { status, backendOnline, refresh } = useSystemStore();
  const [nav, setNav] = useState<NavId>("live");
  const [clock, setClock] = useState("");
  const [enrollUser, setEnrollUser] = useState<UserType | null>(null);
  const [guestMsg, setGuestMsg] = useState("");

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setClock(
        n.toLocaleTimeString("ru-RU", { hour12: false }) +
          "." +
          String(n.getMilliseconds()).padStart(3, "0")
      );
    };
    tick();
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-screen bg-surface text-[#dfe2ee] flex overflow-hidden">
      <aside className="w-64 shrink-0 bg-[#0a0e16] flex flex-col border-r border-surface-highest/40 z-20">
        <div className="p-4 flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-surface-high flex items-center justify-center">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="font-display font-bold text-primary tracking-tight">{ru.brand}</div>
            <div className="font-mono-label text-secondary">{ru.subtitle}</div>
          </div>
        </div>
        <div className="px-4 mb-3">
          <div className="px-2 py-2 rounded bg-surface-low">
            <div className="flex justify-between font-mono-label text-outline">
              <span>{ru.zoneSelect}</span>
              <span className="text-secondary">CH 01</span>
            </div>
            <div className="text-xs mt-0.5 truncate">{ru.zoneName}</div>
          </div>
        </div>
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setNav(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition ${
                  active
                    ? "bg-primary-container text-slate-950 font-semibold"
                    : "text-[#bcc9cd] hover:bg-surface-high hover:text-white"
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 space-y-2">
          <div className="p-2 rounded-lg bg-surface-low text-[10px] font-mono space-y-1">
            <div className="flex justify-between">
              <span className="text-outline">{ru.backend}</span>
              <span className={backendOnline ? "text-secondary" : "text-error"}>
                {backendOnline ? ru.online : ru.offline}
              </span>
            </div>
          </div>
          <div className="text-center font-mono-label text-outline">LESS VISION OS</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 px-4 border-b border-surface-highest/40 bg-surface/90 backdrop-blur flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label text-secondary">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" /> LIVE
            </span>
            <span
              className={`flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label ${
                backendOnline ? "text-secondary" : "text-error"
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              {backendOnline ? "BACKEND ONLINE" : "OFFLINE"}
            </span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label text-primary">
              <Brain className="w-3.5 h-3.5" /> AI ENGINE
            </span>
            <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0a0e16] font-mono-label text-secondary">
              <Nfc className="w-3.5 h-3.5" /> NFC
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-mono text-primary text-sm bg-[#0a0e16] px-2 py-1 rounded">
              <Clock className="w-4 h-4" />
              {clock}
              <span className="font-mono-label text-outline ml-1">MSK</span>
            </div>
            <Bell className="w-5 h-5 text-[#bcc9cd]" />
            <div className="flex items-center gap-2 pl-2 border-l border-surface-highest">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-semibold leading-tight">{ru.operator}</div>
                <div className="font-mono-label text-secondary">{ru.operatorRole}</div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <User className="w-4 h-4 text-slate-950" />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4">
          {nav === "live" && <LivePage status={status} />}
          {nav === "users" && <UsersPage onEnroll={setEnrollUser} />}
          {nav === "logs" && <LogsPage />}
          {nav === "guests" && (
            <div className="max-w-md space-y-3">
              <button
                className="px-4 py-2.5 rounded-lg bg-secondary text-slate-950 font-semibold text-sm"
                onClick={async () => {
                  const { createGuestCode } = await import("../services/api");
                  const r = await createGuestCode({ label: "Guest", valid_hours: 2, max_uses: 1 });
                  setGuestMsg("Code: " + r.code + " until " + r.expires_at);
                }}
              >
                {ru.createGuest}
              </button>
              {guestMsg && (
                <p className="font-mono text-sm text-secondary bg-surface-low border border-surface-highest rounded-lg p-3">
                  {guestMsg}
                </p>
              )}
            </div>
          )}
          {nav === "incidents" && <p className="text-outline text-sm">{ru.incidentsHint}</p>}
          {nav === "diagnostics" && (
            <div className="bg-surface-low rounded-xl p-4 space-y-2 font-mono text-sm">
              <div>Backend: {backendOnline ? "ok" : "down"}</div>
              <div>Camera: {status?.camera ?? "-"}</div>
              <div>Serial: {status?.serial ?? "-"}</div>
              <div>DB: {status?.db ?? "-"}</div>
            </div>
          )}
        </main>
      </div>

      {enrollUser && (
        <FaceEnroll
          userId={enrollUser.id}
          userName={enrollUser.name || enrollUser.nfc_uid}
          onDone={() => setEnrollUser(null)}
          onCancel={() => setEnrollUser(null)}
        />
      )}
    </div>
  );
}
