import { useEffect, useState, useCallback } from "react";
import {
  History, BadgeCheck, LockOpen, Ban, RefreshCw, UserCheck,
} from "lucide-react";
import VideoFeed from "../components/VideoFeed";
import { getLogs, AccessLog } from "../services/api";
import { lessWs } from "../services/websocket";
import { ru } from "../i18n/ru";

function fmt(iso?: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

type MatchState = {
  state: "idle" | "no_face" | "no_gallery" | "unknown" | "matched";
  matched: boolean;
  user_id: number | null;
  name: string | null;
  score: number | null;
  margin?: number | null;
};

export default function LivePage({ status }: { status: any }) {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [match, setMatch] = useState<MatchState>({
    state: "idle",
    matched: false,
    user_id: null,
    name: null,
    score: null,
  });

  const load = useCallback(async () => {
    try {
      setLogs(await getLogs(40));
    } catch {
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const off = lessWs.onMessage((msg) => {
      if (msg?.type !== "face_match") return;
      setMatch({
        state: msg.state || (msg.matched ? "matched" : "unknown"),
        matched: Boolean(msg.matched),
        user_id: msg.user_id ?? null,
        name: msg.name ?? null,
        score: typeof msg.score === "number" ? msg.score : null,
        margin: msg.margin,
      });
    });
    return off;
  }, []);

  const statusLabel =
    match.state === "matched"
      ? "MATCH"
      : match.state === "unknown"
        ? "UNKNOWN"
        : match.state === "no_gallery"
          ? "NO GALLERY"
          : match.state === "no_face"
            ? "NO FACE"
            : "STANDBY";

  const statusClass =
    match.state === "matched"
      ? "bg-secondary/15 text-secondary border-secondary/20"
      : match.state === "unknown"
        ? "bg-error/10 text-error border-error/20"
        : "bg-white/[0.04] text-[#7a8494] border-white/[0.06]";

  const scorePct =
    match.score != null ? Math.round(Math.max(0, Math.min(1, match.score)) * 100) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#12161e] border border-white/[0.05] px-3 py-2 rounded-xl">
        <div className="flex items-center gap-2 font-mono-label">
          <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
          <span className="text-secondary font-bold">{ru.postGuard}</span>
          <span className="text-[#3d4450]">|</span>
          <span className="text-[#8b95a5]">{ru.armTitle}</span>
        </div>
        <div className="flex gap-1.5 flex-wrap font-mono-label">
          <span className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.05] text-secondary flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            CAM: {status?.camera ?? "-"}
          </span>
          <span className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.05] text-secondary flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            MATCH-ON-STREAM
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-8 space-y-3">
          <div className="relative aspect-[16/10] bg-[#080a0e] rounded-2xl overflow-hidden border border-white/[0.06]">
            <VideoFeed />

            <div className="absolute top-3 left-3 z-10 flex gap-1.5">
              <span className="px-2 py-1 rounded-md bg-black/60 backdrop-blur text-error font-mono-label flex items-center gap-1.5 border border-white/[0.06]">
                <span className="w-1.5 h-1.5 rounded-full bg-error animate-ping" />
                REC
              </span>
              <span className="px-2 py-1 rounded-md bg-black/60 backdrop-blur font-mono-label border border-white/[0.06]">
                <span className="text-primary font-bold">CAM_01 //</span>{" "}
                <span className="text-[#9aa3b2]">{ru.turnstile}</span>
              </span>
            </div>

            <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[150px] h-[180px] pointer-events-none z-10">
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-secondary/80 rounded-tl-sm" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-secondary/80 rounded-tr-sm" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-secondary/80 rounded-bl-sm" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-secondary/80 rounded-br-sm" />
            </div>

            <div className="absolute bottom-3 left-3 z-10">
              <div
                className={`inline-flex items-center gap-2.5 px-3 py-2 rounded-xl bg-black/65 backdrop-blur border border-white/[0.06] border-l-2 ${
                  match.matched ? "border-l-secondary" : "border-l-primary"
                }`}
              >
                <LockOpen
                  className={`w-4.5 h-4.5 shrink-0 ${match.matched ? "text-secondary" : "text-primary"}`}
                />
                <div>
                  <div
                    className={`text-sm font-medium ${
                      match.matched ? "text-secondary" : "text-primary"
                    }`}
                  >
                    {match.matched && match.name
                      ? match.name
                      : match.state === "unknown"
                        ? "Лицо не в базе"
                        : ru.waitingSubject}
                  </div>
                  <div className="font-mono-label text-[#7a8494]">
                    {match.matched
                      ? `ID ${match.user_id} · score ${scorePct}%`
                      : ru.waitingHint}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#12161e] border border-white/[0.05] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-primary" />
              <span className="font-display font-semibold text-sm">{ru.lastEvents}</span>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-0.5">
              {logs.slice(0, 8).map((l) => (
                <div
                  key={l.id}
                  className="flex justify-between text-xs py-1.5 px-2 rounded-lg hover:bg-white/[0.02] gap-2"
                >
                  <span className="font-mono text-primary shrink-0">{fmt(l.created_at)}</span>
                  <span className="font-mono truncate text-[#8b95a5]">{l.nfc_uid || "-"}</span>
                  <span
                    className={
                      l.event_type === "granted"
                        ? "text-secondary shrink-0 font-medium"
                        : "text-error shrink-0 font-medium"
                    }
                  >
                    {l.event_type === "granted" ? ru.granted : ru.denied}
                  </span>
                </div>
              ))}
              {!logs.length && (
                <p className="text-[#5c6570] text-center py-6 text-sm">{ru.noEvents}</p>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-3">
          <div className="bg-[#12161e] border border-white/[0.05] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BadgeCheck className="w-4.5 h-4.5 text-secondary" />
                <span className="font-display font-semibold text-sm">{ru.verification}</span>
              </div>
              <span className={`px-2 py-0.5 rounded-md font-mono-label border ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[ru.liveFrame, ru.frontal, ru.profile].map((t) => (
                <div
                  key={t}
                  className="aspect-square rounded-xl bg-[#0a0d12] border border-white/[0.05] flex items-center justify-center"
                >
                  <span className="font-mono-label text-[#3d4450]">{t}</span>
                </div>
              ))}
            </div>
            <div className="bg-[#0a0d12] border border-white/[0.04] p-3 rounded-xl">
              <div className="flex justify-between items-end">
                <span className="font-mono-label text-[#5c6570]">{ru.match}</span>
                <span
                  className={`font-display text-2xl font-bold ${
                    scorePct != null && match.matched
                      ? "text-secondary"
                      : scorePct != null
                        ? "text-error"
                        : "text-[#3d4450]"
                  }`}
                >
                  {scorePct != null ? `${scorePct}%` : "—"}
                </span>
              </div>
              {match.margin != null && (
                <div className="font-mono-label text-[#5c6570] mt-1">
                  margin {(match.margin * 100).toFixed(1)}%
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#12161e] border border-white/[0.05] rounded-2xl p-4 space-y-1.5">
            <div className="font-mono-label text-[#5c6570]">{ru.card}</div>
            <div className={`font-display text-lg font-bold ${match.name ? "text-white" : "text-[#3d4450]"}`}>
              {match.name || "—"}
            </div>
            <div className="text-sm text-primary/70">
              {match.matched
                ? `user_id ${match.user_id}`
                : match.state === "no_gallery"
                  ? "Нет зарегистрированных лиц"
                  : ru.waitingSubject}
            </div>
          </div>

          <div className="bg-[#12161e] border border-white/[0.05] rounded-2xl p-4 space-y-2">
            <div className="font-mono-label text-[#5c6570] mb-1">{ru.actions}</div>
            <button className="w-full py-2.5 rounded-xl bg-secondary text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 hover:brightness-110 transition">
              <LockOpen className="w-4 h-4" /> {ru.forceOpen}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className="py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm flex items-center justify-center gap-1.5 hover:bg-white/[0.07] transition">
                <UserCheck className="w-4 h-4 text-primary" /> {ru.confirm}
              </button>
              <button className="py-2 rounded-xl bg-error/10 border border-error/20 text-error text-sm flex items-center justify-center gap-1.5 hover:bg-error/15 transition">
                <Ban className="w-4 h-4" /> {ru.block}
              </button>
            </div>
            <button
              onClick={() =>
                setMatch({
                  state: "idle",
                  matched: false,
                  user_id: null,
                  name: null,
                  score: null,
                })
              }
              className="w-full py-2 rounded-xl bg-[#0a0d12] border border-white/[0.04] text-[#5c6570] text-xs font-mono-label flex items-center justify-center gap-1.5 hover:text-[#8b95a5] transition"
            >
              <RefreshCw className="w-3.5 h-3.5" /> {ru.reset}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
