import { useState } from "react";
import AdminShell from "./pages/AdminShell";
import { ru } from "./i18n/ru";

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    // Demo gate — no backend auth on this branch
    const ok =
      login.trim().toLowerCase() === "admin" && password === "admin";
    setTimeout(() => {
      if (ok) onLogin();
      else setError("Неверный логин или пароль. Нужно: admin / admin");
      setLoading(false);
    }, 200);
  };

  return (
    <div className="min-h-screen bg-[#0c0f14] flex items-center justify-center p-6 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(76,215,246,0.06),transparent_55%)]" />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md bg-[#12161e] border border-white/[0.07] rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-lg">
            L
          </div>
          <div>
            <div className="font-display text-lg font-bold text-primary tracking-tight">
              {ru.brand}
            </div>
            <div className="font-mono-label text-[#5c6570]">{ru.subtitle}</div>
          </div>
        </div>
        <h2 className="font-display text-xl font-semibold mb-2">{ru.loginTitle}</h2>
        <p className="text-xs text-[#5c6570] mb-6">
          Демо-вход: логин <span className="text-primary font-mono">admin</span>, пароль{" "}
          <span className="text-primary font-mono">admin</span>
        </p>
        <label className="font-mono-label text-[#5c6570] block mb-1.5">{ru.login}</label>
        <input
          className="w-full mb-4 px-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/[0.06] text-sm focus:outline-none focus:border-primary/50 transition"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoFocus
          autoComplete="username"
        />
        <label className="font-mono-label text-[#5c6570] block mb-1.5">{ru.password}</label>
        <input
          type="password"
          className="w-full mb-5 px-3.5 py-2.5 rounded-xl bg-[#0a0d12] border border-white/[0.06] text-sm focus:outline-none focus:border-primary/50 transition"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="text-error text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-primary text-slate-950 font-semibold text-sm hover:brightness-110 disabled:opacity-50 transition"
        >
          {loading ? "…" : ru.signIn}
        </button>
        <p className="mt-5 text-center font-mono-label text-[#3d4450]">{ru.demoHint}</p>
      </form>
    </div>
  );
}

export default function App() {
  const [ok, setOk] = useState(false);
  if (!ok) return <LoginScreen onLogin={() => setOk(true)} />;
  return <AdminShell />;
}
