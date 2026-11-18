import { useEffect, useRef, useState, useCallback } from "react";
import { lessWs } from "../services/websocket";
import { Camera, WifiOff, RefreshCw } from "lucide-react";

export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

export default function VideoFeed() {
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [faces, setFaces] = useState<FaceBox[]>([]);
  const [detectorReady, setDetectorReady] = useState<boolean | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(Date.now());
  const lastFrameAt = useRef(0);

  const handleFrame = useCallback((blob: Blob) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    if (imgRef.current) imgRef.current.src = url;
    setConnected(true);
    setError(null);
    lastFrameAt.current = Date.now();

    frameCount.current += 1;
    const now = Date.now();
    if (now - lastFpsTime.current >= 1000) {
      setFps(frameCount.current);
      frameCount.current = 0;
      lastFpsTime.current = now;
    }
  }, []);

  useEffect(() => {
    const offFrame = lessWs.onFrame(handleFrame);
    const offMsg = lessWs.onMessage((msg) => {
      if (msg?.type === "error" && msg?.message) {
        setError(String(msg.message));
      }
      if (msg?.type === "face_detection") {
        setDetectorReady(Boolean(msg.available));
        setFaces(Array.isArray(msg.faces) ? msg.faces : []);
      }
    });

    lessWs.connect();

    const stallCheck = setInterval(() => {
      if (lastFrameAt.current && Date.now() - lastFrameAt.current > 4000) {
        setConnected(false);
      }
    }, 1500);

    return () => {
      clearInterval(stallCheck);
      offFrame();
      offMsg();
      // Do not hard-disconnect here: LivePage may still need the socket.
      // Stream stops when last consumer leaves AdminShell / page unload.
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [handleFrame]);

  const reconnect = () => {
    setError(null);
    setConnected(false);
    setFaces([]);
    lessWs.disconnect();
    setTimeout(() => lessWs.connect(), 300);
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#080a0e]">
      <img
        ref={imgRef}
        alt="Camera feed"
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          connected ? "opacity-100" : "opacity-0"
        }`}
      />

      {connected && faces.length > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {faces.map((f, i) => (
            <div
              key={i}
              className="absolute border-2 border-secondary/90 rounded-sm"
              style={{
                left: `${f.x * 100}%`,
                top: `${f.y * 100}%`,
                width: `${f.width * 100}%`,
                height: `${f.height * 100}%`,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              }}
            >
              <span className="absolute -top-5 left-0 text-[10px] font-mono bg-secondary/90 text-slate-950 px-1.5 py-0.5 rounded">
                {(f.score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
            {error ? (
              <WifiOff className="w-6 h-6 text-error/80" />
            ) : (
              <Camera className="w-6 h-6 text-outline animate-pulse" />
            )}
          </div>
          <div>
            <p className="text-sm text-[#9aa3b2]">
              {error ? "Нет связи с камерой" : "Ожидание видеопотока…"}
            </p>
            <p className="text-xs mt-1 text-[#5c6570] font-mono">
              Backend → WebSocket → JPEG + YuNet + SFace
            </p>
          </div>
          <button
            onClick={reconnect}
            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-[#bcc9cd] hover:bg-white/[0.07] transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Переподключить
          </button>
        </div>
      )}

      {connected && (
        <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
          <div className="flex items-center gap-1.5 bg-black/55 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-medium text-secondary border border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
            LIVE · {fps} fps
          </div>
          {detectorReady === true && (
            <div className="bg-black/55 backdrop-blur-md px-2 py-1 rounded-md text-[10px] font-mono text-primary border border-white/[0.06]">
              YuNet · {faces.length} face{faces.length === 1 ? "" : "s"}
            </div>
          )}
          {detectorReady === false && (
            <div className="bg-black/55 backdrop-blur-md px-2 py-1 rounded-md text-[10px] font-mono text-[#7a8494] border border-white/[0.06]">
              models missing
            </div>
          )}
        </div>
      )}
    </div>
  );
}
