"use client";

import { useCallback, useEffect, useState } from "react";

type FollowItem = { id: number; show: string; keywords: string[]; companions: string[] };

export function FollowList({ people, canMutate }: { people: string[]; canMutate: boolean }) {
  const [shows, setShows] = useState<FollowItem[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [show, setShow] = useState("");
  const [keywords, setKeywords] = useState("");
  const [companions, setCompanions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/schedule/follow");
    const body = (await response.json()) as { ok: boolean; shows?: FollowItem[]; canEdit?: boolean; error?: string };
    setCanEdit(Boolean(body.canEdit) && canMutate);
    setShows(body.shows ?? []);
    if (!body.ok) setError(body.error || "讀取跟錄名單失敗");
    else setError(null);
  }, [canMutate]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setShow("");
    setKeywords("");
    setCompanions([]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const response = await fetch("/api/schedule/follow", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingId ?? undefined, show, keywords, companions }),
    });
    const body = (await response.json()) as { ok: boolean; shows?: FollowItem[]; error?: string };
    setSaving(false);
    if (!body.ok) {
      setError(body.error || "儲存失敗");
      return;
    }
    setShows(body.shows ?? []);
    resetForm();
  }

  async function remove(id: number) {
    setSaving(true);
    setError(null);
    const response = await fetch("/api/schedule/follow", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = (await response.json()) as { ok: boolean; shows?: FollowItem[]; error?: string };
    setSaving(false);
    if (!body.ok) {
      setError(body.error || "刪除失敗");
      return;
    }
    setShows(body.shows ?? []);
    setConfirmDeleteId(null);
    if (editingId === id) resetForm();
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3">
      <p className="text-sm font-semibold text-stone-900">跟錄清單</p>
      <p className="mt-1 text-xs text-stone-500">這些節目要五吉郎跟錄。董事長和維尼可以改。</p>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <ul className="mt-3 space-y-2">
        {shows.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-stone-50 px-2 py-2 text-sm">
            <div>
              <p className="font-medium text-stone-900">{item.show}</p>
              <p className="text-xs text-stone-600">關鍵字：{item.keywords.join("、") || "—"}</p>
              <p className="text-xs text-stone-600">一起跟錄：{item.companions.join("、") || "沒有指定"}</p>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs text-stone-700 underline"
                  onClick={() => {
                    setEditingId(item.id);
                    setShow(item.show);
                    setKeywords(item.keywords.join("、"));
                    setCompanions(item.companions);
                    setConfirmDeleteId(null);
                  }}
                >
                  修改
                </button>
                {confirmDeleteId === item.id ? (
                  <button type="button" className="text-xs text-red-700 underline" onClick={() => void remove(item.id)} disabled={saving}>
                    確定刪除
                  </button>
                ) : (
                  <button type="button" className="text-xs text-stone-500 underline" onClick={() => setConfirmDeleteId(item.id)}>
                    刪除
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
        {shows.length === 0 && !error && <li className="text-xs text-stone-500">目前沒有跟錄節目。</li>}
      </ul>
      {canEdit && (
        <form
          className="mt-3 space-y-2 border-t border-stone-100 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-xs font-semibold text-stone-700">{editingId ? "修改節目" : "新增節目"}</p>
          <input
            className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            placeholder="節目名稱"
            value={show}
            onChange={(event) => setShow(event.target.value)}
          />
          <input
            className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            placeholder="預約關鍵字，用頓號或逗號分開"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
          />
          <div className="flex flex-wrap gap-3 text-xs text-stone-700">
            {people.map((name) => (
              <label key={name} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={companions.includes(name)}
                  onChange={(event) =>
                    setCompanions((prev) => (event.target.checked ? [...prev, name] : prev.filter((item) => item !== name)))
                  }
                />
                {name}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white" disabled={saving}>
              {editingId ? "儲存修改" : "新增到跟錄清單"}
            </button>
            {editingId && (
              <button type="button" className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs" onClick={resetForm}>
                取消修改
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
