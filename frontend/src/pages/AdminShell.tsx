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

function StatusPill({
  icon: Icon,
  label,
  ok = true,
  pulse = false,
}: {
  icon: typeof Server;
  label: string;
  ok?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05] font-mono-label ${
        ok ? "text-secondary" : "text-error"
      }`}
    >
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />}
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

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
    <div className="h-screen bg-[#0c0f14] text-[#e8eaef] flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[240px] shrink-0 bg-[#0a0d12] flex flex-col border-r border-white/[0.05] z-20">
        <div className="p-4 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Radio className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <div className="font-display font-bold text-primary tracking-tight text-[15px]">
              {ru.brand}
            </div>
            <div className="font-mono-label text-[#5c6570]">{ru.subtitle}</div>
          </div>
        </div>

        <div className="px-3 mb-3">
          <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
            <div className="flex justify-between font-mono-label text-[#5c6570]">
              <span>{ru.zoneSelect}</span>
              <span className="text-secondary">CH 01</span>
            </div>
            <div className="text-xs mt-1 text-[#9aa3b2] truncate">{ru.zoneName}</div>
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
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all ${
                  active
                    ? "bg-primary/15 text-primary font-medium border border-primary/20"
                    : "text-[#8b95a5] hover:bg-white/[0.04] hover:text-[#d0d5de] border border-transparent"
                }`}
              >
                <Icon className="w-[17px] h-[17px] shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 space-y-2 border-t border-white/[0.04]">
          <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[10px] font-mono space-y-1">
            <div className="flex justify-between">
              <span className="text-[#5c6570]">{ru.backend}</span>
              <span className={backendOnline ? "text-secondary" : "text-error"}>
                {backendOnline ? ru.online : ru.offline}
              </span>
            </div>
            {status && (
              <div className="flex justify-between text-[#5c6570]">
                <span>CAM</span>
                <span className={status.camera === "running" ? "text-secondary" : ""}>
                  {status.camera}
                </span>
              </div>
            )}
          </div>
          <div className="text-center font-mono-label text-[#3d4450] py-1">LESS VISION OS</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-13 shrink-0 px-4 border-b border-white/[0.05] bg-[#0c0f14]/90 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 flex-wrap py-2.5">
            <StatusPill icon={Radio} label="LIVE" pulse ok />
            <StatusPill
              icon={Server}
              label={backendOnline ? "BACKEND" : "OFFLINE"}
              ok={backendOnline}
            />
            <StatusPill icon={Brain} label="AI ENGINE" ok />
            <StatusPill icon={Nfc} label="NFC" ok />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-mono text-primary text-sm bg-white/[0.03] border border-white/[0.05] px-2.5 py-1 rounded-md">
              <Clock className="w-3.5 h-3.5" />
              {clock}
              <span className="font-mono-label text-[#5c6570] ml-0.5">MSK</span>
            </div>
            <button className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7a8494] hover:bg-white/[0.05] transition">
              <Bell className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 pl-2 border-l border-white/[0.06]">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium leading-tight">{ru.operator}</div>
                <div className="font-mono-label text-[#5c6570]">{ru.operatorRole}</div>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-5">
          {nav === "live" && <LivePage status={status} />}
          {nav === "users" && <UsersPage onEnroll={setEnrollUser} />}
          {nav === "logs" && <LogsPage />}
          {nav === "guests" && (
            <div className="max-w-md space-y-3">
              <div className="bg-[#12161e] border border-white/[0.06] rounded-2xl p-5">
                <h2 className="font-display font-semibold mb-3">Гостевые коды</h2>
                <button
                  className="w-full px-4 py-2.5 rounded-xl bg-secondary text-slate-950 font-semibold text-sm hover:brightness-110 transition"
                  onClick={async () => {
                    const { createGuestCode } = await import("../services/api");
                    const r = await createGuestCode({
                      label: "Guest",
                      valid_hours: 2,
                      max_uses: 1,
                    });
                    setGuestMsg("Код: " + r.code + " до " + r.expires_at);
                  }}
                >
                  {ru.createGuest}
                </button>
                {guestMsg && (
                  <p className="mt-3 font-mono text-sm text-secondary bg-secondary/10 border border-secondary/20 rounded-xl p-3">
                    {guestMsg}
                  </p>
                )}
              </div>
            </div>
          )}
          {nav === "incidents" && (
            <div className="bg-[#12161e] border border-white/[0.06] rounded-2xl p-8 text-center">
              <AlertTriangle className="w-8 h-8 text-[#5c6570] mx-auto mb-3" />
              <p className="text-[#7a8494] text-sm">{ru.incidentsHint}</p>
            </div>
          )}
          {nav === "diagnostics" && (
            <div className="bg-[#12161e] border border-white/[0.06] rounded-2xl p-5 space-y-3 font-mono text-sm max-w-lg">
              <h2 className="font-display font-semibold text-base mb-2">Диагностика</h2>
              {[
                ["Backend", backendOnline ? "ok" : "down"],
                ["Camera", status?.camera ?? "-"],
                ["Serial", status?.serial ?? "-"],
                ["DB", status?.db ?? "-"],
                ["AI", status?.ai ?? "-"],
                ["WS clients", String(status?.clients_ws ?? 0)],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between py-2 border-b border-white/[0.04] last:border-0"
                >
                  <span className="text-[#5c6570]">{k}</span>
                  <span className={v === "ok" || v === "running" ? "text-secondary" : ""}>
                    {v}
                  </span>
                </div>
              ))}
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
