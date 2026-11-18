import { useEffect, useRef, useState } from "react";
import { faceEnroll, faceDetect } from "../services/api";
import { X, ScanFace, CheckCircle2, AlertCircle } from "lucide-react";

function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  // mirror back for server (video is CSS-mirrored)
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function FaceEnroll({
  userId,
  userName,
  onDone,
  onCancel,
}: {
  userId: number;
  userName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<"align" | "scan" | "done" | "error">("align");
  const [progress, setProgress] = useState(0);
  const [metrics, setMetrics] = useState({
    faceDetected: false,
    score: 0,
    area: 0,
    count: 0,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 540 } },
        audio: false,
      })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((e) => {
        setError("Нет доступа к камере: " + e.message);
        setPhase("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  // Poll local frame → backend YuNet for real metrics while aligning
  useEffect(() => {
    if (phase !== "align" || !videoRef.current) return;
    let cancelled = false;
    const tick = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || cancelled) return;
      try {
        const dataUrl = captureFrame(video);
        const res = await faceDetect(dataUrl);
        if (cancelled) return;
        const faces = res.faces || [];
        const best = faces.sort((a, b) => b.score - a.score)[0];
        setMetrics({
          faceDetected: faces.length === 1,
          score: best ? Math.round(best.score * 100) : 0,
          area: best ? Math.round(best.width * best.height * 10000) / 100 : 0,
          count: faces.length,
        });
      } catch {
        // backend/models may be offline — keep UI usable
      }
    };
    const id = setInterval(tick, 700);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase]);

  const startScan = async () => {
    setPhase("scan");
    setProgress(0);
    const video = videoRef.current;
    if (!video) {
      setError("Нет видео");
      setPhase("error");
      return;
    }
    try {
      for (let i = 0; i <= 60; i += 10) {
        setProgress(i);
        await new Promise((r) => setTimeout(r, 40));
      }
      const dataUrl = captureFrame(video);
      setProgress(80);
      await faceEnroll(userId, dataUrl);
      setProgress(100);
      setPhase("done");
      stream?.getTracks().forEach((t) => t.stop());
      setTimeout(onDone, 900);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Ошибка регистрации");
      setPhase("error");
    }
  };

  const canCapture = metrics.faceDetected && metrics.score >= 70 && metrics.area >= 2.5;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#12161e] border border-white/[0.08] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-white/[0.06] flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <ScanFace className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">Регистрация лица</h3>
              <p className="text-xs text-[#7a8494] mt-0.5">{userName}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#7a8494] hover:text-white hover:bg-white/[0.06] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <svg viewBox="0 0 200 240" className="w-44 h-52 opacity-90">
              <ellipse
                cx="100"
                cy="120"
                rx="68"
                ry="88"
                fill="none"
                stroke={phase === "done" ? "#4edea3" : canCapture ? "#4edea3" : "#4cd7f6"}
                strokeWidth="1.5"
                strokeDasharray={phase === "scan" ? "0" : "6 5"}
                className={phase === "scan" ? "animate-pulse" : ""}
              />
            </svg>
          </div>
          {phase === "scan" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
              <div className="h-full bg-primary transition-all duration-75" style={{ width: `${progress}%` }} />
            </div>
          )}
          {phase === "done" && (
            <div className="absolute inset-0 bg-secondary/10 flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-secondary" />
            </div>
          )}
        </div>

        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            {
              label: "Лицо",
              value: metrics.count === 1 ? "1 обнаружено" : metrics.count === 0 ? "нет" : `${metrics.count} в кадре`,
              ok: metrics.faceDetected,
            },
            { label: "Уверенность", value: `${metrics.score}%`, ok: metrics.score >= 70 },
            { label: "Площадь", value: `${metrics.area}%`, ok: metrics.area >= 2.5 },
            { label: "Статус", value: canCapture ? "готово" : "выровняйте", ok: canCapture },
          ].map((m) => (
            <div key={m.label} className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3 py-2">
              <p className="text-[10px] text-[#6b7482] font-mono-label">{m.label}</p>
              <p className={`text-sm mt-0.5 ${m.ok ? "text-secondary" : "text-[#9aa3b2]"}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="px-4 pb-2 flex items-center gap-2 text-sm text-error">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {typeof error === "string" ? error : JSON.stringify(error)}
          </div>
        )}

        <div className="p-4 pt-1 flex gap-2">
          {phase === "align" && (
            <button
              onClick={startScan}
              disabled={!canCapture}
              className="flex-1 py-2.5 rounded-xl bg-primary text-slate-950 font-semibold text-sm hover:brightness-110 transition disabled:opacity-40"
            >
              Зафиксировать шаблон
            </button>
          )}
          {phase === "scan" && (
            <p className="flex-1 text-center text-[#7a8494] text-sm py-2.5">Сканирование… {progress}%</p>
          )}
          {phase === "done" && (
            <p className="flex-1 text-center text-secondary text-sm py-2.5 font-medium">✓ Шаблон сохранён</p>
          )}
          {phase === "error" && (
            <button
              onClick={() => {
                setError("");
                setPhase("align");
              }}
              className="flex-1 py-2.5 rounded-xl bg-white/[0.06] text-sm text-[#bcc9cd]"
            >
              Повторить
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-[#9aa3b2] text-sm hover:bg-white/[0.07] transition"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
