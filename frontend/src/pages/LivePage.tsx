import { useEffect, useState, useCallback, useRef } from "react";
import {
  History, ShieldCheck, LockKeyhole, UserRoundSearch, Fingerprint,
  Nfc, Camera, ScanFace, CircleAlert, MonitorUp,
} from "lucide-react";
import VideoFeed from "../components/VideoFeed";
import { openCameraOnExternalDisplay, closeExternalDisplay } from "../services/desktopDisplay";
import { getLogs, listUsers, simulateTestCard, readSerialCardLine, createFaceAccessChallenge, checkFaceAccess, getHardwareStatus, verifySecurityAudit, recognizeMonitoringFace, type FaceAccessChallenge, type AccessLog, type SystemStatus, type User } from "../services/api";

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
  const [hardwareStatus, setHardwareStatus] = useState<any>(null);
  const [auditStatus, setAuditStatus] = useState<any>(null);
  const [displayMessage, setDisplayMessage] = useState("");
  const [displayBusy, setDisplayBusy] = useState(false);
  const [testCardBusy, setTestCardBusy] = useState(false);
  const latestFrameRef = useRef<Blob | null>(null);
  const seenCardRef = useRef("");
  const challengeBusyRef = useRef(false);
  const recognitionBusyRef = useRef(false);
  const lastRecognitionAtRef = useRef(0);
  const faceChallengeRef = useRef<FaceAccessChallenge | null>(null);
  const subjectStageRef = useRef("idle");
  const [faceChallenge, setFaceChallenge] = useState<FaceAccessChallenge | null>(null);
  const [challengeEvidence, setChallengeEvidence] = useState<{action:string;frames:string[]}[]>([]);
  const [challengeStep, setChallengeStep] = useState(0);
  const [capturePercent, setCapturePercent] = useState(0);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessResult, setAccessResult] = useState<any>(null);
  const [currentSubject, setCurrentSubject] = useState<any>(null);
  const [subjectStage, setSubjectStage] = useState<"idle" | "identified" | "card" | "challenge" | "recognizing" | "granted" | "denied">("idle");
  const [externalDisplayMode, setExternalDisplayMode] = useState<"video" | "events" | null>(() => {
    const saved = localStorage.getItem("less-external-display-mode");
    return localStorage.getItem("less-external-display-active") === "1" && (saved === "video" || saved === "events") ? saved : null;
  });
  const externalDisplayActive = externalDisplayMode !== null;
  const cameraOk = status?.camera === "running";
  const serialOk = status?.serial === "connected";
  const activeSubject = faceChallenge?.user || currentSubject;
  faceChallengeRef.current = faceChallenge;
  subjectStageRef.current = subjectStage;
  const subjectStageLabel = ({ idle: "ОЖИДАНИЕ", identified: "ЛИЧНОСТЬ ОПРЕДЕЛЕНА · БЕЗ ПРОХОДА", card: "КАРТА СЧИТАНА", challenge: "ПРОВЕРКА ПРИСУТСТВИЯ", recognizing: "РАСПОЗНАВАНИЕ ЛИЦА", granted: "ДОСТУП ПОДТВЕРЖДЁН", denied: "ДОСТУП ОТКЛОНЁН" } as const)[subjectStage];
  const onCameraFrame = useCallback((blob: Blob) => {
    latestFrameRef.current = blob;
    const now = Date.now();
    if (now - lastRecognitionAtRef.current < 1400 || recognitionBusyRef.current || faceChallengeRef.current) return;
    lastRecognitionAtRef.current = now;
    recognitionBusyRef.current = true;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const frame = String(reader.result || "");
        if (!frame.startsWith("data:image/")) return;
        const result = await recognizeMonitoringFace(frame);
        if (result.status === "identified" && result.subject) {
          setCurrentSubject(result.subject);
          if (subjectStageRef.current === "idle" || subjectStageRef.current === "identified") setSubjectStage("identified");
        } else if (subjectStageRef.current === "identified") {
          setCurrentSubject(null);
          setSubjectStage("idle");
        }
      } catch { /* recognition must not interrupt the live camera feed */ }
      finally { recognitionBusyRef.current = false; }
    };
    reader.onerror = () => { recognitionBusyRef.current = false; };
    reader.readAsDataURL(blob);
  }, []);
  const parseCardUid = (raw: string | null) => {
    if (!raw) return null;
    let value = raw.trim();
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed.uid === "string") value = parsed.uid; } catch { /* plain UID line */ }
    value = value.replace(/^(?:CARD\s+UID|UID|CARD|NFC|CARD_UID)\s*[:=]\s*/i, "").trim();
    if (!/^[A-Za-z0-9:_ -]{4,80}$/.test(value)) return null;
    return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null;
  };
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
    try { setHardwareStatus(await getHardwareStatus()); } catch { setHardwareStatus(null); }
    try { setAuditStatus(await verifySecurityAudit()); } catch { setAuditStatus({ valid: false, error: "Проверка аудита недоступна" }); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!serialOk) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (!active || challengeBusyRef.current) return;
      try {
        // Keep draining the serial stream while face verification is active:
        // authenticated controller ACK/door telemetry shares this transport.
        const raw = await readSerialCardLine();
        if (faceChallenge) return;
        const uid = parseCardUid(raw);
        if (!uid || uid === seenCardRef.current) return;
        seenCardRef.current = uid;
        challengeBusyRef.current = true;
        setAccessResult(null);
        setCurrentSubject(null);
        setSubjectStage("card");
        setDisplayMessage("Карта считана. Поиск карточки субъекта…");
        try {
          const challenge = await createFaceAccessChallenge({ nfc_uid: uid, door_id: "main", direction: "in" });
          if (!active) return;
          challenge.nfc_uid = uid;
          setFaceChallenge(challenge);
          setChallengeEvidence([]);
          setChallengeStep(0);
          setCurrentSubject(challenge.user);
          setSubjectStage("challenge");
          setDisplayMessage("");
        } catch (error: any) {
          const detail = error?.response?.data?.detail;
          setAccessResult({ decision: "deny", code: detail?.code || "card_rejected", reason: detail?.message || detail || "Не удалось начать проверку лица." });
          setSubjectStage("denied");
          setDisplayMessage(detail?.message || detail || "Карта отклонена. Проход запрещён.");
          seenCardRef.current = "";
        } finally { challengeBusyRef.current = false; }
      } catch { /* serial input may be empty between reads */ }
    }, 300);
    return () => { active = false; window.clearInterval(timer); };
  }, [serialOk, faceChallenge]);

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
  const captureFaceAction = async () => {
    if (!faceChallenge || accessBusy) return;
    const action = faceChallenge.actions[challengeStep];
    setAccessBusy(true);
    setCapturePercent(0);
    try {
      const frames: string[] = [];
      const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      for (let i = 0; i < 36; i++) {
        const blob = latestFrameRef.current;
        if (!blob) throw new Error("Нет видеокадра от камеры. Проверьте видеопоток.");
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Не удалось подготовить кадр камеры.");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        frames.push(canvas.toDataURL("image/jpeg", 0.72));
        setCapturePercent(Math.round(((i + 1) / 36) * 100));
        await wait(95);
      }
      const next = [...challengeEvidence, { action, frames }];
      setChallengeEvidence(next);
      if (challengeStep + 1 < faceChallenge.actions.length) {
        setChallengeStep((value) => value + 1);
        setCapturePercent(0);
      } else {
        setSubjectStage("recognizing");
        const result = await checkFaceAccess({
          nfc_uid: faceChallenge.nfc_uid || "",
          challenge_id: faceChallenge.challenge_id,
          door_id: faceChallenge.door_id,
          direction: faceChallenge.direction,
          evidence: next,
        });
        setAccessResult(result);
        setCurrentSubject(result.subject || faceChallenge.user);
        setSubjectStage(result.decision === "allow" ? "granted" : "denied");
        setFaceChallenge(null);
        setChallengeEvidence([]);
        setChallengeStep(0);
        setCapturePercent(0);
        seenCardRef.current = "";
        await load();
      }
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setAccessResult({ decision: "deny", code: detail?.code || "face_check_failed", reason: detail?.message || detail || error?.message || "Проверка лица не пройдена." });
      setSubjectStage("denied");
      setFaceChallenge(null);
      setChallengeEvidence([]);
      setChallengeStep(0);
      setCapturePercent(0);
      seenCardRef.current = "";
      await load();
    } finally { setAccessBusy(false); }
  };
  const cancelFaceChallenge = () => {
    setFaceChallenge(null);
    setChallengeEvidence([]);
    setChallengeStep(0);
    setCapturePercent(0);
    seenCardRef.current = "";
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
          <VideoFeed onFrame={onCameraFrame} hidden={externalDisplayMode === "video"} />
          <div className="camera-frame__top"><span className="camera-tag"><Camera size={13} /> CAM–01</span><span className="camera-tag camera-tag--muted">ГЛАВНЫЙ ВХОД / КПП–01</span></div>
          <div className="camera-frame__corners"><i /><i /><i /><i /></div>
          <div className="camera-frame__bottom"><div className="subject-placeholder">{activeSubject?.photo_data_url ? <img className="subject-placeholder__photo" src={activeSubject.photo_data_url} alt="" /> : <div className="subject-placeholder__icon"><UserRoundSearch size={19} /></div>}<div><strong>{activeSubject?.name || (subjectStage === "card" ? "Карта считана" : "Ожидание субъекта")}</strong><span>{activeSubject ? (activeSubject.position || "Сотрудник · карточка активна") : "Ожидание лица перед камерой"}</span></div></div><span className="camera-frame__resolution">LIVE VIEW · LOCAL</span></div>
        </div>
        {faceChallenge && <section className="face-access-challenge">
          <span className="eyebrow">ДВУХФАКТОРНАЯ ПРОВЕРКА · {challengeStep + 1}/{faceChallenge.actions.length}</span>
          <h3>{faceChallenge.instructions[faceChallenge.actions[challengeStep]] || "Выполните действие перед камерой"}</h3>
          <p>Карта сотрудника: {faceChallenge.user.name}. Выполните действие, глядя в камеру.</p>
          {accessBusy && <div className="face-access-progress"><span>Сбор кадров · {capturePercent}%</span><i><b style={{width: capturePercent + "%"}}/></i></div>}
          <div className="face-access-actions"><button className="users-button" disabled={accessBusy} onClick={cancelFaceChallenge}>Отмена</button><button className="users-button users-button--primary" disabled={accessBusy} onClick={() => void captureFaceAction()}>{accessBusy ? "Анализ…" : "Выполнить действие"}</button></div>
        </section>}
        {accessResult && <div className={"face-access-result " + (accessResult.decision === "allow" ? "is-allowed" : "is-denied")} role="status"><strong>{accessResult.decision === "allow" ? "ЛИЧНОСТЬ ПОДТВЕРЖДЕНА · ДОСТУП РАЗРЕШЁН" : "ДОСТУП ЗАПРЕЩЁН"}</strong><span>{accessResult.reason}</span>{accessResult.similarity != null && <small>Сходство SFace: {accessResult.similarity}% · оценка модели, не вероятность личности</small>}</div>}
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
            <Factor icon={ScanFace} label="Распознавание лица" detail={"SFace 128D · " + registeredFaces + " активных шаблонов. Личность определяется автоматически, карта и PIN не требуются."} state={registeredFaces ? "ready" : "waiting"} />
            <Factor icon={LockKeyhole} label="PIN-код" detail="Второй фактор подтверждения" state="waiting" />
            <Factor icon={Fingerprint} label="Отпечаток пальца" detail="Временная программная заглушка" state="stub" />
          </div>
          <div className="verification-note"><ShieldCheck size={16} /><span>Решение о проходе должно приниматься backend после проверки политики доступа.</span></div>
        </section>

        <section className="surface-panel subject-panel">
          <div className="panel-heading panel-heading--compact"><div><span className="eyebrow">ТЕКУЩАЯ СЕССИЯ</span><h2>Карточка субъекта</h2></div><UserRoundSearch size={18} className="muted-icon" /></div>
          {activeSubject ? <div className={"subject-identified " + (faceChallenge || accessBusy ? "is-verifying" : "")}>{activeSubject.photo_data_url && <img src={activeSubject.photo_data_url} alt="Фото сотрудника"/>}<div><strong>{activeSubject.name}</strong><span>{activeSubject.position || "Должность не указана"}</span><small>ID · {activeSubject.id}</small></div></div> : <div className="subject-empty"><div className="subject-empty__icon"><ScanFace size={22} /></div><strong>{subjectStage === "card" ? "Поиск карточки…" : "Субъект не определён"}</strong><span>Распознавание показывает личность; NFC, PIN и отпечаток проверяются отдельно для решения о проходе.</span></div>}
          <div className="subject-meta"><span>СТАТУС ПРОВЕРКИ</span><b>{subjectStageLabel}</b></div>
        </section>

        <section className="surface-panel hardware-security-panel">
          <div className="panel-heading panel-heading--compact"><div><span className="eyebrow">ФИЗИЧЕСКИЙ КОНТУР</span><h2>Контроллер двери</h2></div><span className={"standby-pill " + (hardwareStatus?.authenticated ? "is-connected" : "")}>{hardwareStatus?.authenticated ? "AUTH OK" : "OFFLINE"}</span></div>
          <div className="hardware-state-row"><span>Канал Serial</span><b>{hardwareStatus?.serial_connected ? "ПОДКЛЮЧЁН" : "НЕТ СВЯЗИ"}</b></div>
          <div className="hardware-state-row"><span>Аутентификация AES-GCM</span><b>{hardwareStatus?.authenticated ? "ПОДТВЕРЖДЕНА" : "НЕ ПОДТВЕРЖДЕНА"}</b></div>
          <div className="hardware-state-row"><span>Замок</span><b>{hardwareStatus?.lock_state || "НЕИЗВЕСТНО"}</b></div>
          <div className="hardware-state-row"><span>Датчик двери</span><b>{hardwareStatus?.door_state || "НЕИЗВЕСТНО"}</b></div>
          {hardwareStatus?.alarm && <p className="hardware-alarm" role="alert">ТРЕВОГА · {hardwareStatus.alarm}</p>}
          <div className="hardware-state-row"><span>Цепочка аудита</span><b>{auditStatus?.valid ? "ЦЕЛОСТНОСТЬ ПОДТВЕРЖДЕНА" : "ПРОВЕРКА НЕ ПРОЙДЕНА"}</b></div>
          <div className="hardware-state-row"><span>Записей с HMAC</span><b>{auditStatus?.records ?? "—"}</b></div>
          <p className="hardware-security-note">{hardwareStatus?.configured ? "Ключ контроллера задан. Доступ разрешается только после подписанного ACK и подтверждения состояния замка." : "Контроллер не настроен. Проход остаётся закрытым до настройки отдельного CONTROLLER_HMAC_KEY и совместимой прошивки."}</p>
        </section>
      </aside>
    </div>
  </div>;
}
