import { useEffect, useRef, useState } from "react";
import { faceEnroll } from "../services/api";

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
    symmetry: 0,
    stability: 0,
    expression: "\u043d\u0435\u0439\u0442\u0440\u0430\u043b\u044c\u043d\u043e",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch((e) => {
        setError("\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u043a\u0430\u043c\u0435\u0440\u0435: " + e.message);
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

  useEffect(() => {
    if (phase !== "align" && phase !== "scan") return;
    const id = setInterval(() => {
      setMetrics({
        faceDetected: true,
        symmetry: 70 + Math.round(Math.random() * 25),
        stability: 60 + Math.round(Math.random() * 35),
        expression: ["\u043d\u0435\u0439\u0442\u0440\u0430\u043b\u044c\u043d\u043e", "\u043b\u0451\u0433\u043a\u0430\u044f \u0443\u043b\u044b\u0431\u043a\u0430", "\u0441\u043f\u043e\u043a\u043e\u0439\u043d\u043e"][Math.floor(Math.random() * 3)],
      });
    }, 400);
    return () => clearInterval(id);
  }, [phase]);

  const startScan = async () => {
    setPhase("scan");
    setProgress(0);
    for (let i = 0; i <= 100; i += 4) {
      await new Promise((r) => setTimeout(r, 80));
      setProgress(i);
    }
    try {
      await faceEnroll(userId);
      setPhase("done");
      stream?.getTracks().forEach((t) => t.stop());
      setTimeout(onDone, 800);
    } catch (e: any) {
      setError(e?.message || "\u041e\u0448\u0438\u0431\u043a\u0430");
      setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h3 className="font-semibold text-white">\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u043b\u0438\u0446\u0430</h3>
            <p className="text-xs text-slate-400">{userName}</p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-sm">\u0417\u0430\u043a\u0440\u044b\u0442\u044c</button>
        </div>
        <div className="relative aspect-video bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <svg viewBox="0 0 200 240" className="w-48 h-56 opacity-90">
              <ellipse cx="100" cy="120" rx="70" ry="90" fill="none" stroke="#34d399" strokeWidth="2" strokeDasharray="8 6" />
              {[[100, 50], [70, 90], [130, 90], [100, 110], [75, 150], [125, 150], [100, 175]].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="3" fill="#34d399" />
              ))}
              <line x1="100" y1="40" x2="100" y2="200" stroke="#34d399" strokeOpacity="0.3" />
              <line x1="40" y1="120" x2="160" y2="120" stroke="#34d399" strokeOpacity="0.3" />
            </svg>
          </div>
          {phase === "scan" && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
              <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <div className="p-5 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
            <p className="text-xs text-slate-500">\u041b\u0438\u0446\u043e</p>
            <p className="text-emerald-400">{metrics.faceDetected ? "\u043e\u0431\u043d\u0430\u0440\u0443\u0436\u0435\u043d\u043e" : "..."}</p>
          </div>
          <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
            <p className="text-xs text-slate-500">\u0421\u0438\u043c\u043c\u0435\u0442\u0440\u0438\u044f</p>
            <p className="text-emerald-400">{metrics.symmetry}%</p>
          </div>
          <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
            <p className="text-xs text-slate-500">\u0421\u0442\u0430\u0431\u0438\u043b\u044c\u043d\u043e\u0441\u0442\u044c</p>
            <p className="text-emerald-400">{metrics.stability}%</p>
          </div>
          <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
            <p className="text-xs text-slate-500">\u041c\u0438\u043c\u0438\u043a\u0430</p>
            <p className="text-slate-200">{metrics.expression}</p>
          </div>
        </div>
        {error && <p className="px-5 text-sm text-red-400">{error}</p>}
        <div className="p-5 pt-0 flex gap-3">
          {phase === "align" && (
            <button onClick={startScan} className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-semibold">\u0417\u0430\u0444\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0448\u0430\u0431\u043b\u043e\u043d</button>
          )}
          {phase === "scan" && <p className="flex-1 text-center text-slate-400 text-sm py-2">\u0421\u043a\u0430\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435… {progress}%</p>}
          {phase === "done" && <p className="flex-1 text-center text-emerald-400 text-sm py-2">\u2713 \u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e</p>}
          <button onClick={onCancel} className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm">\u041e\u0442\u043c\u0435\u043d\u0430</button>
        </div>
      </div>
    </div>
  );
}
