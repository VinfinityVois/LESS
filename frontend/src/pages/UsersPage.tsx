import { useEffect, useState, useCallback, useRef } from "react";
import { Search, Plus, Upload, UserRound, Pencil, Trash2, ScanFace, X, ChevronLeft, FileUp, Clock3, CalendarDays } from "lucide-react";
import { listUsers, createUser, updateUser, deleteUser, getUser, type User as UserType } from "../services/api";

type UserForm = { name: string; position: string; nfc_uid: string; pin: string };
const emptyForm: UserForm = { name: "", position: "", nfc_uid: "", pin: "" };
function fmt(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU");
}
function statusLabel(active: number) { return active ? "АКТИВЕН" : "ЗАБЛОКИРОВАН"; }

export default function UsersPage({ onEnroll }: { onEnroll: (user: UserType) => void }) {
  const [users, setUsers] = useState<UserType[]>([]);
  const [selected, setSelected] = useState<UserType | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "blocked">("all");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [profilePhoto, setProfilePhoto] = useState("");
  const [photoError, setPhotoError] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setUsers(await listUsers(true)); setError(""); }
    catch (e: any) { setError(e?.response?.data?.detail || "Не удалось загрузить пользователей из backend."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = users.filter((user) => {
    const term = search.trim().toLocaleLowerCase("ru");
    const matches = !term || [user.name, user.position, user.nfc_uid, String(user.id)].some((v) => (v || "").toLocaleLowerCase("ru").includes(term));
    return matches && (filter === "all" || (filter === "active" ? !!user.is_active : !user.is_active));
  });

  const resetForm = () => { setForm(emptyForm); setEditId(null); setShowForm(false); setMessage(""); setProfilePhoto(""); setPhotoError(""); if (photoRef.current) photoRef.current.value = ""; };
  const beginEdit = (user: UserType) => {
    setSelected(null);
    setForm({ name: user.name || "", position: user.position || "", nfc_uid: user.nfc_uid || "", pin: "" });
    setProfilePhoto(user.photo_data_url || "");
    setEditId(user.id);
    setShowForm(true);
  };
  const save = async () => {
    if (!form.nfc_uid.trim()) { setMessage("Укажите UID карты или идентификатор пропуска."); return; }
    setBusy(true); setMessage(""); setError("");
    try {
      if (editId !== null) await updateUser(editId, { name: form.name.trim(), position: form.position.trim(), nfc_uid: form.nfc_uid.trim(), pin: form.pin || undefined, photo_data_url: profilePhoto || undefined });
      else await createUser({ name: form.name.trim(), position: form.position.trim(), nfc_uid: form.nfc_uid.trim(), pin: form.pin || undefined, photo_data_url: profilePhoto || undefined });
      await load(); resetForm(); setMessage(editId !== null ? "Изменения сохранены." : "Пользователь добавлен.");
    } catch (e: any) { setMessage(e?.response?.data?.detail || e?.response?.data?.error || e.message || "Не удалось сохранить пользователя."); }
    finally { setBusy(false); }
  };
  const openDetails = async (user: UserType) => {
    setBusy(true);
    try { setSelected(await getUser(user.id)); }
    catch { setSelected(user); }
    finally { setBusy(false); }
  };
  const toggleStatus = async (user: UserType) => {
    setBusy(true);
    try { await updateUser(user.id, { is_active: !user.is_active }); await load(); const refreshed = await getUser(user.id); setSelected(refreshed); }
    catch (e: any) { setError(e?.response?.data?.detail || "Не удалось изменить статус."); }
    finally { setBusy(false); }
  };
  const remove = async (user: UserType) => {
    if (!window.confirm(`Удалить пользователя «${user.name || user.nfc_uid}»? Запись может быть архивирована backend согласно его политике хранения.`)) return;
    setBusy(true);
    try { await deleteUser(user.id); setSelected(null); await load(); }
    catch (e: any) { setError(e?.response?.data?.detail || "Не удалось удалить пользователя."); }
    finally { setBusy(false); }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const text = await file.text();
      const rows: Array<Record<string, unknown>> = file.name.toLowerCase().endsWith(".json")
        ? JSON.parse(text) as Array<Record<string, unknown>>
        : text.split(/\r?\n/).filter(Boolean).slice(1).map((line) => {
            const [name, position, nfc_uid, pin] = line.split(/[;,]/).map((v) => v.trim().replace(/^["']|["']$/g, ""));
            return { name, position, nfc_uid, pin };
          });
      let imported = 0;
      for (const row of rows) {
        const uid = String(row.nfc_uid ?? row.uid ?? "").trim();
        if (!uid) continue;
        await createUser({ name: String(row.name ?? row.full_name ?? ""), position: String(row.position ?? ""), nfc_uid: uid, pin: row.pin ? String(row.pin) : undefined });
        imported++;
      }
      await load(); setMessage(`Импортировано записей: ${imported}. Фото и биометрию можно добавить отдельно в карточке сотрудника.`);
    } catch (e: any) { setError(e?.message || "Не удалось прочитать файл. Поддерживаются JSON и CSV."); }
    finally { setBusy(false); if (importRef.current) importRef.current.value = ""; }
  };

  if (selected) return <section className="content-section users-page">
    <button className="users-back" onClick={() => setSelected(null)}><ChevronLeft size={16}/> К списку сотрудников</button>
    <div className="users-detail-head">
      <div className="user-avatar-large">{selected.photo_data_url ? <img src={selected.photo_data_url} alt="Фото сотрудника"/> : <UserRound size={30}/>}</div>
      <div className="users-detail-name"><span className="eyebrow">ПРОФИЛЬ СОТРУДНИКА · ID {selected.id}</span><h1>{selected.name || "Без имени"}</h1><p>{selected.position || "Должность не указана"} · UID {selected.nfc_uid}</p></div>
      <span className={`user-status ${selected.is_active ? "is-active" : "is-blocked"}`}>{statusLabel(selected.is_active)}</span>
    </div>
    <div className="users-detail-actions">
      <button className="users-button users-button--primary" onClick={() => onEnroll(selected)}><ScanFace size={15}/> Регистрация биометрии</button>
      <button className="users-button" onClick={() => beginEdit(selected)}><Pencil size={15}/> Редактировать</button>
      <button className="users-button" disabled={busy} onClick={() => void toggleStatus(selected)}>{selected.is_active ? "Заблокировать" : "Восстановить доступ"}</button>
      <button className="users-button users-button--danger" disabled={busy} onClick={() => void remove(selected)}><Trash2 size={15}/> Удалить</button>
    </div>
    <div className="users-detail-grid">
      <article className="users-info-card"><span>СТАТУС УЧЁТНОЙ ЗАПИСИ</span><strong>{selected.is_active ? "Доступ активен" : "Доступ заблокирован"}</strong></article>
      <article className="users-info-card"><span>БИОМЕТРИЧЕСКИЙ ПРОФИЛЬ</span><strong>{selected.face_enrolled ? "Шаблон зарегистрирован" : "Не зарегистрирован"}</strong></article>
      <article className="users-info-card"><span><Clock3 size={13}/> ПОСЛЕДНИЙ ВХОД</span><strong>{fmt(selected.last_entry)}</strong></article>
      <article className="users-info-card"><span><Clock3 size={13}/> ПОСЛЕДНИЙ ВЫХОД</span><strong>{fmt(selected.last_exit)}</strong></article>
      <article className="users-info-card"><span><CalendarDays size={13}/> ДАТА РЕГИСТРАЦИИ</span><strong>{fmt(selected.created_at)}</strong></article>
      <article className="users-info-card"><span>ВСЕГО СОБЫТИЙ</span><strong>{selected.total_events ?? selected.logs?.length ?? "Нет данных"}</strong></article>
    </div>
    <div className="users-history-card"><div className="users-section-title"><div><span className="eyebrow">ИСТОРИЯ</span><h2>Последние события прохода</h2></div></div>
      {selected.logs?.length ? <div className="users-history-list">{selected.logs.map((log) => <div key={log.id}><span>{fmt(log.created_at)}</span><b>{log.direction || log.event_type}</b><small>{log.door_id || log.reason || "Точка прохода не указана"}</small></div>)}</div> : <p className="users-muted">История проходов пока не возвращается API карточки пользователя.</p>}
    </div>
  </section>;

  return <section className="content-section users-page">
    <div className="page-heading"><div><span className="eyebrow">УПРАВЛЕНИЕ ПЕРСОНАЛОМ</span><h1>Сотрудники и доступ</h1><p>Регистрация, статусы, биометрические профили и история посещений.</p></div><div className="users-toolbar-actions"><button className="users-button" onClick={() => importRef.current?.click()} disabled={busy}><Upload size={15}/> Импортировать</button><button className="users-button users-button--primary" onClick={() => { resetForm(); setShowForm(true); }}><Plus size={16}/> Добавить пользователя</button><input ref={importRef} type="file" accept=".csv,.json,application/json,text/csv" hidden onChange={(e) => void importFile(e.target.files?.[0])}/></div></div>
    <div className="users-summary"><div><span>ВСЕГО</span><strong>{users.length}</strong></div><div><span>АКТИВНЫЕ</span><strong>{users.filter((u) => !!u.is_active).length}</strong></div><div><span>ЗАБЛОКИРОВАНЫ</span><strong>{users.filter((u) => !u.is_active).length}</strong></div><div><span>С БИОМЕТРИЕЙ</span><strong>{users.filter((u) => !!u.face_enrolled).length}</strong></div></div>
    {showForm && <div className="users-form-card"><div className="users-section-title"><div><span className="eyebrow">{editId !== null ? "ИЗМЕНЕНИЕ ДАННЫХ" : "НОВАЯ УЧЁТНАЯ ЗАПИСЬ"}</span><h2>{editId !== null ? "Редактирование пользователя" : "Добавление пользователя"}</h2></div><button className="users-icon-button" onClick={resetForm} aria-label="Закрыть форму"><X size={17}/></button></div>
      <div className="users-photo-picker"><div className="users-photo-preview">{profilePhoto ? <img src={profilePhoto} alt="Предпросмотр фото профиля"/> : <UserRound size={25}/>}</div><div><b>Фото профиля</b><span>Загрузите фотографию JPG, PNG или WebP. Файл будет отправлен в backend и сохранён в зашифрованном виде.</span><input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { setPhotoError("Максимальный размер фотографии — 5 МБ."); return; } const reader = new FileReader(); reader.onload = () => { setProfilePhoto(String(reader.result || "")); setPhotoError(""); }; reader.readAsDataURL(file); }}/>{photoError && <em>{photoError}</em>}</div><button className="users-button" type="button" onClick={() => { setProfilePhoto(""); if (photoRef.current) photoRef.current.value = ""; }}>Убрать фото</button></div>
      <div className="users-form-grid"><label>ФИО<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Иванов Иван Иванович"/></label><label>Должность / подразделение<input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Сотрудник отдела"/></label><label>UID карты / пропуска<input value={form.nfc_uid} onChange={(e) => setForm({ ...form, nfc_uid: e.target.value })} placeholder="04:A2:…"/></label><label>PIN-код <span>(необязательно)</span><input type="password" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} placeholder="Задайте PIN"/></label></div>
      <div className="users-form-footer"><span>Дата регистрации будет установлена backend при создании записи.</span><div><button className="users-button" onClick={resetForm}>Отмена</button><button className="users-button users-button--primary" onClick={() => void save()} disabled={busy}>{busy ? "Сохранение…" : editId !== null ? "Сохранить изменения" : "Создать пользователя"}</button></div></div>{message && <p className="users-message">{message}</p>}
    </div>}
    <div className="users-list-card"><div className="users-list-toolbar"><div className="users-search"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по ФИО, UID или ID"/></div><div className="users-filters"><button className={filter === "all" ? "is-selected" : ""} onClick={() => setFilter("all")}>Все</button><button className={filter === "active" ? "is-selected" : ""} onClick={() => setFilter("active")}>Активные</button><button className={filter === "blocked" ? "is-selected" : ""} onClick={() => setFilter("blocked")}>Заблокированные</button></div></div>
      {error && <p className="users-error">{error}</p>}{message && !showForm && <p className="users-message">{message}</p>}
      <div className="users-table-wrap"><table className="users-table"><thead><tr><th>СОТРУДНИК</th><th>СТАТУС</th><th>БИОМЕТРИЯ</th><th>ПОСЛЕДНИЙ ВХОД</th><th>ПОСЛЕДНИЙ ВЫХОД</th><th>РЕГИСТРАЦИЯ</th><th></th></tr></thead><tbody>
        {filtered.map((user) => <tr key={user.id}><td><button className="users-person-cell" onClick={() => void openDetails(user)}><span className="user-avatar"><UserRound size={17}/></span><span><b>{user.name || "Без имени"}</b><small>{user.position || "—"} · {user.nfc_uid}</small></span></button></td><td><span className={`user-status ${user.is_active ? "is-active" : "is-blocked"}`}>{statusLabel(user.is_active)}</span></td><td><span className={`biometric-state ${user.face_enrolled ? "is-ready" : ""}`}>{user.face_enrolled ? "ЕСТЬ ШАБЛОН" : "НЕ ЗАРЕГ."}</span></td><td>{fmt(user.last_entry)}</td><td>{fmt(user.last_exit)}</td><td>{fmt(user.created_at)}</td><td><div className="users-row-actions"><button title="Редактировать" onClick={() => beginEdit(user)}><Pencil size={14}/></button><button title="Биометрия" onClick={() => onEnroll(user)}><ScanFace size={15}/></button><button title="Удалить" onClick={() => void remove(user)}><Trash2 size={14}/></button></div></td></tr>)}
        {!filtered.length && <tr><td colSpan={7} className="users-empty"><UserRound size={22}/><b>Пользователи не найдены</b><span>{users.length ? "Измените запрос или фильтр." : "Добавьте первого пользователя или импортируйте список."}</span></td></tr>}
      </tbody></table></div>
      <div className="users-list-footer"><span>Показано {filtered.length} из {users.length}</span><button onClick={() => void load()} disabled={busy}>Обновить данные</button></div>
    </div>
    <div className="users-import-hint"><FileUp size={15}/><span>Импорт CSV: <code>name,position,nfc_uid,pin</code>. JSON: массив объектов с этими полями. Данные создаются через backend API.</span></div>
  </section>;
}
