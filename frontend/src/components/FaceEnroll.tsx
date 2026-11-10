import { useEffect, useRef, useState } from "react";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import { faceEnroll } from "../services/api";
import { Camera, Check, CircleAlert, ScanFace, X, RotateCcw } from "lucide-react";

type Shot = { dataUrl: string; quality: number; label: string };
type Stage = "front" | "profile" | "review" | "saving" | "done" | "error";
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];

export default function FaceEnroll({ userId, userName, onDone, onCancel }: { userId: number; userName: string; onDone: () => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTime = useRef(-1);
  const [stage, setStage] = useState<Stage>("front");
  const [landmarks, setLandmarks] = useState<Array<{x:number;y:number}> | null>(null);
  const [faceFound, setFaceFound] = useState(false);
  const [yaw, setYaw] = useState(0);
  const [quality, setQuality] = useState(0);
  const [cameraError, setCameraError] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [shots, setShots] = useState<{front?: Shot; profile?: Shot}>({});
  const [result, setResult] = useState("");

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const [vision, stream] = await Promise.all([
          FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
        ]);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "GPU" },
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
              setLandmarks(face.map((p) => ({ x: p.x, y: p.y })));
              const eyeMid = (face[33].x + face[263].x) / 2;
              const noseOffset = (face[1].x - eyeMid) / Math.max(.01, Math.abs(face[263].x - face[33].x));
              const estimate = Math.max(-90, Math.min(90, noseOffset * 110));
              setYaw(estimate);
              setQuality(Math.round(Math.max(0, Math.min(100, 100 - Math.abs(estimate) * .45))));
            } else { setFaceFound(false); setLandmarks(null); setYaw(0); setQuality(0); }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e: any) {
        setCameraError(e?.message || "Не удалось запустить камеру или загрузить модель анализа лица.");
        setStage("error");
      }
    };
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
    const shot: Shot = { dataUrl: canvas.toDataURL("image/jpeg", .9), quality: score, label: stage === "front" ? "Анфас" : "Профиль" };
    if (stage === "front") { setShots((s) => ({ ...s, front: shot })); setStage("profile"); }
    else { setShots((s) => ({ ...s, profile: shot })); setStage("review"); }
  };

  const save = async () => {
    setStage("saving"); setResult("");
    try {
      // The current backend endpoint accepts a user ID only. It does not accept the captured
      // image payload, so the UI never claims these local preview frames were persisted.
      const response = await faceEnroll(userId);
      setResult(response?.message || "Backend подтвердил запрос регистрации биометрии.");
      setStage("done");
    } catch (e: any) { setResult(e?.response?.data?.detail || e?.message || "Backend не смог зарегистрировать биометрию."); setStage("error"); }
  };

  const expected = stage === "front" ? Math.abs(yaw) < 12 : Math.abs(yaw) > 18;
  const canCapture = modelReady && faceFound && expected;
  const outline = landmarks?.length ? FACE_OVAL.map((index) => landmarks[index]).filter(Boolean).map((p) => `${p.x*1000},${p.y*1000}`).join(" ") : "";
  const reset = () => { setShots({}); setStage("front"); setResult(""); };

  return <div className="face-modal-backdrop" role="dialog" aria-modal="true" aria-label="Регистрация биометрии">
    <div className="face-modal">
      <header className="face-modal-header"><div><span className="eyebrow">БИОМЕТРИЧЕСКАЯ РЕГИСТРАЦИЯ</span><h2>Сканирование лица</h2><p>{userName} · ID {userId}</p></div><button className="users-icon-button" onClick={onCancel} aria-label="Закрыть"><X size={18}/></button></header>
      {stage === "done" ? <div className="face-result"><span className="face-result-icon"><Check size={25}/></span><h3>Запрос обработан</h3><p>{result}</p><p className="face-disclaimer">Снимки анфас и профиля использовались для визуальной проверки в этом окне. Текущий API не принимает их на сервер; проверьте статус шаблона в карточке пользователя.</p><button className="users-button users-button--primary" onClick={onDone}>Готово</button></div> :
      stage === "error" ? <div className="face-result"><span className="face-result-icon is-error"><CircleAlert size={25}/></span><h3>Не удалось завершить сканирование</h3><p>{cameraError || result}</p><button className="users-button" onClick={reset}><RotateCcw size={14}/> Повторить</button><button className="users-button" onClick={onCancel}>Закрыть</button></div> :
      <><div className="face-stepper"><span className={stage === "front" ? "is-current" : shots.front ? "is-done" : ""}>01 · АНФАС</span><i/><span className={stage === "profile" ? "is-current" : shots.profile ? "is-done" : ""}>02 · ПРОФИЛЬ</span><i/><span className={stage === "review" || stage === "saving" ? "is-current" : ""}>03 · ПРОВЕРКА</span></div>
      {stage === "review" ? <div className="face-review"><div><span>АНФАС</span>{shots.front && <img src={shots.front.dataUrl} alt="Снимок анфас"/>}<b>Качество кадра: {shots.front?.quality}%</b></div><div><span>ПРОФИЛЬ</span>{shots.profile && <img src={shots.profile.dataUrl} alt="Снимок профиля"/>}<b>Качество кадра: {shots.profile?.quality}%</b></div><p>Оценка качества учитывает освещение и контраст. Она не подтверждает личность, liveness или пригодность биометрического шаблона.</p><button className="users-button" onClick={reset}><RotateCcw size={14}/> Переснять</button><button className="users-button users-button--primary" onClick={() => void save()}><ScanFace size={15}/> Отправить запрос backend</button></div> :
      <><div className="face-camera-stage"><video ref={videoRef} autoPlay playsInline muted/><svg className="face-landmark-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none"><defs><linearGradient id="faceStroke" x1="0" x2="1"><stop stopColor="#53d9cf"/><stop offset="1" stopColor="#a2f0d2"/></linearGradient></defs>{outline && <polyline points={outline} fill="none" stroke="url(#faceStroke)" strokeWidth="2.2" vectorEffect="non-scaling-stroke"/>}{landmarks?.map((p,i) => <circle key={i} cx={p.x*1000} cy={p.y*1000} r={i%7===0?3:1.4} fill="#73e7d9" opacity={i%7===0?.95:.55}/>)}<path d="M500 80V920 M80 500H920" stroke="#65d9d0" strokeOpacity=".25" strokeDasharray="5 9"/></svg><div className="face-camera-label"><Camera size={13}/> LIVE · LOCAL CAMERA</div><div className="face-target"><span>{stage === "front" ? "СМОТРИТЕ ПРЯМО В КАМЕРУ" : "ПОВЕРНИТЕ ГОЛОВУ ВПОЛБОРОТА"}</span></div></div>
      <div className="face-analysis-grid"><div><span>ОБНАРУЖЕНИЕ</span><b className={faceFound ? "is-good" : ""}>{faceFound ? "ЛИЦО НАЙДЕНО" : "ПОИСК ЛИЦА…"}</b></div><div><span>ПОЗА ГОЛОВЫ</span><b>{faceFound ? `${yaw > 0 ? "+" : ""}${yaw.toFixed(0)}°` : "—"}</b></div><div><span>СООТВЕТСТВИЕ ПОЗЕ</span><b>{faceFound ? `${quality}%` : "—"}</b></div><div><span>МОДЕЛЬ</span><b className={modelReady ? "is-good" : ""}>{modelReady ? "ГОТОВА" : "ЗАГРУЗКА…"}</b></div></div>
      <div className="face-guidance">{!modelReady ? "Загружается модель MediaPipe Face Landmarker…" : !faceFound ? "Расположите лицо в центре кадра и обеспечьте равномерное освещение." : !expected ? (stage === "front" ? "Для снимка анфас смотрите прямо в камеру." : "Для профильного кадра поверните голову в сторону примерно на 20–35°.") : "Положение подходит для контрольного снимка."}</div>
      <footer className="face-modal-footer"><button className="users-button" onClick={onCancel}>Отмена</button><button className="users-button users-button--primary" disabled={!canCapture} onClick={capture}><Camera size={15}/> Зафиксировать {stage === "front" ? "анфас" : "профиль"}</button></footer></>}
      {stage === "saving" && <div className="face-saving">Отправка запроса в backend…</div>}</>}
      <canvas ref={canvasRef} hidden/>
    </div>
  </div>;
}
