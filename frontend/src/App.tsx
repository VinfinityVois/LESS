import { useState } from "react";
import AdminShell from "./pages/AdminShell";

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (login === "admin" && password === "admin") onLogin();
      else setError("\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u043b\u043e\u0433\u0438\u043d \u0438\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u044c");
      setLoading(false);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(76,215,246,0.08),transparent_50%)]" />
      <form onSubmit={submit} className="relative w-full max-w-md bg-surface-low border border-surface-highest rounded-xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-surface-high flex items-center justify-center text-primary font-bold text-lg">L</div>
          <div>
            <div className="font-display text-lg font-bold text-primary tracking-tight">LESS AI</div>
            <div className="font-mono-label text-secondary">\u0421\u041a\u0423\u0414 MONITORING</div>
          </div>
        </div>
        <h2 className="font-display text-xl font-semibold mb-6">\u0412\u0445\u043e\u0434 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430</h2>
        <label className="font-mono-label text-outline block mb-1">\u041b\u043e\u0433\u0438\u043d</label>
        <input className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
        <label className="font-mono-label text-outline block mb-1">\u041f\u0430\u0440\u043e\u043b\u044c</label>
        <input type="password" className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-error text-sm mb-3">{error}</p>}
        <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-primary-container text-slate-950 font-semibold text-sm hover:brightness-110 disabled:opacity-50">{loading ? "\u2026" : "\u0412\u043e\u0439\u0442\u0438"}</button>
        <p className="mt-4 text-center font-mono-label text-outline">demo \u00b7 admin / admin</p>
      </form>
    </div>
  );
}

export default function App() {
  const [ok, setOk] = useState(false);
  if (!ok) return <LoginScreen onLogin={() => setOk(true)} />;
  return <AdminShell />;
}
