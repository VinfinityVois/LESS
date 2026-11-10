import { useEffect, useState, useCallback } from "react";
import { History, BadgeCheck, LockOpen, Ban, RefreshCw, UserCheck } from "lucide-react";
import VideoFeed from "../components/VideoFeed";
import { getLogs, AccessLog } from "../services/api";
import { ru } from "../i18n/ru";

function fmt(iso?: string | null) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString("ru-RU"); } catch { return iso; }
}

export default function LivePage({ status }: { status: any }) {
  const [logs, setLogs] = useState<AccessLog[]>([]);

  const load = useCallback(async () => {
    try { setLogs(await getLogs(40)); } catch { setLogs([]); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0a0e16] p-2 rounded-xl">
        <div className="flex items-center gap-2 font-mono-label">
          <span className="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse" />
          <span className="text-secondary font-bold">{ru.postGuard}</span>
          <span className="text-outline">|</span>
          <span className="text-[#bcc9cd]">{ru.armTitle}</span>
        </div>
        <div className="flex gap-1 flex-wrap font-mono-label">
          <span className="px-1.5 py-0.5 rounded bg-surface-high text-secondary flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            CAM: {status?.camera ?? "-"}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-surface-high text-secondary flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            3D-LIVENESS
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-8 space-y-3">
          <div className="relative aspect-[16/10] bg-[#0a0e16] rounded-xl overflow-hidden border border-surface-highest/30">
            <VideoFeed />
            <div className="absolute top-3 left-3 z-10 flex gap-1.5">
              <span className="px-2 py-1 rounded bg-[#0a0e16]/90 text-error font-mono-label flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" /> REC
              </span>
              <span className="px-2 py-1 rounded bg-[#0a0e16]/90 font-mono-label">
                <span className="text-primary font-bold">CAM_01 //</span> {ru.turnstile}
              </span>
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
                <div>
                  <div className="text-sm font-semibold text-secondary">{ru.waitingSubject}</div>
                  <div className="font-mono-label text-[#bcc9cd]">{ru.waitingHint}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-surface-low rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <History className="w-4 h-4 text-primary" />
              <span className="font-display font-semibold text-sm">{ru.lastEvents}</span>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {logs.slice(0, 8).map((l) => (
                <div key={l.id} className="flex justify-between text-xs border-t border-surface-highest/20 py-1 gap-2">
                  <span className="font-mono text-primary shrink-0">{fmt(l.created_at)}</span>
                  <span className="font-mono truncate">{l.nfc_uid || "-"}</span>
                  <span className={l.event_type === "granted" ? "text-secondary shrink-0" : "text-error shrink-0"}>
                    {l.event_type === "granted" ? ru.granted : ru.denied}
                  </span>
                </div>
              ))}
              {!logs.length && <p className="text-outline text-center py-4">{ru.noEvents}</p>}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-3">
          <div className="bg-surface-low rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-secondary" />
                <span className="font-display font-semibold text-sm">{ru.verification}</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-secondary text-slate-950 font-mono-label animate-pulse">
                STANDBY
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[ru.liveFrame, ru.frontal, ru.profile].map((t) => (
                <div key={t} className="aspect-square rounded-lg bg-[#0a0e16] border border-surface-highest flex items-center justify-center">
                  <span className="font-mono-label text-outline">{t}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#0a0e16] p-3 rounded-lg">
              <div className="flex justify-between items-end">
                <span className="font-mono-label text-outline">{ru.match}</span>
                <span className="font-display text-2xl font-bold text-secondary">-</span>
              </div>
            </div>
          </div>

          <div className="bg-surface-low rounded-xl p-4 space-y-2">
            <div className="font-mono-label text-outline">{ru.card}</div>
            <div className="font-display text-lg font-bold">-</div>
            <div className="text-sm text-primary">{ru.waitingSubject}</div>
          </div>

          <div className="bg-surface-low rounded-xl p-4 space-y-2">
            <div className="font-mono-label text-outline">{ru.actions}</div>
            <button className="w-full py-2.5 rounded-lg bg-secondary text-slate-950 font-semibold text-sm flex items-center justify-center gap-2">
              <LockOpen className="w-4 h-4" /> {ru.forceOpen}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className="py-2 rounded-lg bg-surface-high text-sm flex items-center justify-center gap-1">
                <UserCheck className="w-4 h-4 text-primary" /> {ru.confirm}
              </button>
              <button className="py-2 rounded-lg bg-error-container text-error text-sm flex items-center justify-center gap-1">
                <Ban className="w-4 h-4" /> {ru.block}
              </button>
            </div>
            <button className="w-full py-2 rounded-lg bg-[#0a0e16] text-outline text-xs font-mono-label flex items-center justify-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> {ru.reset}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
