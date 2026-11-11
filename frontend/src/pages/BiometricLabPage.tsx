import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Fingerprint, Play, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import {
  createLivenessChallenge, getPadEvaluationReport, listUsers, recordPadTrial, verifyLiveness,
  type User,
} from "../services/api";

type TrialClass = "bona_fide" | "attack";
type Challenge = { challenge_id: string; actions: string[]; instructions: Record<string, string> };
type PadReport = Awaited<ReturnType<typeof getPadEvaluationReport>>;

const attackOptions = [
  ["printed_photo", "Печатная фотография"],
  ["screen_photo", "Фотография на экране"],
  ["screen_video", "Видео на экране"],
  ["replay", "Повтор ранее записанной последовательности"],
  ["partial_mask", "Частичное перекрытие лица"],
  ["other", "Другая атака предъявления"],
];

const actionLabels: Record<string, string> = {
  blink: "Моргание",
  turn_head: "Поворот головы",
  open_mouth: "Открыть рот",
  smile: "Улыбка",
};

export default function BiometricLabPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState("");
  const [trialClass, setTrialClass] = useState<TrialClass>("bona_fide");
  const [attackType, setAttackType] = useState("printed_photo");
  const [testCondition, setTestCondition] = useState("");
  const [cameraLabel, setCameraLabel] = useState("");
  const [consent, setConsent] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [evidence, setEvidence] = useState<{ action: string; frames: string[] }[]>([]);
  const [actionIndex, setActionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<PadReport | null>(null);

  useEffect(() => {
    void listUsers(true).then((items) => {
      const active = items.filter((item) => item.is_active === 1 && !item.deleted_at);
      setUsers(active);
      if (active.length) setUserId(String(active[0].id));
    }).catch(() => setError("Не удалось загрузить список сотрудников."));
    void refreshReport();
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => setError("Не удалось запустить видеопоток."));
    }
  }, [cameraReady]);

  const refreshReport = async () => {
    try { setReport(await getPadEvaluationReport()); }
    catch { setError("Не удалось получить отчёт PAD-испытаний."); }
  };

  const startCamera = async () => {
    setCameraBusy(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (e: any) {
      setError(e?.name === "NotAllowedError" ? "Разрешите доступ к камере в настройках приложения." : e?.name === "NotFoundError" ? "Камера не найдена." : "Не удалось открыть камеру.");
    } finally { setCameraBusy(false); }
  };

  const beginChallenge = async () => {
    if (!userId || !consent || !cameraReady || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await createLivenessChallenge(Number(userId), true, "pad_testing");
      setChallenge(next);
      setEvidence([]);
      setActionIndex(0);
      setProgress(0);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Не удалось создать PAD challenge.");
    } finally { setBusy(false); }
  };

  const captureFrames = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) throw new Error("Камера пока не готова.");
    const frames: string[] = [];
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось подготовить кадр камеры.");
    for (let index = 0; index < 12; index++) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.68));
      setProgress(Math.round(((index + 1) / 12) * 100));
      await wait(90);
    }
    return frames;
  };

  const captureAction = async () => {
    if (!challenge || busy) return;
    const action = challenge.actions[actionIndex];
    if (!action) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const frames = await captureFrames();
      const nextEvidence = [...evidence, { action, frames }];
      setEvidence(nextEvidence);
      if (actionIndex < challenge.actions.length - 1) {
        setActionIndex((current) => current + 1);
        setProgress(100);
        return;
      }

      let accepted = false;
      let failureReason = "";
      try {
        const result = await verifyLiveness({
          user_id: Number(userId),
          challenge_id: challenge.challenge_id,
          evidence: nextEvidence,
        });
        accepted = result.verified;
      } catch (e: any) {
        if (e?.response?.status !== 422) throw e;
        const detail = e?.response?.data?.detail;
        failureReason = typeof detail === "string" ? detail : String(detail?.code || detail?.message || "challenge_action_failed");
        const infrastructureFailures = new Set([
          "liveness_model_missing", "liveness_engine_unavailable",
          "insufficient_frames", "challenge_invalid", "challenge_expired",
          "challenge_sequence_mismatch",
        ]);
        if (infrastructureFailures.has(failureReason)) {
          throw new Error("Испытание не засчитано: техническая ошибка проверки (" + failureReason + "). Устраните её и повторите.");
        }
      }

      await recordPadTrial({
        trial_class: trialClass,
        attack_type: trialClass === "attack" ? attackType : "",
        accepted,
        failure_reason: failureReason,
        test_condition: testCondition,
        camera_label: cameraLabel,
      });
      setMessage(accepted
        ? "Система приняла предъявление как живого пользователя."
        : "Система отклонила предъявление.");
      setChallenge(null);
      setEvidence([]);
      await refreshReport();
    } catch (e: any) {
      setError(e?.message || e?.response?.data?.detail || "Не удалось завершить испытание.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const cancelChallenge = () => {
    setChallenge(null);
    setEvidence([]);
    setActionIndex(0);
    setProgress(0);
  };

  const currentUser = users.find((item) => String(item.id) === userId);
  const summary = report?.report;

  return (
    <section className="content-section pad-lab">
      <div className="page-heading">
        <div>
          <span className="eyebrow">BIOMETRIC LAB / PRESENTATION ATTACK DETECTION</span>
          <h1>Лаборатория liveness / PAD</h1>
          <p>Проводите контролируемые предъявления и собирайте метрики APCER/BPCER без сохранения кадров.</p>
        </div>
        <button className="incident-refresh" type="button" onClick={() => void refreshReport()}><RefreshCw size={14} /> Обновить отчёт</button>
      </div>

      <div className="pad-lab-grid">
        <div className="pad-lab-main">
          <div className="surface-panel pad-lab-camera">
            <div className="pad-lab-panel-head"><div><span className="eyebrow">TEST STATION / 01</span><h2>Станция испытания</h2></div><span className={cameraReady ? "pad-live is-ready" : "pad-live"}><i />{cameraReady ? "КАМЕРА ГОТОВА" : "КАМЕРА ОТКЛЮЧЕНА"}</span></div>
            <div className="pad-video-frame">
              <video ref={videoRef} muted autoPlay playsInline />
              {!cameraReady && <div className="pad-video-placeholder"><Camera size={30} /><strong>Камера не запущена</strong><span>Изображение используется только для текущего challenge и не сохраняется.</span></div>}
              <div className="pad-video-corners"><i /><i /><i /><i /></div>
              <div className="pad-video-tag">LOCAL CAPTURE · NO RECORDING</div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <div className="pad-lab-controls">
              <button type="button" className="incident-refresh" disabled={cameraBusy || cameraReady} onClick={() => void startCamera()}><Camera size={14} />{cameraBusy ? "Подключение…" : cameraReady ? "Камера подключена" : "Подключить камеру"}</button>
              {cameraReady && <button type="button" className="pad-stop-camera" onClick={() => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setCameraReady(false); cancelChallenge(); }}>Отключить камеру</button>}
            </div>
          </div>

          <div className="surface-panel pad-challenge-panel">
            <div className="pad-lab-panel-head"><div><span className="eyebrow">CHALLENGE RESPONSE</span><h2>Параметры испытания</h2></div><Fingerprint size={20} className="pad-muted-icon" /></div>
            <div className="pad-form-grid">
              <label>Тестовый субъект<select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!!challenge || busy}><option value="">Выберите сотрудника</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name || user.nfc_uid} · {user.position || "Без должности"}</option>)}</select></label>
              <label>Тип предъявления<select value={trialClass} onChange={(e) => setTrialClass(e.target.value as TrialClass)} disabled={!!challenge || busy}><option value="bona_fide">Живой пользователь (bona fide)</option><option value="attack">Атака предъявления (attack)</option></select></label>
              {trialClass === "attack" && <label className="pad-attack-select">Сценарий атаки<select value={attackType} onChange={(e) => setAttackType(e.target.value)} disabled={!!challenge || busy}>{attackOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              <label>Условия испытания<input value={testCondition} onChange={(e) => setTestCondition(e.target.value)} disabled={!!challenge || busy} placeholder="Освещение, расстояние, угол…" /></label>
              <label>Камера / устройство<input value={cameraLabel} onChange={(e) => setCameraLabel(e.target.value)} disabled={!!challenge || busy} placeholder="Модель камеры или веб-камера" /></label>
            </div>
            <label className="pad-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={!!challenge || busy} /><span>Подтверждено согласие субъекта на участие в биометрическом испытании и обработку кадров в рамках текущей проверки.</span></label>

            {!challenge ? <button type="button" className="incident-run-button pad-start-button" disabled={!cameraReady || !userId || !consent || busy} onClick={() => void beginChallenge()}><Play size={15} /> Начать испытание</button> : <div className="pad-active-challenge">
              <div className="pad-challenge-progress"><span>ШАГ {actionIndex + 1} / {challenge.actions.length}</span><strong>{actionLabels[challenge.actions[actionIndex]] || challenge.actions[actionIndex]}</strong></div>
              <p>{challenge.instructions[challenge.actions[actionIndex]] || "Выполните действие перед камерой."}</p>
              <div className="pad-progress-track"><i style={{ width: progress + "%" }} /></div>
              <div className="pad-challenge-actions"><button type="button" className="incident-run-button" disabled={busy} onClick={() => void captureAction()}><Camera size={14} />{busy ? "Сбор кадров…" : "Снять серию кадров"}</button><button type="button" className="pad-stop-camera" disabled={busy} onClick={cancelChallenge}>Отменить</button></div>
              <small>Для каждого действия собирается 12 кадров. Видеозапись и изображения не сохраняются.</small>
            </div>}

            {message && <div className="pad-result pad-result--success"><CheckCircle2 size={16} />{message}</div>}
            {error && <div className="pad-result pad-result--error"><AlertTriangle size={16} />{error}</div>}
          </div>
        </div>

        <aside className="pad-lab-side">
          <div className="surface-panel pad-metrics-card">
            <div className="pad-lab-panel-head"><div><span className="eyebrow">EVALUATION / DATASET</span><h2>Метрики испытаний</h2></div><ShieldCheck size={19} className="pad-muted-icon" /></div>
            {summary ? <div className="pad-metric-grid">
              <div><span>APCER</span><strong>{(summary.apcer * 100).toFixed(2)}%</strong><small>95% CI: {(summary.apcer_wilson_95[0] * 100).toFixed(2)}–{(summary.apcer_wilson_95[1] * 100).toFixed(2)}%</small></div>
              <div><span>BPCER</span><strong>{(summary.bpcer * 100).toFixed(2)}%</strong><small>95% CI: {(summary.bpcer_wilson_95[0] * 100).toFixed(2)}–{(summary.bpcer_wilson_95[1] * 100).toFixed(2)}%</small></div>
              <div><span>ACER</span><strong>{(summary.acer * 100).toFixed(2)}%</strong><small>Среднее APCER/BPCER</small></div>
              <div><span>TRIALS</span><strong>{summary.counts.total}</strong><small>{summary.counts.bona_fide} live · {summary.counts.attacks} attacks</small></div>
            </div> : <div className="pad-no-data"><XCircle size={20} /><strong>Недостаточно данных</strong><span>{report?.message || "Для расчёта нужны успешные и атакующие предъявления."}</span></div>}
            {summary && <div className="pad-attack-breakdown"><span>ПО ТИПАМ АТАК</span>{Object.entries(summary.attack_species).map(([type, item]) => <div key={type}><strong>{attackOptions.find(([value]) => value === type)?.[1] || type}</strong><b>{(item.apcer * 100).toFixed(1)}%</b><small>{item.false_accepts}/{item.presentations}</small></div>)}</div>}
            {summary && <div className="pad-attack-breakdown"><span>ПО УСЛОВИЯМ СЪЁМКИ</span>{Object.entries(summary.by_condition).map(([label, item]) => <div key={label}><strong>{label}</strong><b>{item.apcer === null ? "—" : (item.apcer * 100).toFixed(1) + "%"} / {item.bpcer === null ? "—" : (item.bpcer * 100).toFixed(1) + "%"}</b><small>{item.trials} тестов</small></div>)}</div>}
            {summary && <div className="pad-attack-breakdown"><span>ПО КАМЕРАМ</span>{Object.entries(summary.by_camera).map(([label, item]) => <div key={label}><strong>{label}</strong><b>{item.apcer === null ? "—" : (item.apcer * 100).toFixed(1) + "%"} / {item.bpcer === null ? "—" : (item.bpcer * 100).toFixed(1) + "%"}</b><small>{item.trials} тестов</small></div>)}</div>}
            {summary && <p className="pad-report-warning">{summary.warning}</p>}
          </div>
          <div className="pad-lab-note"><AlertTriangle size={15} /><span>PAD-метрики отражают только записанные испытания. Не используйте малую выборку как доказательство устойчивости или сертификации.</span></div>
          <div className="pad-lab-note"><Fingerprint size={15} /><span>Выбранный субъект: {currentUser?.name || currentUser?.nfc_uid || "не выбран"}. В таблицу испытаний идентификатор субъекта не записывается.</span></div>
        </aside>
      </div>
    </section>
  );
}
