import { useEffect, useRef, useState } from "react";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import { createLivenessChallenge, faceEnroll, getUser, verifyLiveness } from "../services/api";
import { Camera, Check, CircleAlert, ScanFace, X, RotateCcw } from "lucide-react";

type Shot = { dataUrl: string; quality: number; label: string; landmarks: number[][] };
type Stage = "liveness" | "front" | "profile" | "review" | "saving" | "done" | "error";
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];

export default function FaceEnroll({ userId, userName, onDone, onCancel }: { userId: number; userName: string; onDone: () => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTime = useRef(-1);
  const [stage, setStage] = useState<Stage>("liveness");
  const [challenge, setChallenge] = useState<{challenge_id:string;actions:string[];instructions:Record<string,string>} | null>(null);
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [challengeEvidence, setChallengeEvidence] = useState<{action:string;frames:string[]}[]>([]);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [livenessProof, setLivenessProof] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [landmarks, setLandmarks] = useState<Array<{x:number;y:number;z:number}> | null>(null);
  const [faceFound, setFaceFound] = useState(false);
  const [yaw, setYaw] = useState(0);
  const [quality, setQuality] = useState(0);
  const [expression, setExpression] = useState("ОЖИДАНИЕ");
  const [cameraError, setCameraError] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [shots, setShots] = useState<{front?: Shot; profile?: Shot}>({});
  const [result, setResult] = useState("");

  useEffect(() => {
    let cancelled = false;
    let cameraPaused = false;
    const cameraChannel = new BroadcastChannel("less-camera-control");
    const start = async () => {
      try {
        const subject = await getUser(userId);
        if (cancelled) return;
        if (!subject || !subject.is_active || subject.deleted_at) {
          setCameraError("Сотрудник не найден или отключён. Сначала создайте активную карточку сотрудника и повторите регистрацию биометрии.");
          setStage("error");
          return;
        }
        // Release the shared OpenCV/WebSocket camera only after the subject is confirmed.
        cameraChannel.postMessage({ type: "pause-camera" });
        cameraPaused = true;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        if (cancelled) return;
        const [vision, stream] = await Promise.all([
          FilesetResolver.forVisionTasks("/mediapipe/wasm"),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
        ]);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "CPU" },
          runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
        });
        if (cancelled) { landmarker.close(); return; }
        landmarkerRef.current = landmarker;
        setModelReady(true);
        const tick = () => {
          const video = videoRef.current;
          if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime.current) {
            lastVideoTime.current = video.currentTime;
            const output = landmarker.detectForVideo(video, performance.now());
            const face = output.faceLandmarks?.[0];
            if (face?.length) {
              setFaceFound(true);
              setLandmarks(face.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })));
              const blend = output.faceBlendshapes?.[0]?.categories || [];
              const scoreOf = (name: string) => blend.find((item) => item.categoryName === name)?.score || 0;
              const smile = (scoreOf("mouthSmileLeft") + scoreOf("mouthSmileRight")) / 2;
              const blink = (scoreOf("eyeBlinkLeft") + scoreOf("eyeBlinkRight")) / 2;
              const jaw = scoreOf("jawOpen");
              setExpression(smile > .4 ? "УЛЫБКА" : blink > .5 ? "МОРГАНИЕ" : jaw > .35 ? "РОТ ОТКРЫТ" : "НЕЙТРАЛЬНО");
              const eyeMid = (face[33].x + face[263].x) / 2;
              const noseOffset = (face[1].x - eyeMid) / Math.max(.01, Math.abs(face[263].x - face[33].x));
              const estimate = Math.max(-90, Math.min(90, noseOffset * 110));
              setYaw(estimate);
              setQuality(Math.round(Math.max(0, Math.min(100, 100 - Math.abs(estimate) * .45))));
            } else { setFaceFound(false); setLandmarks(null); setYaw(0); setQuality(0); setExpression("ЛИЦО НЕ НАЙДЕНО"); }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e: any) {
        if (cameraPaused && !cancelled) {
          cameraChannel.postMessage({ type: "resume-camera" });
          cameraPaused = false;
        }
        if (cancelled) return;
        setCameraError(e?.response?.data?.detail || (e?.name === "NotAllowedError" ? "Доступ к камере запрещён. Разрешите камеру для LESS в настройках Windows и приложения." : e?.name === "NotFoundError" ? "Камера не найдена. Подключите камеру и повторите попытку." : e?.name === "NotReadableError" ? "Камера занята другим приложением. Закройте его и повторите попытку." : e?.message || "Не удалось запустить камеру или загрузить модель анализа лица."));
        setStage("error");
      }
    };
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (cameraPaused) cameraChannel.postMessage({ type: "resume-camera" });
      cameraChannel.close();
    };
  }, [cameraAttempt]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => setCameraError("Не удалось возобновить видеопоток камеры."));
    }
  }, [stage, modelReady]);

  const capture = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || !faceFound) return;
    const width = video.videoWidth, height = video.videoHeight;
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, width, height); ctx.restore();
    const data = ctx.getImageData(0, 0, width, height).data;
    let sum = 0, sumSq = 0, count = 0;
    for (let i = 0; i < data.length; i += 16) { const l = (data[i] + data[i+1] + data[i+2]) / 3; sum += l; sumSq += l*l; count++; }
    const mean = sum / count, deviation = Math.sqrt(Math.max(0, sumSq / count - mean*mean));
    const lightScore = mean > 55 && mean < 210 ? 100 : Math.max(15, 100 - Math.abs(mean - 130));
    const contrastScore = Math.min(100, deviation * 1.8);
    const score = Math.round(lightScore * .65 + contrastScore * .35);
    const eyeDistance = Math.max(.001, Math.hypot(landmarks![33].x - landmarks![263].x, landmarks![33].y - landmarks![263].y));
    const origin = landmarks![1];
    const template = landmarks!.map((point) => [
      Number(((point.x - origin.x) / eyeDistance).toFixed(5)),
      Number(((point.y - origin.y) / eyeDistance).toFixed(5)),
      Number((((point.z ?? 0) - (origin.z ?? 0)) / eyeDistance).toFixed(5)),
    ]);
    const shot: Shot = { dataUrl: canvas.toDataURL("image/jpeg", .9), quality: score, label: stage === "front" ? "Анфас" : "Профиль", landmarks: template };
    if (stage === "front") { setShots((s) => ({ ...s, front: shot })); setStage("profile"); }
    else { setShots((s) => ({ ...s, profile: shot })); setStage("review"); }
  };

  const save = async () => {
    setStage("saving"); setResult("");
    try {
      const response = await faceEnroll(userId, {
        front_landmarks: shots.front!.landmarks,
        profile_landmarks: shots.profile!.landmarks,
        front_photo: shots.front!.dataUrl,
        profile_photo: shots.profile!.dataUrl,
        liveness_proof: livenessProof,
      });
      const matches = response?.duplicate_candidates || [];
      const matchText = matches.length
        ? " Возможные совпадения: " + matches.map((item: { name: string; similarity: number }) => item.name + " (" + item.similarity + "%)").join(", ") + ". Проверьте вручную."
        : " Похожих зарегистрированных шаблонов не найдено.";
      setResult((response?.message || "Биометрический профиль сохранён.") + matchText);
      setStage("done");
    } catch (e: any) { setResult(e?.response?.data?.detail || e?.message || "Backend не смог зарегистрировать биометрию."); setStage("error"); }
  };


  const restartLiveness = async () => {
    setChallengeBusy(false);
    setCameraError("");
    setChallengeEvidence([]);
    setChallengeIndex(0);
    setChallenge(null);
    setLivenessProof("");
    setShots({});
    setResult("");
    try {
      if (consentConfirmed) {
        const next = await createLivenessChallenge(userId, true);
        setChallenge(next);
      }
      setStage("liveness");
    } catch (e: any) {
      setCameraError(e?.response?.data?.detail || "Не удалось получить новый liveness challenge.");
      setStage("error");
    }
  };

  const beginLiveness = async () => {
    if (!consentConfirmed || challengeBusy) return;
    setChallengeBusy(true);
    try {
      const next = await createLivenessChallenge(userId, true);
      setChallenge(next);
      setChallengeEvidence([]);
      setChallengeIndex(0);
    } catch (e: any) {
      setCameraError(e?.response?.data?.detail || "Не удалось начать проверку присутствия.");
      setStage("error");
    } finally { setChallengeBusy(false); }
  };

  const captureChallengeAction = async () => {
    if (!challenge || challengeBusy || !videoRef.current) return;
    const action = challenge.actions[challengeIndex];
    if (!action) return;
    setChallengeBusy(true);
    setCameraError("");
    try {
      const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const frames: string[] = [];
      // Capture a longer sequence so short actions (especially a blink) are
      // represented by multiple frames rather than missed between samples.
      await wait(200);
      for (let i = 0; i < 8; i++) {
        const video = videoRef.current;
        if (!video || video.readyState < 2) throw new Error("Камера пока не готова. Попробуйте ещё раз.");
        const frameCanvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / video.videoWidth);
        frameCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        frameCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = frameCanvas.getContext("2d");
        if (!ctx) throw new Error("Не удалось подготовить кадр камеры.");
        ctx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
        frames.push(frameCanvas.toDataURL("image/jpeg", 0.68));
        await wait(140);
      }
      const nextEvidence = [...challengeEvidence, { action, frames }];
      setChallengeEvidence(nextEvidence);
      if (challengeIndex + 1 < challenge.actions.length) {
        setChallengeIndex((value) => value + 1);
      } else {
        const verified = await verifyLiveness({ user_id: userId, challenge_id: challenge.challenge_id, evidence: nextEvidence });
        setLivenessProof(verified.proof_token);
        setResult(verified.warning);
        setStage("front");
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const diagnostic = typeof detail === "string"
        ? detail
        : detail?.failed_action
          ? `${detail.message || "Проверка действия не пройдена."} Действие: ${detail.failed_action}. Измеренный сигнал: ${detail.signal_delta ?? "нет данных"}. Повторите движение плавнее, удерживая лицо в кадре.`
          : detail?.message || e?.message;
      setCameraError(String(diagnostic || "Проверка присутствия не пройдена."));
      setStage("error");
    } finally {
      setChallengeBusy(false);
    }
  };

  const expected = stage === "front" ? Math.abs(yaw) < 12 : Math.abs(yaw) > 18;
  const canCapture = modelReady && faceFound && expected && (stage === "front" || stage === "profile");
  const outline = landmarks?.length ? FACE_OVAL.map((index) => landmarks[index]).filter((p): p is {x:number;y:number;z:number} => p !== undefined).map((p) => `${p.x*1000},${p.y*1000}`).join(" ") : "";
  const shotsAcceptable = (shots.front?.quality ?? 0) >= 55 && (shots.profile?.quality ?? 0) >= 55;
  const reset = () => { void restartLiveness(); };
  const retryCamera = () => {
    setCameraError("");
    setModelReady(false);
    setFaceFound(false);
    setStage("liveness");
    setCameraAttempt((value) => value + 1);
  };

  return <div className="face-modal-backdrop" role="dialog" aria-modal="true" aria-label="Регистрация биометрии">
    <div className="face-modal">
      <header className="face-modal-header"><div><span className="eyebrow">БИОМЕТРИЧЕСКАЯ РЕГИСТРАЦИЯ</span><h2>Сканирование лица</h2><p>{userName} · ID {userId}</p></div><button className="users-icon-button" onClick={onCancel} aria-label="Закрыть"><X size={18}/></button></header>
      {stage === "done" ? <div className="face-result"><span className="face-result-icon"><Check size={25}/></span><h3>Запрос обработан</h3><p>{result}</p><p className="face-disclaimer">Снимки анфас и в профиль, а также геометрические шаблоны сохранены в зашифрованном виде. Процент сходства — только предварительное сравнение формы контрольных точек, а не вероятность совпадения личности.</p><button className="users-button users-button--primary" onClick={() => { window.dispatchEvent(new Event("less:users-refresh")); onDone(); }}>Готово</button></div> :
      stage === "error" ? <div className="face-result"><span className="face-result-icon is-error"><CircleAlert size={25}/></span><h3>Не удалось завершить сканирование</h3><p>{cameraError || result}</p><button className="users-button" onClick={() => modelReady ? reset() : retryCamera()}><RotateCcw size={14}/> {modelReady ? "Повторить проверку" : "Повторить подключение камеры"}</button><button className="users-button" onClick={onCancel}>Закрыть</button></div> :
      <><div className="face-stepper"><span className={stage === "front" ? "is-current" : shots.front ? "is-done" : ""}>01 · АНФАС</span><i/><span className={stage === "profile" ? "is-current" : shots.profile ? "is-done" : ""}>02 · ПРОФИЛЬ</span><i/><span className={stage === "review" || stage === "saving" ? "is-current" : ""}>03 · ПРОВЕРКА</span></div>
      {stage === "review" || stage === "saving" ? <div className="face-review"><div><span>АНФАС</span>{shots.front && <img src={shots.front.dataUrl} alt="Снимок анфас"/>}<b>Качество кадра: {shots.front?.quality}%</b></div><div><span>ПРОФИЛЬ</span>{shots.profile && <img src={shots.profile.dataUrl} alt="Снимок профиля"/>}<b>Качество кадра: {shots.profile?.quality}%</b></div><p>{shotsAcceptable ? "Оба кадра прошли базовую проверку освещения и контраста. Это предварительный контроль качества, а не сертификация биометрии или liveness." : "Качество одного из кадров низкое. Переснимите анфас и профиль при более ровном освещении."}</p><button className="users-button" disabled={stage === "saving"} onClick={reset}><RotateCcw size={14}/> Переснять</button><button className="users-button users-button--primary" disabled={!shotsAcceptable || stage === "saving"} onClick={() => void save()}><ScanFace size={15}/> Сохранить биометрию</button></div> :
      stage === "liveness" ? <><div className="face-camera-stage"><video ref={videoRef} autoPlay playsInline muted/><svg className="face-landmark-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><linearGradient id="faceStroke" x1="0" x2="1"><stop stopColor="#53d9cf"/><stop offset="1" stopColor="#a2f0d2"/></linearGradient></defs>{outline && <polyline points={outline} fill="none" stroke="url(#faceStroke)" strokeWidth="2.2" vectorEffect="non-scaling-stroke"/>}{landmarks?.map((p,i) => <circle key={i} cx={p.x*1000} cy={p.y*1000} r={i%7===0?3:1.4} fill="#73e7d9" opacity={i%7===0?.95:.55}/>)}</svg><div className="face-camera-label"><Camera size={13}/> LIVE · SERVER CHALLENGE</div><div className="face-target"><span>ПРОВЕРКА ЖИВОГО ПРИСУТСТВИЯ</span></div></div><div className="liveness-card">{!challenge ? <><span className="eyebrow">СОГЛАСИЕ НА ОБРАБОТКУ БИОМЕТРИИ</span><h3>Подтверждение согласия</h3><p>Перед продолжением убедитесь, что сотрудник уведомлён о сборе и хранении биометрических данных и дал согласие на эту процедуру.</p><label className="liveness-consent"><input type="checkbox" checked={consentConfirmed} onChange={(e)=>setConsentConfirmed(e.target.checked)}/> Я подтверждаю, что субъект перед камерой дал согласие на обработку биометрических данных</label><button className="users-button users-button--primary" disabled={!consentConfirmed || !modelReady || !faceFound || challengeBusy} onClick={()=>void beginLiveness()}>{challengeBusy ? "Подготовка…" : "Подтвердить согласие и начать"}</button></> : <><span className="eyebrow">СЛУЧАЙНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ · {challengeIndex+1}/{challenge.actions.length}</span><h3>{challenge.instructions[challenge.actions[challengeIndex]] || "Подготовка проверки…"}</h3><p>После нажатия камера соберёт короткую последовательность кадров. Сервер независимо проверит изменения контрольных точек. Кадры используются только для проверки и не сохраняются.</p><div className="liveness-progress">{challenge.actions.map((action,index)=><i key={action} className={index < challengeIndex ? "is-done" : index === challengeIndex ? "is-current" : ""}/>)}</div><button className="users-button users-button--primary" disabled={!modelReady || !faceFound || challengeBusy} onClick={() => void captureChallengeAction()}>{challengeBusy ? "Анализ последовательности…" : "Выполнить действие"}</button></>}<span className="liveness-status">{!modelReady ? "Загрузка модели…" : !faceFound ? "Расположите лицо перед камерой" : "Лицо обнаружено · можно начинать"}</span><small className="liveness-permission-note">Разрешение камеры сохраняется настройками Windows / WebView. Выберите «Разрешить» для LESS; приложение не может обойти системный запрет.</small></div></> :
            <><div className="face-camera-stage"><video ref={videoRef} autoPlay playsInline muted/><svg className="face-landmark-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><linearGradient id="faceStroke" x1="0" x2="1"><stop stopColor="#53d9cf"/><stop offset="1" stopColor="#a2f0d2"/></linearGradient></defs>{outline && <polyline points={outline} fill="none" stroke="url(#faceStroke)" strokeWidth="2.2" vectorEffect="non-scaling-stroke"/>}{landmarks?.map((p,i) => <circle key={i} cx={p.x*1000} cy={p.y*1000} r={i%7===0?3:1.4} fill="#73e7d9" opacity={i%7===0?.95:.55}/>)}<path d="M500 80V920 M80 500H920" stroke="#65d9d0" strokeOpacity=".25" strokeDasharray="5 9"/></svg><div className="face-camera-label"><Camera size={13}/> LIVE · LOCAL CAMERA</div><div className="face-target"><span>{stage === "front" ? "СМОТРИТЕ ПРЯМО В КАМЕРУ" : "ПОВЕРНИТЕ ГОЛОВУ ВПОЛБОРОТА"}</span></div></div>
      <div className="face-analysis-grid"><div><span>ОБНАРУЖЕНИЕ</span><b className={faceFound ? "is-good" : ""}>{faceFound ? "ЛИЦО НАЙДЕНО" : "ПОИСК ЛИЦА…"}</b></div><div><span>ПОЗА ГОЛОВЫ</span><b>{faceFound ? `${yaw > 0 ? "+" : ""}${yaw.toFixed(0)}°` : "—"}</b></div><div><span>СООТВЕТСТВИЕ ПОЗЕ</span><b>{faceFound ? `${quality}%` : "—"}</b></div><div><span>МИМИКА</span><b>{expression}</b></div></div>
      <div className="face-guidance">{!modelReady ? "Загружается модель MediaPipe Face Landmarker…" : !faceFound ? "Расположите лицо в центре кадра и обеспечьте равномерное освещение." : !expected ? (stage === "front" ? "Для снимка анфас смотрите прямо в камеру." : "Для профильного кадра поверните голову в сторону примерно на 20–35°.") : "Положение подходит для контрольного снимка."}</div>
      <footer className="face-modal-footer"><button className="users-button" onClick={onCancel}>Отмена</button><button className="users-button users-button--primary" disabled={!canCapture} onClick={capture}><Camera size={15}/> Зафиксировать {stage === "front" ? "анфас" : "профиль"}</button></footer></>}
      {stage === "saving" && <div className="face-saving">Отправка запроса в backend…</div>}</>}
      <canvas ref={canvasRef} hidden/>
    </div>
  </div>;
}
