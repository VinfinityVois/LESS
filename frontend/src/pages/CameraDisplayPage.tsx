import { Camera, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import VideoFeed from "../components/VideoFeed";

export default function CameraDisplayPage() {
  const close = async () => {
    try { await getCurrentWindow().close(); }
    catch { window.close(); }
  };

  return <main className="camera-display">
    <header className="camera-display__bar">
      <div><span className="camera-display__live"/><Camera size={17}/><strong>LESS · ВИДЕОНАБЛЮДЕНИЕ</strong><small>ДОПОЛНИТЕЛЬНЫЙ МОНИТОР</small></div>
      <button onClick={() => void close()} aria-label="Закрыть экран камеры"><X size={18}/> Закрыть</button>
    </header>
    <section className="camera-display__viewport"><VideoFeed/></section>
    <footer className="camera-display__footer"><span>ЛОКАЛЬНЫЙ ВИДЕОКАНАЛ · CAM–01</span><span>ЭКРАН ОПЕРАТОРА</span></footer>
  </main>;
}
