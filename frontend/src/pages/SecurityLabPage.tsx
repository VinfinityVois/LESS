import { useMemo, useState } from "react";
import { Download, Search, ShieldCheck, FlaskConical } from "lucide-react";
import { SECURITY_TEST_DATASET } from "../data/securityTestDataset";
import { downloadCsv } from "../services/notifications";

const severityLabel = { critical: "КРИТИЧЕСКИЙ", high: "ВЫСОКИЙ", medium: "СРЕДНИЙ", low: "НИЗКИЙ" };
const methodLabel = { "white-box": "WHITE-BOX", "gray-box": "GRAY-BOX", "black-box": "BLACK-BOX" };

export default function SecurityLabPage() {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [method, setMethod] = useState("all");
  const filtered = useMemo(() => SECURITY_TEST_DATASET.filter((item) => {
    const q = search.trim().toLocaleLowerCase("ru");
    const matches = !q || [item.id, item.domain, item.group, item.scenario, item.testInput, item.expected].some((v) => v.toLocaleLowerCase("ru").includes(q));
    return matches && (severity === "all" || item.severity === severity) && (method === "all" || item.method === method);
  }), [search, severity, method]);
  const exportCases = () => downloadCsv("LESS-security-test-cases.csv", filtered, [
    { key: "id", label: "ID" }, { key: "domain", label: "Область" }, { key: "method", label: "Метод" },
    { key: "scenario", label: "Сценарий" }, { key: "testInput", label: "Синтетический ввод" },
    { key: "expected", label: "Ожидаемый результат" }, { key: "severity", label: "Критичность" },
  ]);
  const counts = {
    critical: SECURITY_TEST_DATASET.filter((x) => x.severity === "critical").length,
    high: SECURITY_TEST_DATASET.filter((x) => x.severity === "high").length,
    medium: SECURITY_TEST_DATASET.filter((x) => x.severity === "medium").length,
    low: SECURITY_TEST_DATASET.filter((x) => x.severity === "low").length,
  };
  return <section className="content-section space-y-5">
    <div className="page-heading"><div><span className="eyebrow">ВСТРОЕННЫЙ НАБОР · QA / SECURITY</span><h1>Лаборатория испытаний</h1><p>200 готовых синтетических сценариев для проверки компонентов LESS. Набор встроен в приложение и доступен без импорта файлов.</p></div><button className="users-button users-button--primary" onClick={exportCases}><Download size={15}/> Экспортировать выборку</button></div>
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
      <div className="surface-panel p-4"><span className="eyebrow">ВСЕГО СЦЕНАРИЕВ</span><strong className="block text-3xl mt-2">{SECURITY_TEST_DATASET.length}</strong></div>
      <div className="surface-panel p-4"><span className="eyebrow">КРИТИЧЕСКИЕ</span><strong className="block text-3xl mt-2">{counts.critical}</strong></div>
      <div className="surface-panel p-4"><span className="eyebrow">ВЫСОКИЕ</span><strong className="block text-3xl mt-2">{counts.high}</strong></div>
      <div className="surface-panel p-4"><span className="eyebrow">СРЕДНИЕ</span><strong className="block text-3xl mt-2">{counts.medium}</strong></div>
      <div className="surface-panel p-4"><span className="eyebrow">НИЗКИЕ</span><strong className="block text-3xl mt-2">{counts.low}</strong></div>
    </div>
    <div className="surface-panel p-4 space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="flex items-center gap-2 flex-1 min-w-[220px] rounded-lg border border-surface-highest px-3 py-2"><Search size={16}/><input className="bg-transparent outline-none w-full text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по ID, сценарию, области…"/></label>
        <select className="rounded-lg border border-surface-highest bg-surface px-3 py-2 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="all">Все уровни</option><option value="critical">Критический</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="low">Низкий</option></select>
        <select className="rounded-lg border border-surface-highest bg-surface px-3 py-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}><option value="all">Все методы</option><option value="white-box">White-box</option><option value="gray-box">Gray-box</option><option value="black-box">Black-box</option></select>
        <span className="text-xs text-outline">{filtered.length} из 200</span>
      </div>
      <div className="overflow-auto max-h-[58vh]">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="sticky top-0 bg-[#0a0e16] text-outline font-mono-label"><tr><th className="text-left p-3">ID</th><th className="text-left p-3">ОБЛАСТЬ / МЕТОД</th><th className="text-left p-3">СЦЕНАРИЙ</th><th className="text-left p-3">ОЖИДАЕМЫЙ РЕЗУЛЬТАТ</th><th className="text-left p-3">РИСК</th></tr></thead>
          <tbody>{filtered.map((item) => <tr key={item.id} className="border-t border-surface-highest/30 align-top"><td className="p-3 font-mono text-xs text-primary">{item.id}</td><td className="p-3"><b>{item.domain}</b><div className="text-[10px] text-outline mt-1">{methodLabel[item.method]}</div></td><td className="p-3"><div>{item.scenario}</div><small className="text-outline">{item.testInput}</small></td><td className="p-3 text-xs text-outline">{item.expected}</td><td className="p-3"><span className={item.severity === "critical" ? "text-red-300" : item.severity === "high" ? "text-amber-300" : "text-outline"}>{severityLabel[item.severity]}</span></td></tr>)}</tbody>
        </table>
        {!filtered.length && <div className="p-8 text-center text-outline">По заданным условиям сценарии не найдены.</div>}
      </div>
    </div>
    <div className="surface-panel p-4 flex gap-3 items-start"><ShieldCheck size={18} className="text-primary mt-0.5"/><div><b className="text-sm">Важно о наборе</b><p className="text-xs text-outline mt-1">Это синтетические тест-кейсы и ожидаемые результаты, а не реальные биометрические образцы и не отчёт о выполненных испытаниях. Физические проверки камеры/PAD и нагрузочные испытания запускаются отдельно на стенде.</p></div></div>
  </section>;
}
