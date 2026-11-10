import { useEffect, useRef, useState } from "react";
import { lessWs } from "../services/websocket";

export default function VideoFeed() {
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(Date.now());

  useEffect(() => {
    lessWs.onFrame((blob) => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      if (imgRef.current) {
        imgRef.current.src = url;
      }
      setConnected(true);

      frameCount.current += 1;
      const now = Date.now();
      if (now - lastFpsTime.current >= 1000) {
        setFps(frameCount.current);
        frameCount.current = 0;
        lastFpsTime.current = now;
      }
    });

    lessWs.connect();

    return () => {
      lessWs.disconnect();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, []);

  return (
    <div className="relative aspect-video bg-slate-950 flex items-center justify-center">
      <img
        ref={imgRef}
        alt="Camera feed"
        className={`w-full h-full object-contain ${connected ? "block" : "hidden"}`}
      />

      {!connected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
          <div className="text-4xl mb-2">📷</div>
          <p className="text-sm">Ожидание видеопотока...</p>
          <p className="text-xs mt-1 text-slate-600">
            Backend → WebSocket → JPEG кадры
          </p>
        </div>
      )}

      {connected && (
        <div className="absolute top-2 right-2 bg-black/60 text-xs px-2 py-1 rounded text-emerald-400">
          LIVE · {fps} fps
        </div>
      )}
    </div>
  );
}
