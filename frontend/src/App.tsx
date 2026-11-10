import { useEffect, useState, type FormEvent } from "react";
import AdminShell from "./pages/AdminShell";
import CameraDisplayPage from "./pages/CameraDisplayPage";
import {
  bootstrapAdmin, getBootstrapStatus, getCurrentAdmin, loginAdmin, logoutAdmin,
  setAuthToken, waitForSharedAuthToken, type AdminAccount,
} from "./services/api";

function LoginScreen({ firstRun, onAuthenticated }: {
  firstRun: boolean;
  onAuthenticated: (user: AdminAccount) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (firstRun && password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }
    setLoading(true);
    try {
      const result = firstRun
        ? await bootstrapAdmin({ username, display_name: displayName || username, password })
        : await loginAdmin({ username, password });
      onAuthenticated(result.user);
    } catch (e: any) {
      setError(e?.response?.data?.detail || (firstRun ? "Не удалось создать учётную запись." : "Не удалось войти. Проверьте данные или подождите после блокировки."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(76,215,246,0.08),transparent_50%)]" />
      <form onSubmit={submit} className="relative w-full max-w-md bg-surface-low border border-surface-highest rounded-xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-surface-high flex items-center justify-center text-primary font-bold text-lg">L</div>
          <div><div className="font-display text-lg font-bold text-primary tracking-tight">LESS / CONTROL</div><div className="font-mono-label text-secondary">LOCAL ENTRY SECURITY SYSTEM</div></div>
        </div>
        <div className="text-[10px] tracking-[.18em] text-primary mb-2">{firstRun ? "ПЕРВИЧНАЯ НАСТРОЙКА" : "ЗАЩИЩЁННЫЙ ДОСТУП"}</div>
        <h2 className="font-display text-xl font-semibold mb-2">{firstRun ? "Создание суперадминистратора" : "Вход администратора"}</h2>
        <p className="text-sm text-outline mb-6">{firstRun ? "Создайте первую учётную запись. Она получит полные права управления LESS." : "Введите персональные учётные данные для доступа к панели управления."}</p>
        <label className="font-mono-label text-outline block mb-1">ЛОГИН</label>
        <input required minLength={3} maxLength={64} autoComplete="username" className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary" value={username} onChange={(e) => setUsername(e.target.value)} />
        {firstRun && <><label className="font-mono-label text-outline block mb-1">ОТОБРАЖАЕМОЕ ИМЯ</label><input required maxLength={120} autoComplete="name" className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Имя администратора"/></>}
        <label className="font-mono-label text-outline block mb-1">ПАРОЛЬ</label>
        <input required minLength={firstRun ? 12 : 1} maxLength={256} type="password" autoComplete={firstRun ? "new-password" : "current-password"} className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary" value={password} onChange={(e) => setPassword(e.target.value)} />
        {firstRun && <><label className="font-mono-label text-outline block mb-1">ПОВТОРИТЕ ПАРОЛЬ</label><input required minLength={12} maxLength={256} type="password" autoComplete="new-password" className="w-full mb-4 px-3 py-2.5 rounded-lg bg-surface border border-surface-highest text-sm focus:outline-none focus:border-primary" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /><p className="text-xs text-outline mb-4">Минимум 12 символов. Пароль хранится только в виде Argon2id-хеша.</p></>}
        {error && <p role="alert" className="text-error text-sm mb-3">{error}</p>}
        <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg bg-primary-container text-slate-950 font-semibold text-sm hover:brightness-110 disabled:opacity-50">{loading ? "Проверка…" : firstRun ? "Создать защищённую учётную запись" : "Войти в систему"}</button>
        <p className="mt-4 text-center font-mono-label text-outline">Сессия администратора · 8 часов · блокировка после 5 ошибок</p>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AdminAccount | null>(null);
  const [firstRun, setFirstRun] = useState(false);
  const [ready, setReady] = useState(false);
  const [displayAuthError, setDisplayAuthError] = useState(false);
  const displayMode = new URLSearchParams(window.location.search).get("display") === "camera";

  useEffect(() => {
    let active = true;
    if (displayMode) {
      waitForSharedAuthToken()
        .then((token) => {
          if (!token) throw new Error("Не получена авторизованная сессия основного окна.");
          setAuthToken(token);
          return getCurrentAdmin();
        })
        .then((account) => { if (active) { setUser(account); setReady(true); } })
        .catch(() => { if (active) { setDisplayAuthError(true); setReady(true); } });
    } else {
      getBootstrapStatus()
        .then((status) => { if (active) { setFirstRun(!status.initialized); setReady(true); } })
        .catch(() => { if (active) setReady(true); });
    }
    const expired = () => setUser(null);
    window.addEventListener("less:auth-expired", expired);
    return () => { active = false; window.removeEventListener("less:auth-expired", expired); };
  }, [displayMode]);

  const handleLogout = async () => {
    await logoutAdmin().catch(() => undefined);
    setUser(null);
  };

  if (!ready) return <div className="min-h-screen bg-surface flex items-center justify-center text-primary text-sm">Проверка защищённого контура LESS…</div>;
  if (displayMode) return user ? <CameraDisplayPage /> : <div className="min-h-screen bg-surface flex items-center justify-center text-error text-sm">{displayAuthError ? "Не удалось подключить дополнительный экран. Откройте его из авторизованной основной панели." : "Ожидание авторизации…"}</div>;
  if (!user) return <LoginScreen firstRun={firstRun} onAuthenticated={(account) => { setUser(account); setFirstRun(false); }} />;
  return <AdminShell admin={user} onLogout={() => void handleLogout()} />;
}
