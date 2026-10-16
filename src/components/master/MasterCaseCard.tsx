"use client";

import { memo, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { MasterRow } from "@/lib/db/master";

type Props = {
  row: MasterRow;
  depth: number;
  selected: boolean;
  taskActive: boolean;
  openTaskCount: number;
  childCount: number;
  treeOpen: boolean;
  statusOptions: string[];
  statusSaving: boolean;
  onSelectProject: (row: MasterRow) => void;
  onSelectTasks: (row: MasterRow) => void;
  onToggleTree: (e: MouseEvent, projectId: string) => void;
  onStatusChange: (row: MasterRow, nextStatus: string) => void;
};

function MasterCaseCardInner({
  row,
  depth,
  selected,
  taskActive,
  openTaskCount,
  childCount,
  treeOpen,
  statusOptions,
  statusSaving,
  onSelectProject,
  onSelectTasks,
  onToggleTree,
  onStatusChange,
}: Props) {
  const pid = String(row.專案ID ?? "").trim();
  const projectName = String(row.專案名稱 ?? "").trim() || "—";
  const kolName = String(row.KOL名稱 ?? "").trim();
  const vendorName = String(row.廠商名稱 ?? "").trim();
  const pmName = String(row.執行管理員 ?? "").trim();
  const openedOn = String(row.開案日期 ?? "").trim();
  const statusText = String(row.專案狀態 ?? "").trim();
  const closedish = /結案|完成|取消/.test(statusText);
  const options = statusText && !statusOptions.includes(statusText) ? [...statusOptions, statusText] : statusOptions;

  const selectProject = () => onSelectProject(row);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    selectProject();
  };
  /** 按下就選，不必等 click 放開；主執行緒再忙也不易「點很多次才有反應」 */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    selectProject();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`rounded-2xl border p-3.5 text-left shadow-sm transition ${
        selected
          ? "border-emerald-600 bg-emerald-50/70 ring-2 ring-emerald-600/15"
          : "border-stone-200 bg-white hover:border-amber-200 hover:bg-amber-50/40"
      } ${depth > 0 ? "ml-4 border-l-4 border-l-sky-400" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-semibold leading-snug text-stone-900">{projectName}</p>
        {depth > 0 ? (
          <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-800">
            子專案
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
        <span
          className={kolName || vendorName ? "font-bold" : "font-medium text-stone-400"}
          style={kolName || vendorName ? { color: "#40A0C8" } : undefined}
        >
          {kolName || vendorName || "未填案主"}
        </span>
        <span className="text-stone-300"> · </span>
        <span>{pmName ? `${pmName}負責` : "未填專案PM"}</span>
        <span className="text-stone-300"> · </span>
        <span>{openedOn || "未填開案日"}</span>
      </p>
      <div
        className="mt-2 flex flex-wrap items-center gap-1.5"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <select
          value={statusText}
          disabled={statusSaving}
          onChange={(e) => onStatusChange(row, e.target.value)}
          className={`max-w-[10rem] rounded-full border px-2 py-0.5 text-[11px] font-semibold focus:outline-none disabled:opacity-60 ${
            closedish
              ? "border-emerald-300 bg-emerald-100 text-emerald-900"
              : "border-amber-300 bg-amber-100 text-amber-950"
          }`}
          title={statusText || "未設定"}
        >
          <option value="">未設定</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onSelectTasks(row)}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            taskActive
              ? "border-teal-600 bg-teal-700 text-white"
              : openTaskCount > 0
                ? "border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100"
                : "border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100"
          }`}
        >
          任務 {openTaskCount}
        </button>
        {childCount > 0 ? (
          <button
            type="button"
            onClick={(e) => onToggleTree(e, pid)}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              treeOpen
                ? "border-sky-500 bg-sky-600 text-white"
                : "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100"
            }`}
          >
            {treeOpen ? "收合" : "子專案"} {childCount}
          </button>
        ) : null}
        {row.長期案 ? (
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
            長期案
          </span>
        ) : null}
      </div>
    </div>
  );
}

export const MasterCaseCard = memo(MasterCaseCardInner);
