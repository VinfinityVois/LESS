import { useEffect, useState } from "react";
import {
  Video, History, AlertTriangle, Users, BadgeCheck, SlidersHorizontal,
  RadioTower, Server, BrainCircuit, Nfc, Clock3, Bell, ShieldCheck,
  ChevronRight, Activity, Fingerprint, Camera, Menu, PanelLeftClose, PanelLeftOpen, LogOut,
} from "lucide-react";
import { useSystemStore } from "../stores/systemStore";
import type { AdminAccount, User as UserType } from "../services/api";
import { createGuestCode } from "../services/api";
import LivePage from "./LivePage";
import UsersPage from "./UsersPage";
import LogsPage from "./LogsPage";
import AdminAccountsPage from "./AdminAccountsPage";
import FaceEnroll from "../components/FaceEnroll";

type NavId = "live" | "logs" | "incidents" | "users" | "diagnostics" | "guests" | "admins";
const NAV: { id: NavId; label: string; icon: typeof Video; group: string }[] = [
  { id: "live", label: "Мониторинг", icon: Video, group: "ОПЕРАТИВНЫЙ ПОСТ" },
  { id: "logs", label: "Журнал событий", icon: History, group: "ОПЕРАТИВНЫЙ ПОСТ" },
  { id: "incidents", label: "Инциденты", icon: AlertTriangle, group: "ОПЕРАТИВНЫЙ ПОСТ" },
  { id: "users", label: "Сотрудники и доступ", icon: Users, group: "УПРАВЛЕНИЕ" },
  { id: "guests", label: "Гостевые пропуска", icon: BadgeCheck, group: "УПРАВЛЕНИЕ" },
  { id: "diagnostics", label: "Оборудование", icon: SlidersHorizontal, group: "СИСТЕМА" },
  { id: "admins", label: "Администраторы", icon: ShieldCheck, group: "АДМИНИСТРИРОВАНИЕ" },
];
const pageTitles: Record<NavId, string> = {
  live: "Пост охраны", logs: "Журнал событий", incidents: "Центр инцидентов",
  users: "Управление доступом", diagnostics: "Состояние оборудования", guests: "Гостевые пропуска", admins: "Администраторы и роли",
};
function DeviceState({ icon: Icon, label, value, ok }: { icon: typeof Camera; label: string; value: string; ok: boolean }) {
  return <div className="device-state"><span className={`device-state__icon ${ok ? "is-ok" : "is-off"}`}><Icon size={14} /></span><span className="device-state__label">{label}</span><span className={`device-state__value ${ok ? "is-ok" : "is-off"}`}>{value}</span></div>;
}

export default function AdminShell({ admin, onLogout }: { admin: AdminAccount; onLogout: () => void }) {
  const { status, backendOnline, refresh } = useSystemStore();
  const [nav, setNav] = useState<NavId>("live");
  const [clock, setClock] = useState("");
  const [dateLabel, setDateLabel] = useState("");
  const [enrollUser, setEnrollUser] = useState<UserType | null>(null);
  const [guestMsg, setGuestMsg] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("ru-RU", { hour12: false }));
      setDateLabel(now.toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "long" }));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Values match the backend's GET /api/status response.
  const cameraOk = status?.camera === "running";
  const serialOk = status?.serial === "connected";
  const dbOk = status?.db === "ok";
  const aiOk = status?.ai === "ok";
  const visibleNav = NAV.filter((item) => item.id !== "admins" || admin.role === "superadmin");
  const grouped = visibleNav.reduce<Record<string, typeof NAV>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  const makeGuestCode = async () => {
    setGuestBusy(true);
    setGuestMsg("");
    try {
      const result = await createGuestCode({ label: "Guest", valid_hours: 2, max_uses: 1 });
      setGuestMsg(`Код: ${result.code} · действует до ${result.expires_at}`);
    } catch {
      setGuestMsg("Не удалось создать пропуск. Проверьте соединение с backend.");
    } finally {
      setGuestBusy(false);
    }
  };

  const diagnosticItems = [
    { label: "Сервис приложения", value: backendOnline ? "Доступен" : "Нет соединения", ok: backendOnline, icon: Server, detail: "FastAPI · 127.0.0.1:8000" },
    { label: "Видеоканал", value: cameraOk ? "Доступен" : status?.camera === "stopped" ? "Остановлен" : "Не подтверждён", ok: cameraOk, icon: Camera, detail: "OpenCV · USB camera" },
    { label: "Контроллер доступа", value: serialOk ? "Подключён" : status?.serial === "disconnected" ? "Отключён" : "Ожидание", ok: serialOk, icon: Fingerprint, detail: "Arduino · Serial" },
    { label: "Хранилище", value: dbOk ? "Доступно" : "Не подтверждено", ok: dbOk, icon: Activity, detail: "Локальная база данных" },
    { label: "NFC-считыватель", value: serialOk ? "Контроллер подключён" : "Не подтверждён", ok: serialOk, icon: Nfc, detail: "Канал контроллера · RC522 / PN532" },
    { label: "ИИ-аналитика", value: aiOk ? "Доступна" : status?.ai || "Не проверена", ok: aiOk, icon: BrainCircuit, detail: "Статус backend · /api/status" },
  ];

  return <div className="less-shell">
    <aside className={`less-sidebar ${mobileNav ? "is-open" : ""} ${sidebarPinned ? "is-pinned" : "is-collapsible"}`} aria-label="Боковая навигация">
      <div className="brand-lockup"><div className="brand-mark"><RadioTower size={21} strokeWidth={1.8} /></div><div className="brand-copy"><div className="brand-name">LESS<span> / </span>CONTROL</div><div className="brand-subtitle">LOCAL ENTRY SECURITY SYSTEM</div></div><span className="brand-version">0.1</span><button className="sidebar-toggle" onClick={() => setSidebarPinned((value) => !value)} aria-label={sidebarPinned ? "Свернуть меню" : "Закрепить открытое меню"} title={sidebarPinned ? "Свернуть меню" : "Закрепить меню"}>{sidebarPinned ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button></div>
      <div className="site-selector"><div className="site-selector__top"><span>ОБЪЕКТ НАБЛЮДЕНИЯ</span><span className="site-selector__code">LOC–01</span></div><div className="site-selector__name">Главный контрольно-пропускной пункт</div><div className="site-selector__bottom"><span className="site-live-dot" /> ЛОКАЛЬНЫЙ КОНТУР</div></div>
      <nav className="side-navigation" aria-label="Основная навигация">{Object.entries(grouped).map(([group, items]) => <div className="nav-group" key={group}><div className="nav-group__label">{group}</div>{items.map((item) => { const Icon = item.icon; const active = nav === item.id; return <button key={item.id} className={`nav-link ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => { setNav(item.id); setMobileNav(false); }}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{active && <ChevronRight className="nav-link__arrow" size={15} />}{item.id === "incidents" && <span className="nav-link__count">—</span>}</button>; })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-security"><div className="sidebar-security__icon"><ShieldCheck size={17} /></div><div><strong>Локальный контур</strong><span>Управление через backend</span></div><span className="security-indicator" /></div><div className="sidebar-footer"><span>LESS CONTROL DESK</span><span>BUILD 0.1.0</span></div></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Закрыть меню" onClick={() => setMobileNav(false)} />}
    <section className="less-workspace">
      <header className="topbar"><div className="topbar__left"><button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Открыть меню"><Menu size={19} /></button><div className="breadcrumbs"><span>LESS CONTROL</span><ChevronRight size={13} /><strong>{pageTitles[nav]}</strong></div></div><div className="topbar__right"><div className="system-mode"><span className="system-mode__dot" /> СИСТЕМА {backendOnline ? "АКТИВНА" : "НЕТ СВЯЗИ"}</div><div className="topbar-clock"><Clock3 size={15} /><strong>{clock || "--:--:--"}</strong><span>{dateLabel}</span></div><div className="topbar-icon" aria-label="Уведомления не подключены" title="Сервис уведомлений пока не подключён"><Bell size={17} /></div><div className="operator-chip"><div className="operator-avatar">{admin.display_name.slice(0, 2).toUpperCase()}</div><div><strong>{admin.display_name || admin.username}</strong><span>{admin.role === "superadmin" ? "Суперадминистратор" : admin.role === "admin" ? "Администратор" : "Охрана · просмотр"}</span></div><button type="button" className="operator-logout" onClick={onLogout} title="Выйти из учётной записи" aria-label="Выйти"><LogOut size={16}/></button></div></div></header>
      <div className="system-strip"><DeviceState icon={Server} label="BACKEND" value={backendOnline ? "ONLINE" : "OFFLINE"} ok={backendOnline} /><DeviceState icon={Camera} label="КАМЕРА" value={cameraOk ? "ONLINE" : status?.camera === "stopped" ? "STOPPED" : "НЕТ СИГНАЛА"} ok={cameraOk} /><DeviceState icon={Nfc} label="NFC / СКУД" value={serialOk ? "ONLINE" : status?.serial === "disconnected" ? "DISCONNECTED" : "ОЖИДАНИЕ"} ok={serialOk} /><DeviceState icon={Activity} label="БАЗА ДАННЫХ" value={dbOk ? "ONLINE" : "НЕ ПРОВЕРЕНА"} ok={dbOk} /><div className="system-strip__ai"><BrainCircuit size={15} /><span>AI ANALYTICS</span><b className={aiOk ? "is-ready" : "is-waiting"}>{aiOk ? "ДОСТУПЕН" : status?.ai ? status.ai.toUpperCase() : "НЕ ПРОВЕРЕН"}</b></div></div>
      <main className="workspace-content">
        {nav === "live" && <LivePage status={status} />}
        {nav === "users" && <UsersPage onEnroll={setEnrollUser} readOnly={admin.role === "security"} />}
        {nav === "logs" && <LogsPage />}
        {nav === "admins" && admin.role === "superadmin" && <AdminAccountsPage currentAdminId={admin.id} />}
        {nav === "guests" && <section className="content-section"><div className="page-heading"><div><span className="eyebrow">УПРАВЛЕНИЕ ДОСТУПОМ</span><h1>Гостевые пропуска</h1><p>Временные коды доступа с ограничением по сроку и числу проходов.</p></div></div><div className="surface-panel guest-panel"><div className="panel-icon"><BadgeCheck size={21} /></div><div><h2>Создать временный пропуск</h2><p>Код будет действовать 2 часа и позволит выполнить один проход.</p></div><button className="button-primary" onClick={() => void makeGuestCode()} disabled={guestBusy}>{guestBusy ? "Создание…" : "Сформировать код"}<ChevronRight size={15} /></button>{guestMsg && <div className={`inline-result ${guestMsg.startsWith("Не удалось") ? "is-error" : ""}`} role="status">{guestMsg}</div>}</div></section>}
        {nav === "incidents" && <section className="content-section"><div className="page-heading"><div><span className="eyebrow">МОНИТОРИНГ БЕЗОПАСНОСТИ</span><h1>Центр инцидентов</h1><p>Подозрительные события, отказы оборудования и сигналы аналитики.</p></div><span className="soft-status">НЕТ АКТИВНЫХ ДАННЫХ</span></div><div className="empty-state"><div className="empty-state__icon"><AlertTriangle size={23} /></div><strong>Лента инцидентов не подключена</strong><span>Сейчас backend предоставляет журнал доступа и статус компонентов. Отдельный поток инцидентов ещё не реализован.</span></div></section>}
        {nav === "diagnostics" && <section className="content-section"><div className="page-heading"><div><span className="eyebrow">СИСТЕМНЫЙ КОНТРОЛЬ</span><h1>Состояние оборудования</h1><p>Сводка доступности локальных компонентов СКУД.</p></div></div><div className="diagnostic-grid">{diagnosticItems.map((item) => { const Icon = item.icon; return <div className="diagnostic-card" key={item.label}><div className="diagnostic-card__top"><span className="diagnostic-card__icon"><Icon size={18} /></span><span className={`diagnostic-pill ${item.ok ? "is-ok" : "is-wait"}`}>{item.ok ? "АКТИВЕН" : "ОЖИДАНИЕ"}</span></div><strong>{item.label}</strong><b>{item.value}</b><small>{item.detail}</small></div>; })}</div></section>}
      </main>
    </section>
    {enrollUser && <FaceEnroll userId={enrollUser.id} userName={enrollUser.name || enrollUser.nfc_uid} onDone={() => { setEnrollUser(null); window.dispatchEvent(new Event("less:users-refresh")); }} onCancel={() => setEnrollUser(null)} />}
  </div>;
}
