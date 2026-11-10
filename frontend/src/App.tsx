import { useState } from "react";
import AdminShell from "./pages/AdminShell";
import { ru } from "./i18n/ru";

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
      else setError(ru.badCreds);
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
            <div className="font-display text-lg font-bold text-primary tracking-tight">{ru.brand}</div>
            <div className="font-mono-label text-secondary">{ru.subtitle}</div>
          </div>
        </div>
        <h2 className="font-display text-xl font-semibold mb-6">{ru.loginTitle}</h2>
        <label className="font-mono-label text-outline block mb-1">{ru.login}</label>
        <input
          className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoFocus
        />
        <label className="font-mono-label text-outline block mb-1">{ru.password}</label>
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
          {loading ? "…" : ru.signIn}
        </button>
        <p className="mt-4 text-center font-mono-label text-outline">{ru.demoHint}</p>
      </form>
    </div>
  );
}

export default function App() {
  const [ok, setOk] = useState(false);
  if (!ok) return <LoginScreen onLogin={() => setOk(true)} />;
  return <AdminShell />;
}
