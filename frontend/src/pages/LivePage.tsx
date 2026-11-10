import { useEffect, useState, useCallback, useRef } from "react";
import {
  History, ShieldCheck, LockKeyhole, UserRoundSearch, Fingerprint,
  Nfc, Camera, ScanFace, CircleAlert, ArrowUpRight, MonitorUp,
} from "lucide-react";
import VideoFeed from "../components/VideoFeed";
import { openCameraOnExternalDisplay, closeExternalDisplay } from "../services/desktopDisplay";
import { getLogs, listUsers, simulateTestCard, readSerialCardLine, createFaceAccessChallenge, checkFaceAccess, type FaceAccessChallenge, type AccessLog, type SystemStatus, type User } from "../services/api";

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
  const [registeredFaces, setRegisteredFaces] = useState(0);
  const [displayMessage, setDisplayMessage] = useState("");
  const [displayBusy, setDisplayBusy] = useState(false);
  const [testCardBusy, setTestCardBusy] = useState(false);
  const latestFrameRef = useRef<Blob | null>(null);
  const seenCardRef = useRef("");
  const challengeBusyRef = useRef(false);
  const [faceChallenge, setFaceChallenge] = useState<FaceAccessChallenge | null>(null);
  const [challengeEvidence, setChallengeEvidence] = useState<{action:string;frames:string[]}[]>([]);
  const [challengeStep, setChallengeStep] = useState(0);
  const [capturePercent, setCapturePercent] = useState(0);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessResult, setAccessResult] = useState<any>(null);
  const [currentSubject, setCurrentSubject] = useState<any>(null);
  const [externalDisplayMode, setExternalDisplayMode] = useState<"video" | "events" | null>(() => {
    const saved = localStorage.getItem("less-external-display-mode");
    return localStorage.getItem("less-external-display-active") === "1" && (saved === "video" || saved === "events") ? saved : null;
  });
  const externalDisplayActive = externalDisplayMode !== null;
  useEffect(() => {
    const channel = new BroadcastChannel("less-external-display");
    channel.onmessage = (event) => {
      if (event.data?.type === "set-mode" && (event.data.mode === "video" || event.data.mode === "events")) {
        setExternalDisplayMode(event.data.mode);
        localStorage.setItem("less-external-display-active", "1");
        localStorage.setItem("less-external-display-mode", event.data.mode);
      } else if (event.data?.type === "closed") {
        setExternalDisplayMode(null);
        localStorage.removeItem("less-external-display-active");
        localStorage.removeItem("less-external-display-mode");
      }
    };
    return () => channel.close();
  }, []);
  const load = useCallback(async () => {
    try { setLogs(await getLogs(40)); } catch { setLogs([]); }
    try {
      const users: User[] = await listUsers(true);
      setRegisteredFaces(users.filter((user) => !!user.face_enrolled && !!user.is_active && !user.deleted_at).length);
    } catch { setRegisteredFaces(0); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Use the backend's actual status values; "running" and "connected" are not "ok".
  const cameraOk = status?.camera === "running";
  const serialOk = status?.serial === "connected";
  const openExternalDisplay = async (mode: "video" | "events") => {
    setDisplayBusy(true);
    setDisplayMessage("");
    try {
      await openCameraOnExternalDisplay(mode);
      localStorage.setItem("less-external-display-active", "1");
      setExternalDisplayMode(mode);
      localStorage.setItem("less-external-display-mode", mode);
      setDisplayMessage(`На дополнительном мониторе открыт режим: ${mode === "video" ? "видео" : "события"}.`);
    } catch (error) {
      setDisplayMessage(error instanceof Error ? error.message : "Не удалось открыть дополнительный экран.");
    } finally {
      setDisplayBusy(false);
    }
  };
  const closeExternal = async () => {
    try { await closeExternalDisplay(); } finally { localStorage.removeItem("less-external-display-active"); localStorage.removeItem("less-external-display-mode"); setExternalDisplayMode(null); }
  };
  const runTestCard = async () => {
    setTestCardBusy(true);
    try {
      const result = await simulateTestCard({ label: "Виртуальная карта · QA", door_id: "main", direction: "in" });
      setDisplayMessage(result.message);
      await load();
    } catch (error) {
      setDisplayMessage((error as any)?.response?.data?.detail || "Не удалось записать тестовое событие.");
    } finally { setTestCardBusy(false); }
  };
  const granted = logs.filter((log) => log.event_type === "granted").length;
  const denied = logs.filter((log) => log.event_type !== "granted" && log.event_type !== "simulated").length;
  const unknownIdentity = logs.find((log) => {
    const reason = log.reason || "";
    const age = Date.now() - new Date(log.created_at).getTime();
    return /user_not_found|identity_mismatch/.test(reason) && age >= 0 && age < 5 * 60 * 1000;
  });

  return <div className="live-dashboard">
    <div className="page-heading live-heading">
      <div className="live-heading__copy"><span className="eyebrow">ОПЕРАТИВНЫЙ ПОСТ · КПП–01</span><h1>Мониторинг доступа</h1><p>Наблюдение за точкой прохода и проверка факторов идентификации.</p></div>
      <div className="live-heading__metrics">
        <div className="live-mini-metric"><span>СОБЫТИЙ В ЖУРНАЛЕ</span><b>{logs.length}</b></div>
        <div className="live-mini-metric is-success"><span>ДОСТУП РАЗРЕШЁН</span><b>{granted}</b></div>
        <div className="live-mini-metric is-warning"><span>ОТКАЗЫ</span><b>{denied}</b></div>
      </div>
      <div className="post-status"><span className="post-status__dot" /><div><strong>ПОСТ НАБЛЮДЕНИЯ</strong><small>РЕЖИМ ОЖИДАНИЯ</small></div></div>
    </div>

    <div className={`live-grid ${externalDisplayMode ? `live-grid--external live-grid--external-${externalDisplayMode}` : ""}`}>
      <section className="camera-column">
        <div className="camera-monitor-block">
        <div className="panel-heading"><div><span className="eyebrow">ВИЗУАЛЬНЫЙ КОНТРОЛЬ</span><h2>Камера проходной</h2></div><div className="camera-actions"><span className={`camera-indicator ${cameraOk ? "is-live" : ""}`}><i />{cameraOk ? "СИГНАЛ КАМЕРЫ" : "НЕТ ПОДТВЕРЖДЁННОГО СИГНАЛА"}</span><button className="users-button camera-display-button" onClick={() => void runTestCard()} disabled={testCardBusy} title="Временная виртуальная карта: тестовая запись, без проверки личности и без управления замком"><Nfc size={14}/>{testCardBusy ? "Запись…" : "Виртуальная карта · ТЕСТ"}</button><button className="users-button camera-display-button" onClick={() => void openExternalDisplay("video")} disabled={displayBusy}><MonitorUp size={14}/>{displayBusy ? "Открытие…" : "Доп. экран · видео"}</button><button className="users-button camera-display-button" onClick={() => void openExternalDisplay("events")} disabled={displayBusy}><History size={14}/>Доп. экран · события</button>{externalDisplayActive && <button className="users-button camera-display-button" onClick={() => void closeExternal()}><MonitorUp size={14}/>Закрыть доп. экран</button>}</div></div>
        {displayMessage && <p className="users-message" role="status">{displayMessage}</p>}
        <div className={`camera-frame ${externalDisplayActive ? "camera-frame--relayed" : ""}`}>
          {externalDisplayMode !== "video" && <VideoFeed />}
          <div className="camera-frame__top"><span className="camera-tag"><Camera size={13} /> CAM–01</span><span className="camera-tag camera-tag--muted">ГЛАВНЫЙ ВХОД / КПП–01</span></div>
          <div className="camera-frame__corners"><i /><i /><i /><i /></div>
          <div className="camera-frame__bottom"><div className="subject-placeholder"><div className="subject-placeholder__icon"><UserRoundSearch size={19} /></div><div><strong>Ожидание субъекта</strong><span>Поднесите NFC-карту к считывателю</span></div></div><span className="camera-frame__resolution">LIVE VIEW · LOCAL</span></div>
        </div>
        {unknownIdentity && <div className="live-identity-warning" role="alert"><CircleAlert size={17}/><div><strong>НЕИЗВЕСТНЫЙ ИЛИ НЕСОВПАДАЮЩИЙ СУБЪЕКТ</strong><span>{unknownIdentity.reason?.includes("identity_mismatch") ? "UID карты не соответствует карточке сотрудника." : "Карта не привязана к действующему сотруднику."} Проход запрещён. UID: {unknownIdentity.nfc_uid || "не указан"}.</span></div></div>}
        {externalDisplayActive && <div className="external-display-notice"><MonitorUp size={18}/><div><strong>{externalDisplayMode === "video" ? "Видеоканал выведен на дополнительный монитор" : "Лента событий выведена на дополнительный монитор"}</strong><span>{externalDisplayMode === "video" ? "Основное окно показывает журнал доступа на всю рабочую область." : "Основное окно сохраняет видеоканал и увеличивает область наблюдения."}</span></div></div>}
        {<div className="camera-caption"><span>Видеопоток передаётся локально через WebSocket</span><span>Запись кадров не подтверждена интерфейсом</span></div>}{displayMessage && <p className="camera-display-message" role="status">{displayMessage}</p>}

        </div>
        <section className="events-panel">
          <div className="panel-heading panel-heading--compact"><div><span className="eyebrow">ПОСЛЕДНЯЯ АКТИВНОСТЬ</span><h2>События доступа</h2></div><span className="event-count">{logs.length} ЗАПИСЕЙ</span></div>
          <div className="events-table">
            <div className="events-table__head"><span>ВРЕМЯ</span><span>ИДЕНТИФИКАТОР</span><span>РЕЗУЛЬТАТ</span></div>
            {logs.slice(0, 7).map((log) => <div className="event-row" key={log.id}><span className="event-time">{fmt(log.created_at)}</span><span className="event-uid">{log.nfc_uid || "UID НЕ УКАЗАН"}</span><span className={`event-result ${log.event_type === "granted" ? "is-granted" : log.event_type === "simulated" ? "is-simulated" : "is-denied"}`}>{log.event_type === "granted" ? "РАЗРЕШЁН" : log.event_type === "simulated" ? "ТЕСТ · ИМИТАЦИЯ" : "ОТКАЗ"}</span></div>)}
            {!logs.length && <div className="events-empty"><History size={17} /><span>Записи появятся после получения событий от контроллера.</span></div>}
          </div>
        </section>
      </section>

      <aside className="verification-column">
        <section className="surface-panel verification-panel">
          <div className="panel-heading panel-heading--compact"><div><span className="eyebrow">ИДЕНТИФИКАЦИЯ</span><h2>Факторы проверки</h2></div><span className="standby-pill">STANDBY</span></div>
          <div className="factor-list">
            <Factor icon={Nfc} label="NFC-карта / браслет" detail="Ожидание UID от считывателя" state={serialOk ? "ready" : "waiting"} />
            <Factor icon={ScanFace} label="Распознавание лица" detail={`Зарегистрированных профилей: ${registeredFaces}. Сравнение личности при проходе ещё не подключено.`} state="stub" />
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
