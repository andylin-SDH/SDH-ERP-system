"use client";

const SDH_BLUE = "#40A0C8";
const SDH_BLUE_SOFT = "rgba(64, 160, 200, 0.22)";
const DONE_DOT = "#5B6B4A";
const LINE = "#D6D3D1";

type InvoiceProgressHint = {
  count: number;
  unpaidAmount: number;
} | null | undefined;

export type MasterProjectProgressInput = {
  專案狀態: string | null | undefined;
  開案日期?: string | null;
  invoiceSummary?: InvoiceProgressHint;
};

type Step = {
  key: string;
  label: string;
};

function isClosedStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  if (!s) return false;
  return s.includes("結案") || s.includes("完結") || s === "完成" || s.includes("已結束") || s.includes("取消");
}

function isPausedStatus(status: string): boolean {
  return status.trim().includes("暫緩");
}

/** 依專案狀態與發票收款推進度；發票步驟為推導結果，不可點。 */
export function resolveMasterProjectProgress(input: MasterProjectProgressInput): {
  steps: Step[];
  activeIndex: number;
} {
  const status = String(input.專案狀態 ?? "").trim();
  const summary = input.invoiceSummary ?? null;
  const hasInvoice = Boolean(summary && summary.count > 0);
  const fullyPaid = Boolean(summary && summary.count > 0 && summary.unpaidAmount <= 0);
  const closed = isClosedStatus(status);
  const paused = isPausedStatus(status);

  const steps: Step[] = [
    { key: "opened", label: "開案" },
    { key: "active", label: paused ? "暫緩" : "進行中" },
    { key: "invoiced", label: "已開發票" },
    { key: "paid", label: "已收款" },
    { key: "closed", label: "結案" },
  ];

  let activeIndex = 1;
  if (closed) activeIndex = 4;
  else if (fullyPaid) activeIndex = 3;
  else if (hasInvoice) activeIndex = 2;
  else if (!String(input.開案日期 ?? "").trim() && !status) activeIndex = 0;

  return { steps, activeIndex };
}

export function MasterProjectProgress({
  專案狀態,
  開案日期,
  invoiceSummary,
}: MasterProjectProgressInput) {
  const { steps, activeIndex } = resolveMasterProjectProgress({
    專案狀態,
    開案日期,
    invoiceSummary,
  });

  return (
    <section className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <h3 className="mb-3 text-sm font-bold tracking-wide text-stone-600">進度</h3>
      <ol className="grid grid-cols-5 gap-x-1">
        {steps.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          const isLast = index === steps.length - 1;
          return (
            <li key={step.key} className="relative min-w-0">
              {!isLast ? (
                <span
                  className="pointer-events-none absolute left-[calc(50%+8px)] right-[-50%] top-[7px] h-px"
                  style={{
                    backgroundColor: index < activeIndex ? DONE_DOT : LINE,
                    opacity: index < activeIndex ? 0.45 : 1,
                  }}
                  aria-hidden
                />
              ) : null}
              <div className="relative z-[1] flex flex-col items-center gap-1.5 text-center">
                <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
                  {active ? (
                    <span
                      className="absolute inset-[-6px] rounded-full"
                      style={{ backgroundColor: SDH_BLUE_SOFT }}
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className="relative h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: active ? SDH_BLUE : done ? DONE_DOT : "#C4C4C0",
                      boxShadow: active ? `0 0 0 2px ${SDH_BLUE}` : undefined,
                    }}
                  />
                </span>
                <span
                  className={`w-full whitespace-normal break-words text-[12px] leading-snug ${
                    active ? "font-bold" : done ? "font-medium text-stone-700" : "font-medium text-stone-400"
                  }`}
                  style={active ? { color: "#1F7A9A" } : undefined}
                >
                  {step.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
