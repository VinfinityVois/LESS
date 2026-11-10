type Status = "unknown" | "ok" | "error";

interface Props {
  status: Status;
}

export function StatusBadge({ status }: Props) {
  const map = {
    unknown: { text: "Проверка...", color: "bg-slate-700 text-slate-300" },
    ok: { text: "Backend Online", color: "bg-emerald-500/20 text-emerald-400" },
    error: { text: "Backend Offline", color: "bg-red-500/20 text-red-400" },
  };

  const { text, color } = map[status];

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${color}`}>
      {text}
    </span>
  );
}
