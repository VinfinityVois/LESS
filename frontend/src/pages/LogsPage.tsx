import { useEffect, useState, useCallback } from "react";
import { CalendarDays, Download, Archive, RefreshCw } from "lucide-react";
import { getLogDays, getLogDay, exportLogs, type LogDay, type DailyLogEvent } from "../services/api";

function fmt(iso?: string | null, timeOnly = false) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", timeOnly ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { dateStyle: "short", timeStyle: "medium" });
}
function statusText(event: string, reason?: string | null) {
  if (event === "granted") return "Разрешён";
  if (event === "simulated") return "Тест";
  if (reason) return reason.split(":")[0].replaceAll("_", " ");
  return event === "denied" ? "Отказ" : event;
}

function methodText(method?: string | null) {
  const labels: Record<string, string> = {
    "nfc+face": "Карта + лицо",
    "nfc+pin": "Карта + PIN",
    "nfc+fingerprint": "Карта + отпечаток",
    "face": "Распознавание лица",
    "pin": "PIN-код",
    "fingerprint": "Отпечаток пальца",
    "guest_code": "Гостевой код",
    "test": "Тестовый сценарий",
  };
  return method ? (labels[method] || method.replaceAll("+", " + ")) : "Способ не указан";
}

export default function LogsPage() {
  const [days, setDays] = useState<LogDay[]>([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [events, setEvents] = useState<DailyLogEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadDays = useCallback(async () => {
    try {
      const next = await getLogDays();
      setDays(next);
      setSelectedDay((current) => current || next[0]?.day || "");
      setError("");
    } catch { setError("Не удалось загрузить архив событий."); }
  }, []);
  const loadDay = useCallback(async (day: string) => {
    if (!day) { setEvents([]); return; }
    setLoading(true);
    try { const data = await getLogDay(day); setEvents(data.events); setError(""); }
    catch { setError("Не удалось загрузить события выбранного дня."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadDays(); }, [loadDays]);
  useEffect(() => { void loadDay(selectedDay); }, [selectedDay, loadDay]);
  const download = async () => {
    try {
      const blob = await exportLogs(selectedDay || undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `less-events-${selectedDay || "all"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch { setError("Не удалось экспортировать журнал."); }
  };
  return <section className="content-section logs-page">
    <div className="page-heading"><div><span className="eyebrow">АУДИТ ДОСТУПА</span><h1>Журнал событий</h1><p>Текущий день и архив завершённых суток. История сохраняется в базе и доступна для экспорта.</p></div><div className="users-toolbar-actions"><button className="users-button" onClick={() => void loadDays()}><RefreshCw size={15}/> Обновить</button><button className="users-button users-button--primary" onClick={() => void download()}><Download size={15}/> Экспорт CSV</button></div></div>
    <div className="logs-archive-layout">
      <aside className="logs-day-list"><div className="users-section-title"><div><span className="eyebrow">АРХИВ ПО ДАТАМ</span><h2><Archive size={17}/> Дни</h2></div></div>
        {days.map((day) => <button key={day.day} className={selectedDay === day.day ? "is-selected" : ""} onClick={() => setSelectedDay(day.day)}><CalendarDays size={15}/><span><b>{new Date(day.day + "T12:00:00").toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}</b><small>{day.events} событий · {day.granted} разрешено · {day.denied} отказов</small></span></button>)}
        {!days.length && <p className="users-muted">Архив пока пуст.</p>}
      </aside>
      <div className="logs-events-panel"><div className="users-section-title"><div><span className="eyebrow">СВОДКА ДНЯ</span><h2>{selectedDay || "Нет даты"}</h2></div><span className="event-count">{events.length} групп</span></div>
        <div className="logs-compact-table"><div className="logs-compact-head"><span>ПЕРВЫЙ / ПОВТОРНЫЙ ПИК</span><span>СПОСОБ · UID · СОТРУДНИК</span><span>СТАТУС</span></div>
          {events.map((event) => <div className="logs-compact-row" key={`${event.id}-${event.user_id}-${event.nfc_uid}`}><div><b>{fmt(event.first_peak_at, true)}</b><small>{event.repeat_peak_at ? `Повтор: ${fmt(event.repeat_peak_at, true)} · ${event.attempts} попытки` : "Повторных пиков нет"}</small></div><div><b>{methodText(event.factor_used)}</b><small>{event.nfc_uid || "UID —"} · {event.user_name || (event.user_id ? `ID ${event.user_id}` : "Личность не установлена")}</small></div><div><span className={event.event_type === "granted" ? "is-granted" : event.event_type === "simulated" ? "is-simulated" : "is-denied"}>{statusText(event.event_type, event.reason)}</span>{event.reason && event.event_type !== "granted" && <small title={event.reason}>{event.reason.slice(0, 90)}</small>}</div></div>)}
          {!events.length && <div className="logs-empty">{loading ? "Загрузка…" : "За выбранную дату событий нет."}</div>}
        </div>
        <p className="logs-archive-footnote">Группировка: субъект, UID, способ и направление. При отказе показан короткий код причины; полный журнал выгружается в CSV.</p>
      </div>
    </div>
    {error && <p className="users-error" role="alert">{error}</p>}
  </section>;
}
