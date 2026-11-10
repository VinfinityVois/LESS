import { useCallback, useEffect, useState, type FormEvent } from "react";
import { UserPlus, ShieldCheck, Shield, UserRound, RefreshCw, UserX, UserCheck, History } from "lucide-react";
import { createAdminAccount, getAdminAudit, listAdminAccounts, setAdminAccountActive, type AdminAccount } from "../services/api";

type AuditEvent = { id:number; username?:string; action:string; target?:string; details?:string; created_at:string };

export default function AdminAccountsPage({ currentAdminId }: { currentAdminId:number }) {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin"|"security">("admin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [accounts, audit] = await Promise.all([listAdminAccounts(), getAdminAudit(100)]);
      setAdmins(accounts);
      setEvents(audit.events || []);
      setError("");
    } catch (e:any) {
      setError(e?.response?.data?.detail || "Не удалось загрузить администраторов и журнал.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      await createAdminAccount({ username, display_name: displayName || username, password, role });
      setUsername(""); setDisplayName(""); setPassword(""); setShowForm(false);
      setMessage("Учётная запись создана.");
      await load();
    } catch (e:any) {
      setError(e?.response?.data?.detail || "Не удалось создать учётную запись.");
    } finally { setBusy(false); }
  };

  const toggle = async (account:AdminAccount) => {
    if (account.id === currentAdminId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await setAdminAccountActive(account.id, !account.is_active);
      setMessage(account.is_active ? "Учётная запись отключена. Её активные сессии отозваны." : "Учётная запись активирована.");
      await load();
    } catch (e:any) { setError(e?.response?.data?.detail || "Не удалось изменить статус."); }
    finally { setBusy(false); }
  };

  const fmt = (value:string) => { try { return new Date(value).toLocaleString("ru-RU"); } catch { return value; } };
  const roleLabel = (value:string) => value === "superadmin" ? "Суперадминистратор" : value === "admin" ? "Администратор" : "Охрана · чтение";

  return <section className="content-section">
    <div className="page-heading"><div><span className="eyebrow">КОНТРОЛЬ ПОЛЬЗОВАТЕЛЕЙ ПАНЕЛИ</span><h1>Администраторы и роли</h1><p>Персональные учётные записи, отзыв сессий и аудит действий в системе.</p></div><button className="button-primary" onClick={() => setShowForm((v)=>!v)}><UserPlus size={15}/> Добавить администратора</button></div>
    {error && <div className="users-error">{error}</div>}{message && <div className="users-message">{message}</div>}
    {showForm && <form className="surface-panel admin-account-form" onSubmit={(e)=>void create(e)}>
      <div className="panel-heading"><div><span className="eyebrow">НОВАЯ УЧЁТНАЯ ЗАПИСЬ</span><h2>Добавление администратора</h2></div></div>
      <div className="users-form-grid"><label>Логин<input required minLength={3} maxLength={64} autoComplete="off" value={username} onChange={(e)=>setUsername(e.target.value)}/></label><label>Имя<input required maxLength={120} value={displayName} onChange={(e)=>setDisplayName(e.target.value)}/></label><label>Временный пароль · минимум 12 символов<input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={(e)=>setPassword(e.target.value)}/></label><label>Роль<select value={role} onChange={(e)=>setRole(e.target.value as "admin"|"security")}><option value="admin">Администратор · управление</option><option value="security">Охрана · просмотр</option></select></label></div>
      <div className="users-form-footer"><span>Пароль хранится в виде Argon2id-хеша.</span><div><button type="button" className="users-button" onClick={()=>setShowForm(false)}>Отмена</button><button className="users-button users-button--primary" disabled={busy}>{busy?"Создание…":"Создать аккаунт"}</button></div></div>
    </form>}
    <div className="surface-panel admin-accounts-panel"><div className="panel-heading"><div><span className="eyebrow">УЧЁТНЫЕ ЗАПИСИ</span><h2>Список администраторов</h2></div><button className="users-button" onClick={()=>void load()} disabled={busy}><RefreshCw size={14}/> Обновить</button></div>
      <div className="admin-account-list">{admins.map((account)=><div className="admin-account-row" key={account.id}><span className="admin-account-avatar">{account.role==="superadmin"?<ShieldCheck size={18}/>:account.role==="admin"?<Shield size={18}/>:<UserRound size={18}/>}</span><div className="admin-account-info"><strong>{account.display_name}</strong><span>@{account.username} · {roleLabel(account.role)}</span><small>Создан: {fmt(account.created_at)}</small></div><span className={`user-status ${account.is_active?"is-active":"is-blocked"}`}>{account.is_active?"АКТИВЕН":"ОТКЛЮЧЁН"}</span><button className="users-button" disabled={busy || account.id===currentAdminId || account.role==="superadmin"} onClick={()=>void toggle(account)} title={account.id===currentAdminId?"Нельзя отключить собственную запись":account.is_active?"Отключить":"Активировать"}>{account.is_active?<><UserX size={14}/> Отключить</>:<><UserCheck size={14}/> Включить</>}</button></div>)}</div>
    </div>
    <div className="surface-panel admin-audit-panel"><div className="panel-heading"><div><span className="eyebrow">НЕИЗМЕНЯЕМЫЙ ЖУРНАЛ СОБЫТИЙ</span><h2><History size={17}/> Действия администраторов</h2></div><span className="event-count">{events.length} СОБЫТИЙ</span></div>
      <div className="admin-audit-list">{events.map((event)=><div className="admin-audit-row" key={event.id}><time>{fmt(event.created_at)}</time><strong>{event.username || "Система"}</strong><span>{event.action}</span><small>{event.target} {event.details}</small></div>)}{!events.length&&<p className="users-empty">Журнал пока пуст.</p>}</div>
    </div>
  </section>;
}
