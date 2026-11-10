import { useEffect } from "react";
import VideoFeed from "./components/VideoFeed";
import { StatusBadge } from "./components/StatusBadge";
import { useSystemStore } from "./stores/systemStore";

function App() {
  const { status, backendOnline, refresh } = useSystemStore();

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-bold text-slate-950">
            L
          </div>
          <h1 className="text-xl font-semibold tracking-tight">LESS</h1>
          <span className="text-slate-500 text-sm">Local Entry Security System</span>
        </div>
        <StatusBadge status={backendOnline ? "ok" : "error"} />
      </header>

      <main className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-medium">Камера</h2>
              <span className="text-xs text-slate-500">Live</span>
            </div>
            <VideoFeed />
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-medium mb-3">Статус системы</h2>
            <ul className="space-y-2 text-sm text-slate-400">
              <li className="flex justify-between">
                <span>Backend</span>
                <span className={backendOnline ? "text-emerald-400" : "text-red-400"}>
                  {backendOnline ? "Online" : "Offline"}
                </span>
              </li>
              <li className="flex justify-between">
                <span>Arduino</span>
                <span className={status?.serial === "connected" ? "text-emerald-400" : "text-slate-500"}>
                  {status?.serial ?? "—"}
                </span>
              </li>
              <li className="flex justify-between">
                <span>Камера</span>
                <span className={status?.camera === "running" ? "text-emerald-400" : "text-slate-500"}>
                  {status?.camera ?? "—"}
                </span>
              </li>
              <li className="flex justify-between">
                <span>БД</span>
                <span className="text-emerald-400">{status?.db ?? "—"}</span>
              </li>
              <li className="flex justify-between">
                <span>WS clients</span>
                <span className="text-slate-300">{status?.clients_ws ?? 0}</span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-medium mb-3">Последние события</h2>
            <p className="text-sm text-slate-500">Пока нет событий</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-medium mb-3">ИИ-алерты</h2>
            <p className="text-sm text-slate-500">Алерты появятся после анализа логов</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
