import { useEffect, useRef, useState } from "react";
import { lessWs } from "../services/websocket";

export default function VideoFeed({ onFrame, hidden = false }: { onFrame?: (blob: Blob) => void; hidden?: boolean }) {
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [faces, setFaces] = useState<{x:number;y:number;width:number;height:number;score:number}[]>([]);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(Date.now());

  useEffect(() => {
    let paused = false;
    const channel = new BroadcastChannel("less-camera-control");
    channel.onmessage = (event) => {
      if (event.data?.type === "pause-camera" && !paused) { paused = true; lessWs.disconnect(); }
      if (event.data?.type === "resume-camera" && paused) { paused = false; lessWs.connect(); }
    };
    lessWs.onMessage((message) => {
      if (message?.type === "face_detection") setFaces(Array.isArray(message.faces) ? message.faces : []);
    });
    lessWs.onFrame((blob) => {
      onFrame?.(blob);
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
      channel.close();
      lessWs.disconnect();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, []);

  return (
    <div className={"absolute inset-0 flex items-center justify-center bg-black " + (hidden ? "hidden" : "")}>
      <img
        ref={imgRef}
        alt="Camera feed"
        className={`w-full h-full object-cover ${connected ? "block" : "hidden"}`}
      />

      {connected && faces.length > 0 && <svg className="absolute inset-0 h-full w-full pointer-events-none" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Обнаруженные лица">
        {faces.map((face, index) => <g key={index}>
          <rect x={face.x * 1000} y={face.y * 1000} width={face.width * 1000} height={face.height * 1000} fill="none" stroke="#62e3cf" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <text x={face.x * 1000} y={Math.max(16, face.y * 1000 - 8)} fill="#62e3cf" fontSize="18">FACE · {Math.round(face.score * 100)}%</text>
        </g>)}
      </svg>}
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
