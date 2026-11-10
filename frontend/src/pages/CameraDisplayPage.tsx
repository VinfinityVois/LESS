import { Camera, X, History, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getLogs, type AccessLog } from "../services/api";
import { getCurrentWindow } from "@tauri-apps/api/window";
import VideoFeed from "../components/VideoFeed";

export default function CameraDisplayPage() {
  const [mode, setMode] = useState<"video" | "events">((new URLSearchParams(window.location.search).get("mode") as "video" | "events") || "video");
  const [logs, setLogs] = useState<AccessLog[]>([]);
  useEffect(() => {
    const channel = new BroadcastChannel("less-external-display");
    channel.onmessage = (event) => { if (event.data?.type === "set-mode" && (event.data.mode === "video" || event.data.mode === "events")) setMode(event.data.mode); };
    const refresh = () => getLogs(30).then(setLogs).catch(() => setLogs([]));
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { channel.postMessage({ type: "closed" }); channel.close(); window.clearInterval(timer); };
  }, []);
  const close = async () => {
    try { await getCurrentWindow().close(); }
    catch { window.close(); }
  };

  return <main className="camera-display">
    <header className="camera-display__bar">
      <div><span className="camera-display__live"/>{mode === "video" ? <Camera size={17}/> : <History size={17}/>}<strong>LESS · {mode === "video" ? "ВИДЕОНАБЛЮДЕНИЕ" : "СОБЫТИЯ ДОСТУПА"}</strong><small>ДОПОЛНИТЕЛЬНЫЙ МОНИТОР · ВЕРТИКАЛЬНЫЙ РЕЖИМ</small></div>
      <button onClick={() => void close()} aria-label="Закрыть экран камеры"><X size={18}/> Закрыть</button>
    </header>
    <section className={"camera-display__viewport " + (mode === "events" ? "is-events" : "is-video")}>{mode === "video" && <div className="display-video-layer"><VideoFeed/></div>}{mode === "events" ? <div className="display-events">{logs.map((log) => <article className="display-event" key={log.id}><span>{new Date(log.created_at).toLocaleTimeString("ru-RU")}</span><strong>{log.nfc_uid || "Гость / неизвестный идентификатор"}</strong><b className={log.event_type === "granted" ? "is-granted" : "is-denied"}>{log.event_type === "granted" ? "ДОСТУП РАЗРЕШЁН" : "ОТКАЗ В ДОСТУПЕ"}</b><small>{log.reason || log.factor_used || "Событие контроля доступа"}</small></article>)}{!logs.length && <div className="display-events-empty"><ShieldCheck size={30}/><strong>Ожидание событий доступа</strong></div>}</div> : null}</section>
    <footer className="camera-display__footer"><span>ЛОКАЛЬНЫЙ ВИДЕОКАНАЛ · CAM–01</span><span>ЭКРАН ОПЕРАТОРА</span></footer>
  </main>;
}
