import { useEffect, useRef, useState, useCallback } from "react";
import { lessWs } from "../services/websocket";
import { Camera, WifiOff, RefreshCw } from "lucide-react";

export default function VideoFeed({
  onFrame,
  hidden = false,
}: {
  onFrame?: (blob: Blob) => void;
  hidden?: boolean;
}) {
  const [connected, setConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [faces, setFaces] = useState<
    { x: number; y: number; width: number; height: number; score: number }[]
  >([]);
  const [detectorReady, setDetectorReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const urlRef = useRef<string | null>(null);
  const frameCount = useRef(0);
  const lastFpsTime = useRef(Date.now());
  const lastFrameAt = useRef(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const handleFrame = useCallback((blob: Blob) => {
    onFrameRef.current?.(blob);
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
    let paused = false;
    const channel = new BroadcastChannel("less-camera-control");
    channel.onmessage = (event) => {
      if (event.data?.type === "pause-camera" && !paused) {
        paused = true;
        lessWs.disconnect();
      }
      if (event.data?.type === "resume-camera" && paused) {
        paused = false;
        lessWs.connect();
      }
    };

    const offMsg = lessWs.onMessage((message) => {
      if (message?.type === "face_detection") {
        setDetectorReady(Boolean(message.available));
        setFaces(Array.isArray(message.faces) ? message.faces : []);
      }
      if (message?.type === "error" && message?.message) {
        setError(String(message.message));
      }
    });
    const offFrame = lessWs.onFrame(handleFrame);

    lessWs.connect();

    const stall = window.setInterval(() => {
      if (lastFrameAt.current && Date.now() - lastFrameAt.current > 4000) {
        setConnected(false);
      }
    }, 1500);

    return () => {
      window.clearInterval(stall);
      channel.close();
      offMsg();
      offFrame();
      lessWs.disconnect();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [handleFrame]);

  const reconnect = () => {
    setError(null);
    setConnected(false);
    lessWs.disconnect();
    setTimeout(() => lessWs.connect(), 250);
  };

  return (
    <div
      className={
        "absolute inset-0 flex items-center justify-center bg-black " +
        (hidden ? "hidden" : "")
      }
    >
      <img
        ref={imgRef}
        alt="Camera feed"
        className={`w-full h-full object-cover ${connected ? "block" : "hidden"}`}
      />

      {connected && faces.length > 0 && (
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-label="Обнаруженные лица"
        >
          {faces.map((face, index) => (
            <g key={index}>
              <rect
                x={face.x * 1000}
                y={face.y * 1000}
                width={face.width * 1000}
                height={face.height * 1000}
                fill="none"
                stroke="#62e3cf"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={face.x * 1000}
                y={Math.max(16, face.y * 1000 - 8)}
                fill="#62e3cf"
                fontSize="18"
              >
                FACE · {Math.round(face.score * 100)}%
              </text>
            </g>
          ))}
        </svg>
      )}

      {!connected && (
        <div className="flex flex-col items-center justify-center text-slate-500 gap-2 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-1">
            {error ? (
              <WifiOff className="w-7 h-7 text-red-400" />
            ) : (
              <Camera className="w-7 h-7 text-slate-500 animate-pulse" />
            )}
          </div>
          <p className="text-sm text-slate-400">
            {error ? "Нет связи с камерой" : "Ожидание видеопотока…"}
          </p>
          <p className="text-xs text-slate-600">Backend → WebSocket → JPEG + YuNet</p>
          <button
            type="button"
            onClick={reconnect}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Переподключить
          </button>
        </div>
      )}

      {connected && (
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <div className="bg-black/50 backdrop-blur px-2.5 py-1 rounded-lg text-xs text-emerald-400 font-medium">
            LIVE · {fps} fps
          </div>
          {detectorReady === true && (
            <div className="bg-black/50 backdrop-blur px-2 py-1 rounded-lg text-[10px] text-cyan-300 font-mono">
              YuNet · {faces.length}
            </div>
          )}
          {detectorReady === false && (
            <div className="bg-black/50 backdrop-blur px-2 py-1 rounded-lg text-[10px] text-slate-400 font-mono">
              models missing
            </div>
          )}
        </div>
      )}
    </div>
  );
}
