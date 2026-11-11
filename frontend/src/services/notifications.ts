export type NoticeKind = "success" | "error" | "info";

export function notify(message: string, kind: NoticeKind = "success") {
  window.dispatchEvent(new CustomEvent("less:notify", { detail: { message, kind } }));
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; label: string }>,
) {
  try {
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const content = [
      columns.map((column) => escape(column.label)).join(";"),
      ...rows.map((row) => columns.map((column) => escape(row[column.key])).join(";")),
    ].join("\r\n");
    const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    notify(`Экспорт завершён: ${filename} · ${rows.length} записей`, "success");
  } catch {
    notify(`Не удалось экспортировать файл «${filename}».`, "error");
  }
}
