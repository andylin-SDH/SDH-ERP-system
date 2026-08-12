"use client";

import { MASTER_AMOUNT_FIELD_KEYS } from "@/config/master-permissions";
import { formatTaipeiDateTime } from "@/lib/taiwan-date";

export type MasterEditLogItem = {
  id: string;
  專案ID: string;
  操作: string;
  更新者: string;
  變更內容: Record<string, unknown>;
  變更前快照?: Record<string, unknown>;
  created_at?: string;
};

const AMOUNT_SET = new Set<string>(MASTER_AMOUNT_FIELD_KEYS);

function formatEditLogValue(val: unknown): string {
  if (val === undefined || val === null || val === "") return "（空）";
  if (typeof val === "boolean") return val ? "是" : "否";
  return String(val);
}

function formatEditLogTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return formatTaipeiDateTime(iso);
  } catch {
    return iso;
  }
}

export function MasterEditHistory({
  logs,
  loading,
}: {
  logs: MasterEditLogItem[];
  loading: boolean;
}) {
  return (
    <section className="mt-2">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-amber-800">修改紀錄</h3>
          <p className="mt-0.5 text-xs text-stone-500">
            任何人變更金額或專案欄位都會留下紀錄；金額異動以橘色標示。
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-stone-400">載入中…</p>
      ) : logs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50/80 px-3 py-4 text-sm text-stone-400">
          尚無修改紀錄
        </p>
      ) : (
        <ul className="space-y-3">
          {logs.map((log) => {
            const changes = Object.entries(log.變更內容 ?? {});
            const hasAmount = changes.some(([k]) => AMOUNT_SET.has(k));
            return (
              <li
                key={log.id}
                className={`rounded-xl border px-3 py-2.5 ${
                  hasAmount
                    ? "border-amber-300 bg-amber-50/70 ring-1 ring-amber-200/80"
                    : "border-stone-200/90 bg-stone-50/60"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-stone-800">
                    {log.操作} · {log.更新者 || "—"}
                    {hasAmount ? (
                      <span className="ml-2 inline-flex rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
                        金額異動
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-stone-400">{formatEditLogTime(log.created_at)}</span>
                </div>
                {changes.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-stone-600">
                    {changes.map(([key, newVal]) => {
                      const oldVal = log.變更前快照?.[key];
                      const isAmount = AMOUNT_SET.has(key);
                      return (
                        <li key={key} className={isAmount ? "font-medium" : undefined}>
                          <span className={isAmount ? "text-amber-900" : "font-medium text-stone-500"}>
                            {key}：
                          </span>
                          {log.操作 === "新增" ? (
                            <span>{formatEditLogValue(newVal)}</span>
                          ) : (
                            <span>
                              <span className="text-red-600/90">{formatEditLogValue(oldVal)}</span>
                              <span className="mx-1 text-stone-400">→</span>
                              <span className="text-emerald-700">{formatEditLogValue(newVal)}</span>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
