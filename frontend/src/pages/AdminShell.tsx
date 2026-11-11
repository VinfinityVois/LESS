import { useEffect, useState } from "react";
import {
  Video, History, AlertTriangle, Users, BadgeCheck, SlidersHorizontal,
  RadioTower, Server, BrainCircuit, Nfc, Clock3, Bell, ShieldCheck,
  ChevronRight, Activity, Fingerprint, Camera, Menu, LogOut,
} from "lucide-react";
import { useSystemStore } from "../stores/systemStore";
import type { AdminAccount, User as UserType } from "../services/api";
import { createGuestCode, listGuestPasses, listGuestPassArchive, updateGuestPass, deleteGuestPass, type GuestPass, type ArchivedGuestPass } from "../services/api";
import LivePage from "./LivePage";
import UsersPage from "./UsersPage";
import LogsPage from "./LogsPage";
import IncidentsPage from "./IncidentsPage";
import BiometricLabPage from "./BiometricLabPage";
import AdminAccountsPage from "./AdminAccountsPage";
import FaceEnroll from "../components/FaceEnroll";

type NavId = "live" | "logs" | "incidents" | "biometrics" | "users" | "diagnostics" | "guests" | "admins";
const NAV: { id: NavId; label: string; icon: typeof Video; group: string }[] = [
  { id: "live", label: "Мониторинг", icon: Video, group: "ОПЕРАТИВНЫЙ ПОСТ" },
  { id: "logs", label: "Журнал событий", icon: History, group: "ОПЕРАТИВНЫЙ ПОСТ" },
  { id: "incidents", label: "Инциденты", icon: AlertTriangle, group: "ОПЕРАТИВНЫЙ ПОСТ" },
  { id: "biometrics", label: "Лаборатория биометрии", icon: Fingerprint, group: "АНАЛИТИКА" },
  { id: "users", label: "Сотрудники и доступ", icon: Users, group: "УПРАВЛЕНИЕ" },
  { id: "guests", label: "Гостевые пропуска", icon: BadgeCheck, group: "УПРАВЛЕНИЕ" },
  { id: "diagnostics", label: "Оборудование", icon: SlidersHorizontal, group: "СИСТЕМА" },
  { id: "admins", label: "Администраторы", icon: ShieldCheck, group: "АДМИНИСТРИРОВАНИЕ" },
];
const pageTitles: Record<NavId, string> = {
  live: "Пост охраны", logs: "Журнал событий", incidents: "Центр инцидентов", biometrics: "Лаборатория биометрии",
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
  const [guestName, setGuestName] = useState("Гость");
  const [guestHours, setGuestHours] = useState(2);
  const [guestDoor, setGuestDoor] = useState("main");
  const [guestPasses, setGuestPasses] = useState<GuestPass[]>([]);
  const [guestArchive, setGuestArchive] = useState<ArchivedGuestPass[]>([]);
  const [guestArchiveOpen, setGuestArchiveOpen] = useState(false);
  const [guestNow, setGuestNow] = useState(Date.now());
  const [guestDialog, setGuestDialog] = useState<{id:number;action:"delete"|"extend"} | null>(null);
  const [guestDialogHours, setGuestDialogHours] = useState("2");
  const [guestActionBusy, setGuestActionBusy] = useState<number | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (nav === "guests") void listGuestPasses().then(setGuestPasses).catch(() => setGuestMsg("Не удалось загрузить гостевые пропуска."));
  }, [nav]);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("ru-RU", { hour12: false }));
      setDateLabel(now.toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "long" }));
      setGuestNow(now.getTime());
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
  const visibleNav = NAV.filter((item) => (item.id !== "admins" || admin.role === "superadmin") && (item.id !== "biometrics" || admin.role !== "security"));
  const grouped = visibleNav.reduce<Record<string, typeof NAV>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  const refreshGuestArchive = async () => {
    try { const archive = await listGuestPassArchive(); setGuestArchive(archive.codes); }
    catch { setGuestMsg("Не удалось загрузить архив гостевых пропусков."); }
  };

  const guestCountdown = (expiresAt: string) => {
    const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - guestNow) / 1000));
    if (!Number.isFinite(seconds) || seconds <= 0) return "СРОК ИСТЁК";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return days ? `${days} дн. ${hours} ч. ${minutes} мин.` : hours ? `${hours} ч. ${minutes} мин. ${secs} сек.` : `${minutes} мин. ${secs} сек.`;
  };

  const makeGuestCode = async () => {
    setGuestBusy(true);
    setGuestMsg("");
    try {
      const result = await createGuestCode({ label: guestName.trim() || "Гость", valid_hours: guestHours, max_uses: 1, door_ids: [guestDoor] });
      setGuestMsg("Пропуск создан. Код: " + result.code);
      setGuestPasses(await listGuestPasses());
    } catch {
      setGuestMsg("Не удалось создать пропуск. Проверьте соединение с backend.");
    } finally {
      setGuestBusy(false);
    }
  };

  const runGuestAction = async (id: number, action: "close" | "block" | "restore" | "reset" | "extend" | "delete", hours = 2) => {
    setGuestActionBusy(id);
    try {
      if (action === "delete") await deleteGuestPass(id);
      else await updateGuestPass(id, action, hours);
      setGuestPasses(await listGuestPasses());
      setGuestMsg("Изменения гостевого пропуска сохранены.");
    } catch { setGuestMsg("Не удалось изменить гостевой пропуск."); }
    finally { setGuestActionBusy(null); }
  };

  const confirmGuestDialog = () => {
    if (!guestDialog) return;
    const current = guestDialog;
    const hours = Number(guestDialogHours);
    if (current.action === "extend" && (!Number.isFinite(hours) || hours <= 0 || hours > 720)) return;
    setGuestDialog(null);
    void runGuestAction(current.id, current.action, hours);
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
    <aside className={`less-sidebar is-pinned ${mobileNav ? "is-open" : ""}`} aria-label="Боковая навигация">
      <div className="brand-lockup"><div className="brand-mark"><RadioTower size={21} strokeWidth={1.8} /></div><div className="brand-copy"><div className="brand-name">LESS<span> / </span>CONTROL</div><div className="brand-subtitle">LOCAL ENTRY SECURITY SYSTEM</div></div><span className="brand-version">0.1</span></div>
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
        {nav === "guests" && <section className="content-section guest-page"><div className="page-heading"><div><span className="eyebrow">УПРАВЛЕНИЕ ДОСТУПОМ</span><h1>Гостевые пропуска</h1><p>Именные временные разрешения с привязкой к точке прохода и сроку действия.</p></div></div><div className="guest-archive-toolbar"><button className={guestArchiveOpen ? "users-button" : "users-button users-button--primary"} onClick={() => setGuestArchiveOpen(false)}>Действующие · {guestPasses.length}</button><button className={guestArchiveOpen ? "users-button users-button--primary" : "users-button"} onClick={() => { setGuestArchiveOpen(true); void refreshGuestArchive(); }}>Архив · {guestArchive.length}</button></div>{!guestArchiveOpen && <div className="surface-panel guest-create-card"><div className="guest-create-fields"><label>Кому выдаётся<input value={guestName} onChange={(e)=>setGuestName(e.target.value)} placeholder="ФИО гостя / компания"/></label><label>Куда разрешён проход<select value={guestDoor} onChange={(e)=>setGuestDoor(e.target.value)}><option value="main">Главный вход</option><option value="server_room">Серверная</option></select></label><label>Срок действия<select value={guestHours} onChange={(e)=>setGuestHours(Number(e.target.value))}><option value={1}>1 час</option><option value={2}>2 часа</option><option value={4}>4 часа</option><option value={8}>8 часов</option><option value={24}>24 часа</option><option value={72}>72 часа</option></select></label></div><button className="button-primary" onClick={() => void makeGuestCode()} disabled={guestBusy}>{guestBusy ? "Создание…" : "Выдать гостевой пропуск"}<ChevronRight size={15}/></button>{guestMsg && <div className={`inline-result ${guestMsg.startsWith("Не удалось") ? "is-error" : ""}`} role="status">{guestMsg}</div>}</div>{!guestArchiveOpen && <div className="guest-pass-grid">{guestPasses.map((pass)=><article className="guest-pass-card" key={pass.id}><div className="guest-pass-card__top"><span className="eyebrow">ВРЕМЕННЫЙ ДОПУСК · #{pass.id}</span><span className={"guest-pass-state " + (pass.active ? "is-active" : "is-inactive")}>{pass.status === "blocked" ? "ЗАБЛОКИРОВАН" : pass.status === "closed" ? "ЗАКРЫТ" : pass.active ? "АКТИВЕН" : "ИСТЁК / ИСЧЕРПАН"}</span></div><h2>{pass.label}</h2><div className="guest-pass-code">•••• {pass.code_prefix}</div><div className="guest-pass-meta"><span>ВЫДАН</span><b>{new Date(pass.created_at).toLocaleString("ru-RU")}</b><span>ДЕЙСТВУЕТ ДО</span><b>{new Date(pass.expires_at).toLocaleString("ru-RU")}</b><span>ОСТАЛОСЬ</span><b className={guestCountdown(pass.expires_at) === "СРОК ИСТЁК" ? "guest-countdown is-expired" : "guest-countdown"}>{guestCountdown(pass.expires_at)}</b><span>ТОЧКА ПРОХОДА</span><b>{pass.door_ids.map((door)=>door==="server_room"?"Серверная":"Главный вход").join(", ")}</b><span>ИСПОЛЬЗОВАНО</span><b>{pass.uses} / {pass.max_uses}</b></div><div className="guest-pass-actions"><button disabled={guestActionBusy===pass.id} onClick={()=>void runGuestAction(pass.id,"close")}>Закрыть</button><button disabled={guestActionBusy===pass.id} onClick={()=>void runGuestAction(pass.id,"reset")}>Обнулить</button><button disabled={guestActionBusy===pass.id} onClick={()=>void runGuestAction(pass.id,"restore")}>Восстановить</button><button disabled={guestActionBusy===pass.id} onClick={()=>void runGuestAction(pass.id,"block")}>Заблокировать</button><button disabled={guestActionBusy===pass.id} onClick={()=>{setGuestDialogHours("2");setGuestDialog({id:pass.id,action:"extend"});}}>Продлить</button><button disabled={guestActionBusy===pass.id} onClick={()=>setGuestDialog({id:pass.id,action:"delete"})}>Удалить</button></div></article>)}{!guestPasses.length && <div className="guest-pass-empty"><BadgeCheck size={22}/><strong>Пока нет выданных пропусков</strong><span>Создайте гостевой пропуск — он появится отдельной карточкой с получателем, сроком и точкой прохода.</span></div>}</div>}
        {guestArchiveOpen && <div className="guest-pass-grid guest-pass-grid--archive">{guestArchive.map((pass)=><article className="guest-pass-card guest-pass-card--archived" key={pass.id}><div className="guest-pass-card__top"><span className="eyebrow">АРХИВ · #{pass.id}</span><span className="guest-pass-state is-inactive">{pass.archive_reason === "expired" ? "ИСТЁК" : pass.archive_reason === "uses_exhausted" ? "ЛИМИТ ИСЧЕРПАН" : "УДАЛЁН ВРУЧНУЮ"}</span></div><h2>{pass.label}</h2><div className="guest-pass-meta"><span>ВЫДАН</span><b>{new Date(pass.created_at).toLocaleString("ru-RU")}</b><span>ДЕЙСТВОВАЛ ДО</span><b>{new Date(pass.expires_at).toLocaleString("ru-RU")}</b><span>АРХИВИРОВАН</span><b>{new Date(pass.archived_at).toLocaleString("ru-RU")}</b><span>ИСПОЛЬЗОВАНО</span><b>{pass.uses} / {pass.max_uses}</b></div></article>)}{!guestArchive.length && <div className="guest-pass-empty"><Archive size={22}/><strong>Архив пока пуст</strong><span>Здесь появятся истёкшие, исчерпанные и вручную удалённые пропуска.</span></div>}</div>}
        </section>}
        {nav === "incidents" && <IncidentsPage canAnalyze={admin.role !== "security"} />}
        {nav === "biometrics" && admin.role !== "security" && <BiometricLabPage />}
        {nav === "diagnostics" && <section className="content-section"><div className="page-heading"><div><span className="eyebrow">СИСТЕМНЫЙ КОНТРОЛЬ</span><h1>Состояние оборудования</h1><p>Сводка доступности локальных компонентов СКУД.</p></div></div><div className="diagnostic-grid">{diagnosticItems.map((item) => { const Icon = item.icon; return <div className="diagnostic-card" key={item.label}><div className="diagnostic-card__top"><span className="diagnostic-card__icon"><Icon size={18} /></span><span className={`diagnostic-pill ${item.ok ? "is-ok" : "is-wait"}`}>{item.ok ? "АКТИВЕН" : "ОЖИДАНИЕ"}</span></div><strong>{item.label}</strong><b>{item.value}</b><small>{item.detail}</small></div>; })}</div></section>}
      </main>
    </section>
    {guestDialog && <div className="operator-dialog-backdrop"><section className="operator-dialog" role="dialog" aria-modal="true" aria-labelledby="guest-dialog-title"><span className="eyebrow">УПРАВЛЕНИЕ ПРОПУСКОМ · #{guestDialog.id}</span><h2 id="guest-dialog-title">{guestDialog.action === "delete" ? "Удалить гостевой пропуск?" : "Продлить срок действия"}</h2><p>{guestDialog.action === "delete" ? "Пропуск будет удалён без возможности восстановления. История его использования останется в журнале." : "Укажите, на сколько часов продлить действие пропуска."}</p>{guestDialog.action === "extend" && <label className="operator-dialog-field">СРОК ПРОДЛЕНИЯ · ЧАСЫ<input type="number" min="0.1" max="720" step="0.5" value={guestDialogHours} onChange={(event)=>setGuestDialogHours(event.target.value)}/></label>}<div className="operator-dialog-actions"><button className="users-button" onClick={()=>setGuestDialog(null)}>Отмена</button><button className={guestDialog.action === "delete" ? "users-button users-button--danger" : "users-button users-button--primary"} onClick={confirmGuestDialog}>{guestDialog.action === "delete" ? "Удалить пропуск" : "Продлить"}</button></div></section></div>}
    {enrollUser && <FaceEnroll userId={enrollUser.id} userName={enrollUser.name || enrollUser.nfc_uid} onDone={() => { setEnrollUser(null); window.dispatchEvent(new Event("less:users-refresh")); }} onCancel={() => setEnrollUser(null)} />}
  </div>;
}
