import { useEffect, useRef, useState, useCallback } from "react";
import { lessWs } from "../services/websocket";
import { Camera, WifiOff, RefreshCw } from "lucide-react";

export default function VideoFeed() {
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(Date.now());
  const lastFrameAt = useRef(0);

  const handleFrame = useCallback((blob: Blob) => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
    }
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    if (imgRef.current) {
      imgRef.current.src = url;
    }
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
    lessWs.onFrame(handleFrame);

    lessWs.onMessage((msg) => {
      if (msg?.type === "error" && msg?.message) {
        setError(String(msg.message));
      }
    });

    lessWs.connect();

    // Detect stalled stream
    const stallCheck = setInterval(() => {
      if (lastFrameAt.current && Date.now() - lastFrameAt.current > 4000) {
        setConnected(false);
      }
    }, 1500);

    return () => {
      clearInterval(stallCheck);
      lessWs.disconnect();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, [handleFrame]);

  const reconnect = () => {
    setError(null);
    setConnected(false);
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
              Backend → WebSocket → JPEG
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
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-black/55 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-medium text-secondary border border-white/[0.06]">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
            LIVE · {fps} fps
          </div>
        </div>
      )}
    </div>
  );
}
