import { useEffect, useState, useCallback } from "react";
import { getLogs, AccessLog } from "../services/api";
import { ru } from "../i18n/ru";
import { History } from "lucide-react";

function fmt(iso?: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AccessLog[]>([]);

  const load = useCallback(async () => {
    try {
      setLogs(await getLogs(100));
    } catch {
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="bg-[#12161e] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2">
        <History className="w-4 h-4 text-primary" />
        <span className="font-display font-semibold text-sm">{ru.navLogs}</span>
      </div>
      <table className="w-full text-sm">
        <thead className="font-mono-label text-[#5c6570] bg-[#0a0d12]">
          <tr>
            <th className="text-left p-3">{ru.time}</th>
            <th className="text-left p-3">{ru.event}</th>
            <th className="text-left p-3">UID</th>
            <th className="text-left p-3">{ru.reason}</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr
              key={l.id}
              className="border-t border-white/[0.04] hover:bg-white/[0.02] transition"
            >
              <td className="p-3 font-mono text-xs text-primary">{fmt(l.created_at)}</td>
              <td
                className={`p-3 font-medium ${
                  l.event_type === "granted" ? "text-secondary" : "text-error"
                }`}
              >
                {l.event_type}
              </td>
              <td className="p-3 font-mono text-xs text-[#8b95a5]">{l.nfc_uid}</td>
              <td className="p-3 text-xs text-[#7a8494] truncate max-w-xs">{l.reason}</td>
            </tr>
          ))}
          {!logs.length && (
            <tr>
              <td colSpan={4} className="p-10 text-center text-[#5c6570]">
                {ru.noEvents}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
