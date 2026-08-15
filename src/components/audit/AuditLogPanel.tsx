"use client";

/**
 * 董事長專用：異動紀錄（稽核中心）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditLogItem } from "@/lib/audit/types";
import { auditFieldSummary } from "@/lib/audit/types";

const ENTITY_LABEL: Record<string, string> = {
  partners: "合作夥伴 / KOL",
  master: "大總表",
};

function formatTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function DiffBlock({
  title,
  data,
}: {
  title: string;
  data?: Record<string, unknown>;
}) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">{title}</p>
        <p className="text-sm text-stone-400">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">{title}</p>
      <dl className="space-y-1 rounded-lg bg-stone-50 p-3 text-sm">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[minmax(7rem,9rem)_1fr] gap-2">
            <dt className="truncate font-medium text-stone-600" title={k}>
              {k}
            </dt>
            <dd className="break-all text-stone-800">{v === null || v === undefined ? "—" : String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entity, setEntity] = useState<"all" | "partners" | "master">("all");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("entity", entity);
      params.set("limit", "200");
      if (action) params.set("action", action);
      if (q) params.set("q", q);
      const res = await fetch(`/api/audit-logs?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; logs?: AuditLogItem[]; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "讀取失敗");
        setLogs([]);
        return;
      }
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [entity, action, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const actionOptions = useMemo(() => ["新增", "編輯", "刪除", "還原"], []);

  const handleRestore = useCallback(
    async (item: AuditLogItem) => {
      if (item.action !== "刪除") return;
      const label = `${item.entity_label}（${item.entity_id}）`;
      if (!window.confirm(`確定還原「${label}」？`)) return;
      setBusyId(item.id);
      setNotice(null);
      try {
        const url =
          item.entity_type === "partners" ? "/api/partners/restore" : "/api/master/restore";
        const body =
          item.entity_type === "partners"
            ? { PartnerID: item.entity_id }
            : { 專案ID: item.entity_id };
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          window.alert(data.error ?? "還原失敗");
          return;
        }
        setNotice(`已還原：${label}`);
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "還原失敗");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-amber-900">異動紀錄</h2>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          僅董事長可見。彙整合作夥伴與大總表的新增／編輯／刪除／還原／永久清除紀錄；刪除改為封存，可由此還原。封存滿一個月後系統會永久清除主檔，異動紀錄仍保留。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
          模組
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value as typeof entity)}
            className="min-w-[10rem] rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal text-stone-800"
          >
            <option value="all">全部</option>
            <option value="partners">合作夥伴 / KOL</option>
            <option value="master">大總表</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-stone-600">
          操作
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="min-w-[8rem] rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal text-stone-800"
          >
            <option value="">全部</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-semibold text-stone-600">
          關鍵字
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(qDraft.trim());
            }}
            placeholder="PartnerID、專案ID、名稱、操作者…"
            className="rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal text-stone-800"
          />
        </label>
        <button
          type="button"
          onClick={() => setQ(qDraft.trim())}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800"
        >
          搜尋
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
        >
          重新整理
        </button>
      </div>

      {notice && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-stone-50 text-[11px] font-bold uppercase tracking-wider text-stone-500">
              <tr>
                <th className="px-3 py-2.5">時間</th>
                <th className="px-3 py-2.5">模組</th>
                <th className="px-3 py-2.5">對象</th>
                <th className="px-3 py-2.5">操作</th>
                <th className="px-3 py-2.5">操作者</th>
                <th className="px-3 py-2.5">變更摘要</th>
                <th className="px-3 py-2.5">動作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-stone-400">
                    載入中…
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-stone-400">
                    尚無符合條件的紀錄
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((item) => {
                  const open = expandedId === item.id;
                  return (
                    <tr key={item.id} className="border-t border-stone-100 align-top hover:bg-amber-50/40">
                      <td className="whitespace-nowrap px-3 py-2.5 text-stone-600">{formatTime(item.created_at)}</td>
                      <td className="px-3 py-2.5 text-stone-700">{ENTITY_LABEL[item.entity_type] ?? item.entity_type}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-stone-900">{item.entity_label}</div>
                        <div className="font-mono text-[11px] text-stone-500">{item.entity_id}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${
                            item.action === "刪除"
                              ? "bg-red-50 text-red-700"
                              : item.action === "還原"
                                ? "bg-emerald-50 text-emerald-700"
                                : item.action === "新增"
                                  ? "bg-sky-50 text-sky-700"
                                  : "bg-stone-100 text-stone-700"
                          }`}
                        >
                          {item.action}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-stone-700">{item.actor || "—"}</td>
                      <td className="max-w-xs px-3 py-2.5 text-stone-600">{auditFieldSummary(item)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId(open ? null : item.id)}
                            className="text-xs font-semibold text-amber-800 hover:underline"
                          >
                            {open ? "收合" : "詳情"}
                          </button>
                          {item.action === "刪除" && (
                            <button
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => void handleRestore(item)}
                              className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                            >
                              {busyId === item.id ? "還原中…" : "還原"}
                            </button>
                          )}
                        </div>
                        {open && (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <DiffBlock title="變更內容" data={item.changed_fields} />
                            <DiffBlock title="變更前快照" data={item.before_snapshot} />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
