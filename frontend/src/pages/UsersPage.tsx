import { useEffect, useState, useCallback } from "react";
import {
  listUsers, createUser, updateUser, deleteUser, getUser,
  User as UserType,
} from "../services/api";
import { ru } from "../i18n/ru";

function fmt(iso?: string | null) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString("ru-RU"); } catch { return iso; }
}

export default function UsersPage({ onEnroll }: { onEnroll: (u: UserType) => void }) {
  const [users, setUsers] = useState<UserType[]>([]);
  const [selected, setSelected] = useState<UserType | null>(null);
  const [form, setForm] = useState({ name: "", position: "", nfc_uid: "", pin: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState<"list" | "detail">("list");

  const load = useCallback(async () => {
    try { setUsers(await listUsers(true)); } catch { setUsers([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openUser = async (id: number) => {
    setSelected(await getUser(id));
    setView("detail");
  };

  const saveUser = async () => {
    setMsg("");
    try {
      if (editId) {
        await updateUser(editId, {
          name: form.name, position: form.position,
          nfc_uid: form.nfc_uid, pin: form.pin || undefined,
        });
      } else {
        await createUser({
          name: form.name, position: form.position,
          nfc_uid: form.nfc_uid, pin: form.pin || undefined,
        });
      }
      setForm({ name: "", position: "", nfc_uid: "", pin: "" });
      setEditId(null);
      await load();
      setMsg(ru.saved);
    } catch (e: any) {
      setMsg(e?.response?.data?.error || e.message || ru.error);
    }
  };

  if (view === "detail" && selected) {
    return (
      <div className="max-w-3xl space-y-3">
        <button onClick={() => setView("list")} className="text-sm text-outline hover:text-white">
          {ru.backToList}
        </button>
        <div className="bg-surface-low rounded-xl p-6">
          <h2 className="font-display text-2xl font-bold">{selected.name || "-"}</h2>
          <p className="text-primary">{selected.position}</p>
          <p className="font-mono text-xs text-outline mt-1">{selected.nfc_uid}</p>
          <div className="flex gap-2 mt-4">
            <button onClick={() => onEnroll(selected)} className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-sm">
              {ru.enrollFaceBtn}
            </button>
            <button
              onClick={async () => {
                await updateUser(selected.id, { is_active: !selected.is_active });
                openUser(selected.id);
              }}
              className="px-3 py-1.5 rounded-lg bg-surface-high text-sm"
            >
              {selected.is_active ? ru.disable : ru.enable}
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
            {(
              [
                [ru.status, selected.is_active ? ru.active : "OFF"],
                [ru.face, selected.face_enrolled ? ru.faceYes : ru.faceNo],
                ["IN", fmt(selected.last_entry)],
                ["OUT", fmt(selected.last_exit)],
                [ru.registration, fmt(selected.created_at)],
              ] as const
            ).map(([l, v]) => (
              <div key={String(l)} className="bg-[#0a0e16] rounded-lg p-2">
                <div className="font-mono-label text-outline">{l}</div>
                <div className="text-sm mt-0.5">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 bg-surface-low rounded-xl p-4 space-y-3">
        <h2 className="font-display font-semibold">{editId ? ru.editUser : ru.newUser}</h2>
        {(
          [
            ["name", ru.fullName],
            ["position", ru.position],
            ["nfc_uid", ru.nfcUid],
            ["pin", ru.pin],
          ] as const
        ).map(([k, lab]) => (
          <div key={k}>
            <label className="font-mono-label text-outline block mb-1">{lab}</label>
            <input
              type={k === "pin" ? "password" : "text"}
              className="w-full px-3 py-2 rounded-lg bg-surface border border-surface-highest text-sm focus:border-primary focus:outline-none"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </div>
        ))}
        <button
          onClick={saveUser}
          disabled={!form.nfc_uid}
          className="w-full py-2 rounded-lg bg-primary-container text-slate-950 font-semibold text-sm disabled:opacity-40"
        >
          {editId ? ru.update : ru.add}
        </button>
        {msg && <p className="text-xs text-outline">{msg}</p>}
      </div>
      <div className="lg:col-span-3 bg-surface-low rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="font-mono-label text-outline bg-[#0a0e16]">
            <tr>
              <th className="text-left p-2">{ru.employee}</th>
              <th className="text-left p-2">{ru.status}</th>
              <th className="text-left p-2">{ru.entryExit}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-surface-highest/30 hover:bg-surface-high/40">
                <td className="p-2">
                  <button onClick={() => openUser(u.id)} className="text-left hover:text-primary">
                    <div className="font-medium">{u.name || "-"}</div>
                    <div className="font-mono text-[10px] text-outline">{u.nfc_uid}</div>
                  </button>
                </td>
                <td className="p-2">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono-label ${
                      u.is_active ? "bg-secondary/20 text-secondary" : "bg-surface-highest text-outline"
                    }`}
                  >
                    {u.is_active ? ru.active : "OFF"}
                  </span>
                  {!!u.face_enrolled && <span className="ml-1 text-[10px] text-primary">{ru.face}</span>}
                </td>
                <td className="p-2 text-[10px] text-[#bcc9cd]">
                  <div>IN {fmt(u.last_entry)}</div>
                  <div>OUT {fmt(u.last_exit)}</div>
                </td>
                <td className="p-2 text-right text-xs whitespace-nowrap">
                  <button
                    className="text-outline mr-2"
                    onClick={() => {
                      setEditId(u.id);
                      setForm({
                        name: u.name || "",
                        position: u.position || "",
                        nfc_uid: u.nfc_uid,
                        pin: "",
                      });
                    }}
                  >
                    {ru.edit}
                  </button>
                  <button className="text-primary mr-2" onClick={() => onEnroll(u)}>
                    {ru.enrollFace}
                  </button>
                  <button
                    className="text-error"
                    onClick={async () => {
                      if (confirm("?")) {
                        await deleteUser(u.id);
                        load();
                      }
                    }}
                  >
                    {ru.del}
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-outline">{ru.noUsers}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
