export type NoticeKind = "success" | "error" | "info";
export function notify(message: string, kind: NoticeKind = "success") {
  window.dispatchEvent(new CustomEvent("less:notify", { detail: { message, kind } }));
}
export function downloadCsv<T extends object>(filename: string, rows: T[], columns: Array<{ key: keyof T; label: string }>) {
  try {
    const escape = (value: unknown) => { const text = value === null || value === undefined ? "" : String(value); return `"${text.replace(/"/g, '""')}"`; };
    const content = [columns.map(c => escape(c.label)).join(";"), ...rows.map(row => columns.map(c => escape(row[c.key])).join(";"))].join("\r\n");
    const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    notify(`Файл «${filename}» подготовлен · записей: ${rows.length}`, "success");
  } catch { notify(`Не удалось экспортировать файл «${filename}».`, "error"); }
}