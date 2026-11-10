import { useEffect, useState, useCallback } from "react";
import {
  History, ShieldCheck, LockKeyhole, UserRoundSearch, Fingerprint,
  Nfc, Camera, ScanFace, CircleAlert, ArrowUpRight, Activity,
} from "lucide-react";
import VideoFeed from "../components/VideoFeed";
import { getLogs, type AccessLog, type SystemStatus } from "../services/api";

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return iso; }
}
function Factor({ icon: Icon, label, detail, state }: {
  icon: typeof Nfc; label: string; detail: string; state: "ready" | "waiting" | "stub";
}) {
  const text = state === "ready" ? "ГОТОВ" : state === "stub" ? "ЗАГЛУШКА" : "ОЖИДАНИЕ";
  return <div className="factor-row"><div className={`factor-icon is-${state}`}><Icon size={16} /></div><div className="factor-copy"><strong>{label}</strong><span>{detail}</span></div><span className={`factor-state is-${state}`}>{text}</span></div>;
}

export default function LivePage({ status }: { status: SystemStatus | null }) {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const load = useCallback(async () => {
    try { setLogs(await getLogs(40)); } catch { setLogs([]); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Use the backend's actual status values; "running" and "connected" are not "ok".
  const cameraOk = status?.camera === "running";
  const serialOk = status?.serial === "connected";
  const aiOk = status?.ai === "ok";
  const granted = logs.filter((log) => log.event_type === "granted").length;
  const denied = logs.filter((log) => log.event_type !== "granted").length;

  return <div className="live-dashboard">
    <div className="page-heading live-heading">
      <div><span className="eyebrow">ОПЕРАТИВНЫЙ ПОСТ · КПП–01</span><h1>Мониторинг доступа</h1><p>Наблюдение за точкой прохода и проверка факторов идентификации.</p></div>
      <div className="post-status"><span className="post-status__dot" /><div><strong>ПОСТ НАБЛЮДЕНИЯ</strong><small>РЕЖИМ ОЖИДАНИЯ</small></div></div>
    </div>

    <div className="metric-row">
      <div className="metric-card"><span className="metric-card__label">СОБЫТИЙ В ЖУРНАЛЕ</span><strong>{logs.length}</strong><span className="metric-card__foot"><Activity size={13} /> Последние записи</span></div>
      <div className="metric-card metric-card--success"><span className="metric-card__label">ДОСТУП РАЗРЕШЁН</span><strong>{granted}</strong><span className="metric-card__foot"><ShieldCheck size={13} /> По журналу событий</span></div>
      <div className="metric-card metric-card--warning"><span className="metric-card__label">ОТКАЗЫ</span><strong>{denied}</strong><span className="metric-card__foot"><CircleAlert size={13} /> По журналу событий</span></div>
      <div className="metric-card"><span className="metric-card__label">КАНАЛ КАМЕРЫ</span><strong className="metric-card__word">{cameraOk ? "ONLINE" : status?.camera === "stopped" ? "OFFLINE" : "—"}</strong><span className="metric-card__foot"><Camera size={13} /> CAM–01 · КПП–01</span></div>
    </div>

    <div className="live-grid">
      <section className="camera-column">
        <div className="panel-heading"><div><span className="eyebrow">ВИЗУАЛЬНЫЙ КОНТРОЛЬ</span><h2>Камера проходной</h2></div><span className={`camera-indicator ${cameraOk ? "is-live" : ""}`}><i />{cameraOk ? "СИГНАЛ КАМЕРЫ" : "НЕТ ПОДТВЕРЖДЁННОГО СИГНАЛА"}</span></div>
        <div className="camera-frame">
          <VideoFeed />
          <div className="camera-frame__top"><span className="camera-tag"><Camera size={13} /> CAM–01</span><span className="camera-tag camera-tag--muted">ГЛАВНЫЙ ВХОД / КПП–01</span></div>
          <div className="camera-frame__corners"><i /><i /><i /><i /></div>
          <div className="camera-frame__bottom"><div className="subject-placeholder"><div className="subject-placeholder__icon"><UserRoundSearch size={19} /></div><div><strong>Ожидание субъекта</strong><span>Поднесите NFC-карту к считывателю</span></div></div><span className="camera-frame__resolution">LIVE VIEW · LOCAL</span></div>
        </div>
        <div className="camera-caption"><span>Видеопоток передаётся локально через WebSocket</span><span>Запись кадров не подтверждена интерфейсом</span></div>

        <section className="events-panel">
          <div className="panel-heading panel-heading--compact"><div><span className="eyebrow">ПОСЛЕДНЯЯ АКТИВНОСТЬ</span><h2>События доступа</h2></div><span className="event-count">{logs.length} ЗАПИСЕЙ</span></div>
          <div className="events-table">
            <div className="events-table__head"><span>ВРЕМЯ</span><span>ИДЕНТИФИКАТОР</span><span>РЕЗУЛЬТАТ</span></div>
            {logs.slice(0, 7).map((log) => <div className="event-row" key={log.id}><span className="event-time">{fmt(log.created_at)}</span><span className="event-uid">{log.nfc_uid || "UID НЕ УКАЗАН"}</span><span className={`event-result ${log.event_type === "granted" ? "is-granted" : "is-denied"}`}>{log.event_type === "granted" ? "РАЗРЕШЁН" : "ОТКАЗ"}</span></div>)}
            {!logs.length && <div className="events-empty"><History size={17} /><span>Записи появятся после получения событий от контроллера.</span></div>}
          </div>
        </section>
      </section>

      <aside className="verification-column">
        <section className="surface-panel verification-panel">
          <div className="panel-heading panel-heading--compact"><div><span className="eyebrow">ИДЕНТИФИКАЦИЯ</span><h2>Факторы проверки</h2></div><span className="standby-pill">STANDBY</span></div>
          <div className="factor-list">
            <Factor icon={Nfc} label="NFC-карта / браслет" detail="Ожидание UID от считывателя" state={serialOk ? "ready" : "waiting"} />
            <Factor icon={ScanFace} label="Распознавание лица" detail="Шаблоны регистрируются; runtime-match пока отключён" state="stub" />
            <Factor icon={LockKeyhole} label="PIN-код" detail="Второй фактор подтверждения" state="waiting" />
            <Factor icon={Fingerprint} label="Отпечаток пальца" detail="Временная программная заглушка" state="stub" />
          </div>
          <div className="verification-note"><ShieldCheck size={16} /><span>Решение о проходе должно приниматься backend после проверки политики доступа.</span></div>
        </section>

        <section className="surface-panel subject-panel">
          <div className="panel-heading panel-heading--compact"><div><span className="eyebrow">ТЕКУЩАЯ СЕССИЯ</span><h2>Карточка субъекта</h2></div><UserRoundSearch size={18} className="muted-icon" /></div>
          <div className="subject-empty"><div className="subject-empty__icon"><ScanFace size={22} /></div><strong>Субъект не определён</strong><span>Данные появятся после чтения карты и успешной идентификации.</span></div>
          <div className="subject-meta"><span>СТАТУС ПРОВЕРКИ</span><b>НЕ НАЧАТА</b></div>
        </section>

        <section className="operator-warning">
          <div className="operator-warning__icon"><LockKeyhole size={17} /></div>
          <div><strong>Команды управления заблокированы</strong><p>Открытие турникета и ручное разрешение не подключены к защищённому API. Интерфейс не отправляет фиктивные команды на контроллер.</p></div>
          <ArrowUpRight size={15} className="operator-warning__arrow" />
        </section>
      </aside>
    </div>
  </div>;
}
