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
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <img
        ref={imgRef}
        alt="Camera feed"
        className={`w-full h-full object-cover ${connected ? "block" : "hidden"}`}
      />

      {!connected && (
        <div className="flex flex-col items-center justify-center text-slate-500">
          <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-3xl mb-4">
            📷
          </div>
          <p className="text-sm text-slate-400">Ожидание видеопотока...</p>
          <p className="text-xs mt-1 text-slate-600">Backend → WebSocket → JPEG</p>
        </div>
      )}

      {connected && (
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur px-2.5 py-1 rounded-lg text-xs text-emerald-400 font-medium">
          LIVE · {fps} fps
        </div>
      )}
    </div>
  );
}
