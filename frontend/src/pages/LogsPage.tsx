import { useEffect, useState, useCallback } from "react";
import { Download } from "lucide-react";
import { getLogs, AccessLog } from "../services/api";
import { downloadCsv } from "../services/notifications";
import { ru } from "../i18n/ru";

function fmt(iso?: string | null) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString("ru-RU"); } catch { return iso; }
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const load = useCallback(async () => {
    try { setLogs(await getLogs(100)); } catch { setLogs([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const exportLogs = () => downloadCsv("LESS-access-log.csv", logs, [
    { key: "id", label: "ID" }, { key: "created_at", label: "Дата" }, { key: "event_type", label: "Событие" },
    { key: "nfc_uid", label: "UID" }, { key: "factor_used", label: "Фактор" }, { key: "reason", label: "Причина" },
    { key: "direction", label: "Направление" }, { key: "door_id", label: "Точка прохода" },
  ]);
  return (
    <section className="space-y-3">
      <div className="flex justify-end"><button className="users-button" onClick={exportLogs}><Download size={15}/> Экспорт CSV</button></div>
      <div className="bg-surface-low rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="font-mono-label text-outline bg-[#0a0e16]"><tr><th className="text-left p-2">{ru.time}</th><th className="text-left p-2">{ru.event}</th><th className="text-left p-2">UID</th><th className="text-left p-2">{ru.reason}</th></tr></thead>
          <tbody>
            {logs.map((l) => <tr key={l.id} className="border-t border-surface-highest/20">
              <td className="p-2 font-mono text-xs text-primary">{fmt(l.created_at)}</td>
              <td className={`p-2 ${l.event_type === "granted" ? "text-secondary" : l.event_type === "simulated" ? "text-amber-300" : "text-error"}`}>{l.event_type === "simulated" ? "ТЕСТ · ВИРТУАЛЬНАЯ КАРТА" : l.event_type === "granted" ? "ДОСТУП РАЗРЕШЁН" : "ОТКАЗ"}</td>
              <td className="p-2 font-mono text-xs">{l.nfc_uid}</td><td className="p-2 text-xs text-[#bcc9cd] truncate max-w-xs">{l.reason}</td>
            </tr>)}
            {!logs.length && <tr><td colSpan={4} className="p-8 text-center text-outline">{ru.noEvents}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
