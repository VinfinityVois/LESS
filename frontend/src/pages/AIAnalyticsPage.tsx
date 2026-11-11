import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BrainCircuit, RefreshCw, ShieldCheck, Users, Fingerprint } from "lucide-react";
import { analyzeSecurityIncidents, getLogs, getSecurityIncidents, getPadEvaluationReport, type AccessLog, type SecurityIncident } from "../services/api";

type PadReport = Awaited<ReturnType<typeof getPadEvaluationReport>>;
function pct(value: number) { return (value * 100).toFixed(1) + "%"; }
function time(value: string) { try { return new Date(value).toLocaleString("ru-RU"); } catch { return value; } }

export default function AIAnalyticsPage() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [pad, setPad] = useState<PadReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [events, cases, padReport] = await Promise.all([getLogs(5000), getSecurityIncidents("open"), getPadEvaluationReport()]);
      setLogs(events); setIncidents(cases); setPad(padReport); setUpdatedAt(new Date().toISOString());
    } catch { setError("Не удалось загрузить аналитику. Проверьте соединение с backend и права доступа."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const baseline = useMemo(() => {
    const denied = logs.filter(x => x.event_type === "denied");
    const granted = logs.filter(x => x.event_type === "granted");
    const subjects = new Set(logs.map(x => x.user_id ? "user:" + x.user_id : x.nfc_uid ? "card:" + x.nfc_uid : "").filter(Boolean));
    const repeated = new Map<string, number>();
    denied.forEach(x => { const key = x.user_id ? "user:" + x.user_id : x.nfc_uid ? "card:" + x.nfc_uid : ""; if (key) repeated.set(key, (repeated.get(key) || 0) + 1); });
    return { denied: denied.length, granted: granted.length, subjects: subjects.size, repeated: [...repeated.values()].filter(x => x >= 3).length, denialRate: logs.length ? denied.length / logs.length : 0 };
  }, [logs]);

  const run = async () => {
    setRunning(true); setError("");
    try { await analyzeSecurityIncidents(); await load(); }
    catch { setError("ИИ-анализ не завершился. Проверьте журнал backend."); }
    finally { setRunning(false); }
  };

  const mlIncidents = incidents.filter(x => x.evidence?.factors?.some(f => f.code === "ml_anomaly"));
  const padSummary = pad?.report;
  const signals = incidents.flatMap(x => x.evidence?.factors || []);
  const signalCounts = new Map<string, number>();
  signals.forEach(x => signalCounts.set(x.code, (signalCounts.get(x.code) || 0) + (x.count || 1)));

  return <section className="content-section incident-center">
    <div className="page-heading"><div><span className="eyebrow">LESS INTELLIGENCE / DECISION SUPPORT</span><h1>ИИ-аналитика</h1><p>Сравнение базового контроля и анализа с корреляцией событий и ML-сигналами.</p></div>
      <button className="incident-run-button" type="button" onClick={() => void run()} disabled={running || loading}><RefreshCw size={15} className={running ? "incident-spin" : ""}/>{running ? "Анализ…" : "Запустить ИИ-анализ"}</button>
    </div>
    {error && <div className="incident-error" role="alert"><AlertTriangle size={16}/>{error}</div>}
    <div className="incident-intelligence-strip">
      <div><Activity size={17}/><span>EVENT BASELINE</span><b>{logs.length} СОБЫТИЙ</b></div>
      <div><BrainCircuit size={17}/><span>ML / CORRELATION</span><b>{incidents.length} АКТИВНЫХ СИГНАЛОВ</b></div>
      <div><ShieldCheck size={17}/><span>PAD EVALUATION</span><b>{padSummary ? "МЕТРИКИ ДОСТУПНЫ" : "НЕДОСТАТОЧНО ДАННЫХ"}</b></div>
    </div>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {[{label:"СОБЫТИЯ В ЖУРНАЛЕ",value:baseline.granted+baseline.denied,sub:"Исходная выборка"},{label:"ОТКАЗЫ",value:baseline.denied,sub:"Правила и фактические решения"},{label:"СУБЪЕКТЫ",value:baseline.subjects,sub:"Сотрудники / карты с историей"},{label:"ПОВТОРНЫЕ ОТКАЗЫ",value:baseline.repeated,sub:"Субъекты с 3+ отказами"}].map(x=><div className="surface-panel p-4" key={x.label}><span className="eyebrow">{x.label}</span><strong className="block text-3xl mt-2">{loading ? "—" : x.value}</strong><small className="text-outline">{x.sub}</small></div>)}
    </div>
    <div className="grid xl:grid-cols-2 gap-3">
      <article className="surface-panel p-5"><span className="eyebrow">01 / ДО ИИ · БАЗОВЫЙ КОНТРОЛЬ</span><h2 className="text-lg font-semibold mt-2">Что видит обычный журнал</h2><p className="text-sm text-outline mt-2">Фиксирует отдельные решения СКУД: разрешён проход или отказ, время, метод и точка доступа. Сам по себе журнал не связывает разрозненные события в поведенческий сценарий.</p><div className="mt-4 grid grid-cols-2 gap-3"><div><small className="text-outline">Доля отказов</small><strong className="block text-2xl">{loading ? "—" : pct(baseline.denialRate)}</strong></div><div><small className="text-outline">Разрешено</small><strong className="block text-2xl">{baseline.granted}</strong></div></div></article>
      <article className="surface-panel p-5"><span className="eyebrow">02 / ПОСЛЕ ИИ · АНАЛИТИКА</span><h2 className="text-lg font-semibold mt-2">Что добавляет интеллектуальный слой</h2><p className="text-sm text-outline mt-2">Корреляция объединяет повторные отказы, ночные события, ошибки liveness, тревоги контроллера и ML-отклонения в объяснимые инциденты с перечнем факторов и исходных event ID.</p><div className="mt-4 grid grid-cols-2 gap-3"><div><small className="text-outline">Активные инциденты</small><strong className="block text-2xl">{incidents.length}</strong></div><div><small className="text-outline">С ML-сигналом</small><strong className="block text-2xl">{mlIncidents.length}</strong></div></div></article>
    </div>
    <article className="surface-panel p-5"><div className="flex items-center gap-2"><Fingerprint size={17}/><h2 className="font-semibold">Проверка «живой человек / атака предъявления»</h2></div>
      {padSummary ? <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">{[{label:"APCER",value:pct(padSummary.apcer),sub:"Доля принятых атак"},{label:"BPCER",value:pct(padSummary.bpcer),sub:"Доля отклонённых живых"},{label:"ACER",value:pct(padSummary.acer),sub:"Средняя ошибка"},{label:"Испытания",value:padSummary.counts.total,sub:padSummary.counts.bona_fide+" live / "+padSummary.counts.attacks+" attacks"}].map(x=><div key={x.label}><span className="eyebrow">{x.label}</span><strong className="block text-2xl mt-1">{x.value}</strong><small className="text-outline">{x.sub}</small></div>)}</div> : <p className="text-sm text-outline mt-3">{pad?.message || "Метрики появятся после фактических испытаний живых пользователей и атакующих предъявлений."}</p>}
      <p className="text-xs text-outline mt-4">Проверка основана на challenge-response и зарегистрированных результатах. Один только факт обнаружения лица не доказывает присутствие живого человека. Для достоверной оценки нужны реальные испытания фотографиями, экраном, видеоповтором и другими сценариями.</p>
    </article>
    <article className="surface-panel p-5"><div className="flex items-center gap-2"><Users size={17}/><h2 className="font-semibold">Анализ активности субъектов</h2></div><p className="text-sm text-outline mt-2">Система может выявлять отклонения в шаблоне использования пропуска: необычное время, частые отказы, смену точек прохода и методов подтверждения. Это анализ событий доступа, а не оценка характера, эмоций, намерений или личности человека.</p>
      {signalCounts.size ? <div className="mt-4 space-y-2">{[...signalCounts.entries()].map(([key,count])=><div className="flex justify-between gap-3 text-sm border-b border-surface-highest/40 pb-2" key={key}><span>{({repeated_denials:"Повторные отказы",night_access:"Ночной доступ",liveness_failures:"Ошибки liveness",controller_security_event:"Событие контроллера",rapid_multi_door:"Быстрые проходы между дверями",ml_anomaly:"ML-отклонение"} as Record<string,string>)[key] || key}</span><b>{count}</b></div>)}</div> : <p className="text-sm text-outline mt-3">После запуска анализа здесь появятся обнаруженные факторы.</p>}
    </article>
    <div className="flex justify-between flex-wrap gap-2 text-xs text-outline"><span>{updatedAt ? "Данные обновлены: "+time(updatedAt) : "Данные ещё не загружены"}</span><span>ИИ — инструмент поддержки оператора, не автоматическое решение о допуске.</span></div>
  </section>;
}
