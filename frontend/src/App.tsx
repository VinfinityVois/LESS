import { useEffect, useState, type FormEvent } from "react";
import { Activity, ArrowUpRight, Eye, EyeOff, Fingerprint, LockKeyhole, ShieldCheck } from "lucide-react";
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
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
        : await loginAdmin({ username, password, remember_me: rememberMe });
      onAuthenticated(result.user);
    } catch (e: any) {
      setError(e?.response?.data?.detail || (firstRun ? "Не удалось создать учётную запись." : "Не удалось войти. Проверьте данные или подождите после блокировки."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-screen">
      <div className="auth-atmosphere" aria-hidden="true" />
      <section className="auth-showcase" aria-label="LESS Local Entry Security System">
        <div className="auth-showcase__top">
          <div className="auth-brand">
            <div className="auth-brand__mark"><ShieldCheck size={23} strokeWidth={1.7} /></div>
            <div>
              <div className="auth-brand__name">LESS<span>.</span></div>
              <div className="auth-brand__sub">LOCAL ENTRY SECURITY SYSTEM</div>
            </div>
          </div>
          <span className="auth-build-tag">CONTROL / 01</span>
        </div>

        <div className="auth-visual" aria-hidden="true">
          <div className="auth-visual__halo auth-visual__halo--outer" />
          <div className="auth-visual__halo auth-visual__halo--middle" />
          <div className="auth-visual__halo auth-visual__halo--inner" />
          <div className="auth-visual__crosshair auth-visual__crosshair--horizontal" />
          <div className="auth-visual__crosshair auth-visual__crosshair--vertical" />
          <div className="auth-visual__core"><Fingerprint size={76} strokeWidth={1} /></div>
          <span className="auth-visual__coord auth-visual__coord--one">AUTH / LOCAL</span>
          <span className="auth-visual__coord auth-visual__coord--two">AES · ARGON2ID</span>
          <span className="auth-visual__coord auth-visual__coord--three">ACCESS CONTROL</span>
          <span className="auth-visual__orbit-dot" />
        </div>

        <div className="auth-showcase__copy">
          <div className="auth-eyebrow"><span /> SECURE ENVIRONMENT / PRIVATE NETWORK</div>
          <h1>Контроль доступа.<br /><em>Под вашим контролем.</em></h1>
          <p>Единая локальная система идентификации, проверки полномочий и аудита событий безопасности.</p>
        </div>

        <div className="auth-showcase__footer">
          <div className="auth-footer-stat"><span>01</span><strong>Локальная обработка</strong><small>Данные остаются в контуре системы</small></div>
          <div className="auth-footer-stat"><span>02</span><strong>Многофакторная проверка</strong><small>Идентификация и политики доступа</small></div>
          <div className="auth-footer-stat"><span>03</span><strong>Защищённый аудит</strong><small>Контроль целостности событий</small></div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__topline">
          <span>LESS / OPERATOR WORKSPACE</span>
          <span className="auth-local-indicator"><i /> LOCAL SYSTEM</span>
        </div>
        <div className="auth-card">
          <div className="auth-card__icon"><LockKeyhole size={20} strokeWidth={1.7} /></div>
          <div className="auth-eyebrow auth-eyebrow--muted">{firstRun ? "INITIAL CONFIGURATION" : "IDENTITY VERIFICATION"}</div>
          <h2>{firstRun ? "Создание администратора" : "С возвращением"}</h2>
          <p className="auth-card__intro">{firstRun ? "Создайте первую учётную запись суперадминистратора. Она получит полные права управления системой." : "Войдите, используя персональные учётные данные оператора."}</p>

          <form onSubmit={submit} className="auth-form">
            <label htmlFor="less-username">Логин</label>
            <div className="auth-input-wrap">
              <input id="less-username" required minLength={firstRun ? 3 : 1} maxLength={64} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Введите логин" />
              <span className="auth-input-index">ID</span>
            </div>

            {firstRun && <>
              <label htmlFor="less-display-name">Отображаемое имя</label>
              <div className="auth-input-wrap">
                <input id="less-display-name" required maxLength={120} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Имя администратора" />
              </div>
            </>}

            <div className="auth-label-row">
              <label htmlFor="less-password">Пароль</label>
              {!firstRun && <span>ЗАЩИЩЁННАЯ СЕССИЯ</span>}
            </div>
            <div className="auth-input-wrap">
              <input id="less-password" required minLength={firstRun ? 12 : 1} maxLength={256} type={showPassword ? "text" : "password"} autoComplete={firstRun ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Введите пароль" />
              <button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>

            {firstRun && <>
              <label htmlFor="less-confirm-password">Повторите пароль</label>
              <div className="auth-input-wrap">
                <input id="less-confirm-password" required minLength={12} maxLength={256} type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Повторите пароль" />
              </div>
              <p className="auth-hint">Не менее 12 символов. Пароль хранится в виде Argon2id-хеша.</p>
            </>}

            {!firstRun && <label className="auth-remember"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /><span>Запомнить меня</span><small>1 час</small></label>}
            {error && <div role="alert" className="auth-error"><span>!</span><p>{error}</p></div>}
            <button type="submit" disabled={loading} className="auth-submit">
              <span>{loading ? "Проверка учётных данных…" : firstRun ? "Создать защищённую учётную запись" : "Войти в систему"}</span>
              {!loading && <ArrowUpRight size={18} />}
            </button>
          </form>

          <div className="auth-card__security"><ShieldCheck size={15} /><span>{firstRun ? "Первичная регистрация доступна только до создания первого администратора." : "После 5 неудачных попыток вход временно блокируется."}</span></div>
        </div>
        <div className="auth-panel__bottom">
          <span><Activity size={13} /> ACCESS GATE / AUTHENTICATION</span>
          <span>LESS © 2026</span>
        </div>
      </section>
    </main>
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
