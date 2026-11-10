import { useEffect, useState } from "react";
import VideoFeed from "./components/VideoFeed";
import { useSystemStore } from "./stores/systemStore";

type Screen = "login" | "dashboard";

interface IdentityInfo {
  name: string;
  position: string;
  photoTime: string;
  matched: boolean | null;
  nfcUid?: string;
  method?: string;
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setTimeout(() => {
      if (login === "admin" && password === "admin") {
        onLogin();
      } else {
        setError("Неверный логин или пароль");
      }
      setLoading(false);
    }, 400);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-slate-950 to-slate-950" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-emerald-500/10 blur-[100px] rounded-full" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500 text-slate-950 font-bold text-2xl mb-4 shadow-lg shadow-emerald-500/30">
            L
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">LESS</h1>
          <p className="text-slate-400 text-sm mt-1">Local Entry Security System</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-medium text-white mb-6">Вход администратора</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Логин</label>
              <input type="text" value={login} onChange={(e) => setLogin(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                placeholder="admin" autoFocus />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Пароль</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                placeholder="••••••••" />
            </div>
          </div>

          {error && (
            <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <button type="submit" disabled={loading}
            className="mt-6 w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold transition disabled:opacity-50">
            {loading ? "Вход..." : "Войти"}
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">Пока только админ · demo: admin / admin</p>
        </form>
      </div>
    </div>
  );
}

function Dashboard() {
  const { status, backendOnline, refresh } = useSystemStore();
  const [identity, setIdentity] = useState<IdentityInfo>({
    name: "—", position: "—", photoTime: "—", matched: null,
  });

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const simulateDetect = () => {
    const now = new Date();
    setIdentity({
      name: "Иванов Алексей",
      position: "Инженер СБ",
      photoTime: now.toLocaleTimeString("ru-RU"),
      matched: true,
      nfcUid: "A1:B2:C3:D4",
      method: "Камера + NFC",
    });
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      <header className="shrink-0 h-14 px-5 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/90 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-sm">L</div>
          <div>
            <span className="font-semibold tracking-tight">LESS</span>
            <span className="text-slate-500 text-xs ml-2 hidden sm:inline">СКУД · Админ</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 text-xs">
            <span className="px-2 py-1 rounded-md bg-slate-800 text-slate-400">NFC</span>
            <span className="px-2 py-1 rounded-md bg-slate-800 text-slate-400">ПИН</span>
            <span className="px-2 py-1 rounded-md bg-slate-800 text-slate-400">Сканер</span>
            <span className="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400">Камера</span>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${backendOnline ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
            {backendOnline ? "Backend Online" : "Backend Offline"}
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative bg-black min-w-0">
          <VideoFeed />
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-white font-medium text-lg drop-shadow">
                  {identity.name !== "—" ? identity.name : "Ожидание идентификации"}
                </p>
                <p className="text-slate-300 text-sm">
                  {identity.position !== "—" ? identity.position : "Поднесите карту или встаньте перед камерой"}
                </p>
              </div>
              {identity.matched !== null && (
                <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${identity.matched ? "bg-emerald-500 text-slate-950" : "bg-red-500 text-white"}`}>
                  {identity.matched ? "✓ Совпадение" : "✗ Не совпадает"}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-900/50 flex flex-col">
          <div className="p-4 border-b border-slate-800">
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Снимок / идентификация</p>
            <div className="aspect-[3/4] rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden relative">
              {identity.name !== "—" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center text-3xl text-emerald-400 mb-3">
                    {identity.name.charAt(0)}
                  </div>
                  <p className="text-white font-medium text-center px-2">{identity.name}</p>
                  <p className="text-slate-400 text-xs mt-1">{identity.position}</p>
                </div>
              ) : (
                <div className="text-center text-slate-600">
                  <div className="text-4xl mb-2">👤</div>
                  <p className="text-xs">Нет данных</p>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 space-y-4 flex-1 overflow-y-auto">
            <div><p className="text-xs text-slate-500 mb-1">ФИО</p><p className="text-white font-medium">{identity.name}</p></div>
            <div><p className="text-xs text-slate-500 mb-1">Должность</p><p className="text-slate-200">{identity.position}</p></div>
            <div><p className="text-xs text-slate-500 mb-1">Время снимка</p><p className="text-slate-200 font-mono text-sm">{identity.photoTime}</p></div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Совпадение</p>
              {identity.matched === null ? <p className="text-slate-500">—</p> : identity.matched ? (
                <p className="text-emerald-400 font-medium">Да · доступ разрешён</p>
              ) : (
                <p className="text-red-400 font-medium">Нет · доступ запрещён</p>
              )}
            </div>
            {identity.nfcUid && <div><p className="text-xs text-slate-500 mb-1">NFC UID</p><p className="text-slate-300 font-mono text-sm">{identity.nfcUid}</p></div>}
            {identity.method && <div><p className="text-xs text-slate-500 mb-1">Метод</p><p className="text-slate-300 text-sm">{identity.method}</p></div>}

            <div className="pt-4 border-t border-slate-800 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Система</p>
              <Row label="Backend" value={backendOnline ? "Online" : "Offline"} ok={backendOnline} />
              <Row label="Arduino" value={status?.serial ?? "—"} ok={status?.serial === "connected"} />
              <Row label="Камера" value={status?.camera ?? "—"} ok={status?.camera === "running"} />
              <Row label="БД" value={status?.db ?? "—"} ok={status?.db === "ok"} />
            </div>
          </div>

          <div className="p-4 border-t border-slate-800 space-y-2">
            <button onClick={simulateDetect} className="w-full py-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-sm font-medium transition">
              Демо: распознать
            </button>
            <button onClick={() => setIdentity({ name: "—", position: "—", photoTime: "—", matched: null })}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition">
              Сбросить
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={ok ? "text-emerald-400" : "text-slate-400"}>{value}</span>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  if (screen === "login") return <LoginScreen onLogin={() => setScreen("dashboard")} />;
  return <Dashboard />;
}
