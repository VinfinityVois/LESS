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
      else setError("Неверный логин или пароль");
      setLoading(false);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(76,215,246,0.08),transparent_50%)]" />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md bg-surface-low border border-surface-highest rounded-xl p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-surface-high flex items-center justify-center text-primary font-bold text-lg">
            L
          </div>
          <div>
            <div className="font-display text-lg font-bold text-primary tracking-tight">LESS AI</div>
            <div className="font-mono-label text-secondary">СКУД MONITORING</div>
          </div>
        </div>
        <h2 className="font-display text-xl font-semibold mb-6">Вход администратора</h2>
        <label className="font-mono-label text-outline block mb-1">Логин</label>
        <input
          className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoFocus
        />
        <label className="font-mono-label text-outline block mb-1">Пароль</label>
        <input
          type="password"
          className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-error text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-primary-container text-slate-950 font-semibold text-sm hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "…" : "Войти"}
        </button>
        <p className="mt-4 text-center font-mono-label text-outline">demo · admin / admin</p>
      </form>
    </div>
  );
}

export default function App() {
  const [ok, setOk] = useState(false);
  if (!ok) return <LoginScreen onLogin={() => setOk(true)} />;
  return <AdminShell />;
}
