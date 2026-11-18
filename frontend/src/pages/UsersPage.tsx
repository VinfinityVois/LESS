import { useEffect, useState, useCallback } from "react";
import {
  listUsers, createUser, updateUser, deleteUser, getUser,
  User as UserType,
} from "../services/api";
import { ru } from "../i18n/ru";
import { UserPlus, ScanFace } from "lucide-react";

function fmt(iso?: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

export default function UsersPage({ onEnroll }: { onEnroll: (u: UserType) => void }) {
  const [users, setUsers] = useState<UserType[]>([]);
  const [selected, setSelected] = useState<UserType | null>(null);
  const [form, setForm] = useState({ name: "", position: "", nfc_uid: "", pin: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState<"list" | "detail">("list");

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers(true));
    } catch {
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openUser = async (id: number) => {
    setSelected(await getUser(id));
    setView("detail");
  };

  const saveUser = async () => {
    setMsg("");
    try {
      if (editId) {
        await updateUser(editId, {
          name: form.name,
          position: form.position,
          nfc_uid: form.nfc_uid,
          pin: form.pin || undefined,
        });
      } else {
        await createUser({
          name: form.name,
          position: form.position,
          nfc_uid: form.nfc_uid,
          pin: form.pin || undefined,
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
        <button
          onClick={() => setView("list")}
          className="text-sm text-[#5c6570] hover:text-white transition"
        >
          {ru.backToList}
        </button>
        <div className="bg-[#12161e] border border-white/[0.06] rounded-2xl p-6">
          <h2 className="font-display text-2xl font-bold">{selected.name || "-"}</h2>
          <p className="text-primary mt-0.5">{selected.position}</p>
          <p className="font-mono text-xs text-[#5c6570] mt-1">{selected.nfc_uid}</p>
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => onEnroll(selected)}
              className="px-3.5 py-2 rounded-xl bg-primary/15 border border-primary/25 text-primary text-sm font-medium flex items-center gap-1.5 hover:bg-primary/25 transition"
            >
              <ScanFace className="w-4 h-4" />
              {ru.enrollFaceBtn}
            </button>
            <button
              onClick={async () => {
                await updateUser(selected.id, { is_active: !selected.is_active });
                openUser(selected.id);
              }}
              className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm hover:bg-white/[0.07] transition"
            >
              {selected.is_active ? ru.disable : ru.enable}
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mt-6">
            {(
              [
                [ru.status, selected.is_active ? ru.active : "OFF"],
                [ru.face, selected.face_enrolled ? ru.faceYes : ru.faceNo],
                ["IN", fmt(selected.last_entry)],
                ["OUT", fmt(selected.last_exit)],
                [ru.registration, fmt(selected.created_at)],
              ] as const
            ).map(([l, v]) => (
              <div
                key={String(l)}
                className="bg-[#0a0d12] border border-white/[0.04] rounded-xl p-3"
              >
                <div className="font-mono-label text-[#5c6570]">{l}</div>
                <div className="text-sm mt-1">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <div className="lg:col-span-2 bg-[#12161e] border border-white/[0.06] rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus className="w-4 h-4 text-primary" />
          <h2 className="font-display font-semibold">
            {editId ? ru.editUser : ru.newUser}
          </h2>
        </div>
        {(
          [
            ["name", ru.fullName],
            ["position", ru.position],
            ["nfc_uid", ru.nfcUid],
            ["pin", ru.pin],
          ] as const
        ).map(([k, lab]) => (
          <div key={k}>
            <label className="font-mono-label text-[#5c6570] block mb-1.5">{lab}</label>
            <input
              type={k === "pin" ? "password" : "text"}
              className="w-full px-3 py-2.5 rounded-xl bg-[#0a0d12] border border-white/[0.06] text-sm focus:border-primary/50 focus:outline-none transition"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </div>
        ))}
        <button
          onClick={saveUser}
          disabled={!form.nfc_uid}
          className="w-full py-2.5 rounded-xl bg-primary text-slate-950 font-semibold text-sm disabled:opacity-40 hover:brightness-110 transition"
        >
          {editId ? ru.update : ru.add}
        </button>
        {msg && <p className="text-xs text-[#5c6570]">{msg}</p>}
      </div>

      <div className="lg:col-span-3 bg-[#12161e] border border-white/[0.06] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="font-mono-label text-[#5c6570] bg-[#0a0d12]">
            <tr>
              <th className="text-left p-3">{ru.employee}</th>
              <th className="text-left p-3">{ru.status}</th>
              <th className="text-left p-3">{ru.entryExit}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="border-t border-white/[0.04] hover:bg-white/[0.02] transition"
              >
                <td className="p-3">
                  <button
                    onClick={() => openUser(u.id)}
                    className="text-left hover:text-primary transition"
                  >
                    <div className="font-medium">{u.name || "-"}</div>
                    <div className="font-mono text-[10px] text-[#5c6570]">{u.nfc_uid}</div>
                  </button>
                </td>
                <td className="p-3">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono-label ${
                      u.is_active
                        ? "bg-secondary/15 text-secondary border border-secondary/20"
                        : "bg-white/[0.04] text-[#5c6570] border border-white/[0.06]"
                    }`}
                  >
                    {u.is_active ? ru.active : "OFF"}
                  </span>
                  {!!u.face_enrolled && (
                    <span className="ml-1.5 text-[10px] text-primary">{ru.face}</span>
                  )}
                </td>
                <td className="p-3 text-[10px] text-[#7a8494]">
                  <div>IN {fmt(u.last_entry)}</div>
                  <div>OUT {fmt(u.last_exit)}</div>
                </td>
                <td className="p-3 text-right text-xs whitespace-nowrap">
                  <button
                    className="text-[#5c6570] hover:text-white mr-2 transition"
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
                  <button
                    className="text-primary hover:brightness-125 mr-2 transition"
                    onClick={() => onEnroll(u)}
                  >
                    {ru.enrollFace}
                  </button>
                  <button
                    className="text-error hover:brightness-125 transition"
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
                <td colSpan={4} className="p-10 text-center text-[#5c6570]">
                  {ru.noUsers}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
