import {
  PROGRAM_STAGES,
  WORK_ORDER_STATUSES,
  type ProgramStage,
  type WorkOrderStatus,
} from "./types";

export function programStageIndex(stage: string): number {
  return PROGRAM_STAGES.indexOf(stage as ProgramStage);
}

export function nextProgramStage(stage: string): ProgramStage | null {
  const i = programStageIndex(stage);
  if (i < 0 || i >= PROGRAM_STAGES.length - 1) return null;
  return PROGRAM_STAGES[i + 1] ?? null;
}

export function canAdvanceProgram(stage: string): boolean {
  return nextProgramStage(stage) != null && stage !== "已結案";
}

const WO_FORWARD: Partial<Record<WorkOrderStatus, WorkOrderStatus>> = {
  等待前置: "未開始",
  未開始: "進行中",
  進行中: "已送出",
  已送出: "待審核",
  待審核: "已完成",
  需修改: "進行中",
  已完成: "已請款",
};

export function nextWorkOrderStatus(status: string): WorkOrderStatus | null {
  return WO_FORWARD[status as WorkOrderStatus] ?? null;
}

export function canAdvanceWorkOrder(status: string): boolean {
  return nextWorkOrderStatus(status) != null;
}

/** 畫面上給使用者看的「下一步」文案（避免看不懂的狀態機用語） */
export function workOrderPrimaryActionLabel(status: string): string | null {
  switch (status) {
    case "等待前置":
      return "解鎖開始";
    case "未開始":
      return "開始製作";
    case "進行中":
    case "需修改":
      return "送出交付";
    case "已送出":
    case "待審核":
      return null; // 用審核按鈕
    case "已完成":
      return "標記已請款";
    default:
      return null;
  }
}

export function rejectWorkOrderStatus(status: string): WorkOrderStatus | null {
  if (status === "待審核" || status === "已送出") return "需修改";
  return null;
}

export function workOrderColumnOrder(): WorkOrderStatus[] {
  return [...WORK_ORDER_STATUSES];
}

export function stageTone(stage: string): string {
  if (stage === "已結案" || stage === "製作完成") return "bg-emerald-100 text-emerald-900";
  if (stage === "待財務結清") return "bg-sky-100 text-sky-900";
  if (stage === "待開案" || stage === "待案主填寫" || stage === "開案審核中") return "bg-amber-100 text-amber-950";
  if (stage === "後製中" || stage === "待上架" || stage === "上架中") return "bg-violet-100 text-violet-900";
  return "bg-stone-100 text-stone-800";
}

export function woTone(status: string): string {
  switch (status) {
    case "等待前置":
      return "bg-stone-100 text-stone-600";
    case "未開始":
      return "bg-slate-100 text-slate-800";
    case "進行中":
      return "bg-sky-100 text-sky-900";
    case "已送出":
    case "待審核":
      return "bg-amber-100 text-amber-950";
    case "需修改":
      return "bg-rose-100 text-rose-900";
    case "已完成":
      return "bg-emerald-100 text-emerald-900";
    case "已請款":
      return "bg-teal-100 text-teal-900";
    case "已取消":
      return "bg-stone-200 text-stone-500 line-through";
    default:
      return "bg-stone-100 text-stone-700";
  }
}

export function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number(n)) return "—";
  return `NT$ ${Number(n).toLocaleString("zh-TW")}`;
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}
