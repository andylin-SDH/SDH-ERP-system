"use client";

import Link from "next/link";
import type { MeetingProjectItem } from "@/lib/meeting/types";

function InfoBlock({ label, value }: { label: string; value: string }) {
  if (!value) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
        <p className="mt-1 text-sm text-stone-400">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{value}</p>
    </div>
  );
}

export function MeetingProjectDetail({ project }: { project: MeetingProjectItem }) {
  return (
    <div className="space-y-4 rounded-xl border border-stone-200/80 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-bold text-stone-900">專案資訊 · {project.專案名稱}</p>
        <Link
          href={`/dashboard?project=${encodeURIComponent(project.專案ID)}`}
          className="text-xs font-semibold text-amber-800 hover:text-amber-600"
        >
          到大總表編輯 →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <InfoBlock label="專案內容" value={project.專案內容} />
        <InfoBlock label="備註" value={project.備註} />
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-stone-800">
            待辦任務
            <span className="ml-2 text-xs font-normal text-stone-500">
              {project.待辦任務.length} 件
              {project.逾期任務數 > 0 ? (
                <span className="font-semibold text-red-700"> · 逾期 {project.逾期任務數} 件</span>
              ) : null}
            </span>
          </p>
        </div>
        {project.待辦任務.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-200 bg-stone-50/80 py-6 text-center text-sm text-stone-500">
            沒有未完成任務
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs font-bold text-stone-600">
                <tr>
                  <th className="px-3 py-2">任務</th>
                  <th className="px-3 py-2">類型</th>
                  <th className="px-3 py-2">負責人</th>
                  <th className="px-3 py-2">到期日</th>
                  <th className="px-3 py-2">備註</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {project.待辦任務.map((t) => (
                  <tr key={t.任務ID || `${t.任務}-${t.到期日}`} className={t.逾期 ? "bg-red-50/60" : undefined}>
                    <td className="px-3 py-2 font-medium text-stone-900">
                      {t.任務}
                      {t.逾期 ? (
                        <span className="ml-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          逾期
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{t.任務類型}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-700">{t.任務負責人}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-stone-700">{t.到期日}</td>
                    <td className="max-w-[240px] px-3 py-2 text-stone-600">
                      {t.備註 ? <span className="whitespace-pre-wrap">{t.備註}</span> : <span className="text-stone-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
