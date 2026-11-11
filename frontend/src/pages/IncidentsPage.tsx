import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, BrainCircuit, Clock3, RefreshCw, ShieldAlert,
  Sparkles, ChevronDown, Fingerprint, Info,
} from "lucide-react";
import {
  analyzeSecurityIncidents, explainSecurityIncident, getLocalAIAssistantStatus,
  getSecurityIncidents, updateSecurityIncidentStatus, type SecurityIncident,
} from "../services/api";

function formatTime(value: string) {
  try { return new Date(value).toLocaleString("ru-RU"); } catch { return value; }
}
function severityLabel(value: SecurityIncident["severity"]) {
  return value === "critical" ? "Критический" : value === "high" ? "Высокий" : value === "medium" ? "Средний" : "Низкий";
}
function factorLabel(code: string) {
  const labels: Record<string, string> = {
    repeated_denials: "Повторные отказы",
    night_access: "Ночной проход",
    liveness_failures: "Ошибки liveness",
    controller_security_event: "Событие контроллера",
    rapid_multi_door: "Быстрые проходы через разные двери",
    ml_anomaly: "ML обнаружение аномалии",
  };
  return labels[code] || code;
}

export default function IncidentsPage({ canAnalyze = true }: { canAnalyze?: boolean }) {
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [assistant, setAssistant] = useState<{ enabled: boolean; available: boolean; model?: string; message?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [assistantBusy, setAssistantBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [items, assistantStatus] = await Promise.all([
        getSecurityIncidents(filter === "all" ? undefined : filter),
        getLocalAIAssistantStatus(),
      ]);
      setIncidents(items);
      setAssistant(assistantStatus);
    } catch {
      setError("Не удалось получить данные центра инцидентов. Проверьте соединение и права учётной записи.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError("");
    try {
      await analyzeSecurityIncidents();
      await load();
    } catch {
      setError("Анализ не выполнен. Проверьте журнал backend и доступность аналитического контура.");
    } finally {
      setAnalyzing(false);
    }
  };

  const changeStatus = async (incident: SecurityIncident, status: "resolved" | "dismissed") => {
    try {
      await updateSecurityIncidentStatus(incident.id, status);
      await load();
    } catch {
      setError("Не удалось изменить статус инцидента.");
    }
  };

  const askAssistant = async (incident: SecurityIncident) => {
    setAssistantBusy(incident.id);
    try {
      const result = await explainSecurityIncident(incident.id);
      setAnswers((current) => ({
        ...current,
        [incident.id]: result.status === "ok" ? (result.answer || "") : (result.message || "Локальный AI-помощник недоступен."),
      }));
    } catch {
      setAnswers((current) => ({ ...current, [incident.id]: "Не удалось получить объяснение от локального помощника." }));
    } finally {
      setAssistantBusy(null);
    }
  };

  return (
    <section className="content-section incident-center">
      <div className="page-heading">
        <div>
          <span className="eyebrow">INTELLIGENCE / SECURITY OPERATIONS</span>
          <h1>Центр инцидентов</h1>
          <p>Корреляция событий, объяснимая оценка риска и сигналы машинного обучения.</p>
        </div>
        {canAnalyze && <button className="incident-run-button" type="button" onClick={() => void runAnalysis()} disabled={analyzing}>
          <RefreshCw size={15} className={analyzing ? "incident-spin" : ""} />
          {analyzing ? "Анализ…" : "Запустить анализ"}
        </button>}
      </div>

      <div className="incident-intelligence-strip">
        <div><BrainCircuit size={17} /><span>ML ENGINE</span><b>{loading ? "ПРОВЕРКА" : "ISOLATION FOREST"}</b></div>
        <div><ShieldAlert size={17} /><span>RISK ENGINE</span><b>HEURISTIC / 0–100</b></div>
        <div><Sparkles size={17} /><span>LOCAL ASSISTANT</span><b className={assistant?.available ? "is-ready" : "is-muted"}>{assistant?.available ? assistant.model || "READY" : "DISABLED"}</b></div>
      </div>

      <div className="incident-toolbar">
        <div className="incident-filter-tabs">
          {(["open", "resolved", "dismissed", "all"] as const).map((value) => (
            <button type="button" key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>
              {value === "open" ? "Активные" : value === "resolved" ? "Обработанные" : value === "dismissed" ? "Отклонённые" : "Все"}
            </button>
          ))}
        </div>
        <button className="incident-refresh" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Обновить</button>
      </div>

      {error && <div className="incident-error" role="alert"><AlertTriangle size={16} />{error}</div>}
      {loading ? <div className="incident-empty"><Activity size={20} />Загрузка данных…</div> : incidents.length === 0 ? (
        <div className="incident-empty"><div className="incident-empty__icon"><ShieldAlert size={25} /></div><strong>Инциденты не обнаружены</strong><span>{filter === "open" ? "Запустите анализ, чтобы проверить последние события доступа." : "Для выбранного фильтра записей пока нет."}</span></div>
      ) : (
        <div className="incident-list">
          {incidents.map((incident) => {
            const isExpanded = expanded === incident.id;
            return <article className="incident-card" key={incident.id}>
              <div className="incident-card__main">
                <div className="incident-card__severity">
                  <span className={"incident-severity incident-severity--" + incident.severity}>{severityLabel(incident.severity)}</span>
                  <span className="incident-id">INC-{String(incident.id).padStart(5, "0")} · {incident.status === "open" ? "ОТКРЫТ" : incident.status === "resolved" ? "ОБРАБОТАН" : "ОТКЛОНЁН"}</span>
                </div>
                <div className="incident-card__heading">
                  <div><h2>{incident.title}</h2>{incident.evidence?.subject_label && <span className="incident-subject-label">{incident.evidence.subject_label}</span>}<p>{incident.summary}</p></div>
                  <div className="incident-risk"><strong>{incident.risk_score}</strong><span>RISK / 100</span></div>
                </div>
                <div className="incident-card__meta">
                  <span><Clock3 size={13} /> {formatTime(incident.last_seen)}</span>
                  <span><Fingerprint size={13} /> Событий: {incident.evidence?.event_ids?.length || 0}</span>
                  <span><Activity size={13} /> Повторений: {incident.occurrences}</span>
                </div>
                <div className="incident-card__actions">
                  <button type="button" onClick={() => setExpanded(isExpanded ? null : incident.id)}>{isExpanded ? "Скрыть детали" : "Детали и доказательства"} <ChevronDown size={14} className={isExpanded ? "is-rotated" : ""} /></button>
                  {incident.status === "open" && <><button type="button" onClick={() => void changeStatus(incident, "resolved")}>Отметить обработанным</button><button type="button" onClick={() => void changeStatus(incident, "dismissed")}>Отклонить</button></>}
                  <button type="button" className="incident-ai-action" disabled={assistantBusy === incident.id || !assistant?.available} onClick={() => void askAssistant(incident)}>
                    <Sparkles size={14} /> {assistantBusy === incident.id ? "Анализ…" : "Объяснить с помощью ИИ"}
                  </button>
                </div>
                {isExpanded && <div className="incident-evidence">
                  <div><span>ПЕРИОД</span><strong>{formatTime(incident.first_seen)} — {formatTime(incident.last_seen)}</strong></div>
                  <div><span>ДВЕРИ</span><strong>{incident.evidence?.doors?.join(", ") || "Не указаны"}</strong></div>
                  <div><span>СВЯЗАННЫЕ СОБЫТИЯ</span><strong>{incident.evidence?.event_ids?.join(", ") || "Нет списка"}</strong></div>
                  <div className="incident-factors"><span>ФАКТОРЫ РИСКА</span>{(incident.evidence?.factors || []).map((factor, index) => <div key={factor.code + index}><b>{factorLabel(factor.code)}</b><em>+{factor.points}</em>{factor.count ? <small>{factor.count} событий</small> : null}</div>)}</div>
                  <p><Info size={13} /> Оценка риска — эвристический индикатор, а не вероятность нарушения и не основание для автоматического отказа в доступе.</p>
                </div>}
                {answers[incident.id] && <div className="incident-ai-answer"><div><Sparkles size={14} /> ОТВЕТ ЛОКАЛЬНОГО AI-ПОМОЩНИКА</div><p>{answers[incident.id]}</p><small>Проверьте вывод по первичным событиям. Модель может ошибаться.</small></div>}
              </div>
            </article>;
          })}
        </div>
      )}
      <div className="incident-disclaimer"><Info size={14} /><span>ML и риск-оценка предназначены для поддержки оператора. Решение о проходе остаётся за политиками доступа LESS и подтверждением контроллера.</span></div>
    </section>
  );
}
