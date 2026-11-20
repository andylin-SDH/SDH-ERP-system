"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  PREPROD_STATUSES,
  PROGRAM_STAGES,
  canAdvanceProgram,
  formatMoney,
  nextProgramStage,
  stageTone,
  woTone,
  type PcEpisode,
  type PcPerspective,
  type PcPreprodTask,
  type PcProgram,
  type PcRecordingSession,
  type PcSnapshot,
  type PcUploadChecklist,
  type PcWorkOrder,
} from "@/lib/production-case";

type ProgramStep = "overview" | "episodes" | "preprod" | "workorders" | "upload" | "sessions";

type StepDef = {
  id: ProgramStep;
  label: string;
  blurb: string;
  hideFor?: PcPerspective[];
};

const STEPS: StepDef[] = [
  { id: "overview", label: "總覽", blurb: "整檔進度、相關資料夾、推進階段。" },
  { id: "episodes", label: "單集", blurb: "每一集的排程與狀態。" },
  { id: "preprod", label: "前製", blurb: "開錄前任務：指派、到期、狀態、交付連結都在這裡改。", hideFor: ["vendor"] },
  { id: "workorders", label: "工單與交付", blurb: "解鎖 → 製作 → 交檔 → 審核。" },
  { id: "upload", label: "上架", blurb: "每集上架狀態。", hideFor: ["vendor"] },
  { id: "sessions", label: "錄音場次", blurb: "已排／已錄場次。", hideFor: ["vendor"] },
];

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>;
}

function preprodTone(status: string): string {
  switch (status) {
    case "已完成":
      return "bg-emerald-100 text-emerald-900";
    case "進行中":
      return "bg-sky-100 text-sky-900";
    case "待審核":
      return "bg-amber-100 text-amber-950";
    case "需修改":
    case "等待客戶":
    case "等待來賓":
      return "bg-rose-100 text-rose-900";
    case "已取消":
    case "不適用":
      return "bg-stone-200 text-stone-500";
    default:
      return "bg-stone-100 text-stone-700";
  }
}

function parseNoteLinks(note: string | null | undefined): { label: string; url: string }[] {
  if (!note?.trim()) return [];
  const out: { label: string; url: string }[] = [];
  for (const line of note.split(/\n+/)) {
    const m = line.match(/^(.*?)\s*(https?:\/\/\S+)/);
    if (!m) continue;
    const label = m[1].replace(/[:：]\s*$/, "").trim() || "連結";
    out.push({ label, url: m[2] });
  }
  return out;
}

function StagePipeline({ stage }: { stage: string }) {
  const idx = PROGRAM_STAGES.indexOf(stage as (typeof PROGRAM_STAGES)[number]);
  return (
    <ol className="flex flex-wrap gap-1">
      {PROGRAM_STAGES.map((s, i) => {
        const done = idx >= 0 && i < idx;
        const current = i === idx;
        return (
          <li
            key={s}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              current ? "bg-amber-500 text-white" : done ? "bg-stone-200 text-stone-700" : "bg-stone-50 text-stone-400"
            }`}
          >
            {s}
          </li>
        );
      })}
    </ol>
  );
}

async function postAction(body: Record<string, unknown>) {
  const res = await fetch("/api/production-case/actions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) throw new Error(data.error ?? `操作失敗（${res.status}）`);
  return data;
}

export function ProductionCaseApp({
  embedded = false,
  forcedPerspective,
}: {
  embedded?: boolean;
  forcedPerspective?: PcPerspective;
}) {
  const [snapshot, setSnapshot] = useState<PcSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [step, setStep] = useState<ProgramStep>("overview");
  const [busy, setBusy] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [newProgramName, setNewProgramName] = useState("");
  const [newProgramClient, setNewProgramClient] = useState("");
  const [deliveryUrl, setDeliveryUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/production-case", { credentials: "include", cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; snapshot?: PcSnapshot; error?: string };
      if (!res.ok || !data.ok || !data.snapshot) throw new Error(data.error ?? `載入失敗（${res.status}）`);
      setSnapshot(data.snapshot);
      setSelectedId((prev) => {
        if (prev && data.snapshot!.programs.some((p) => p.id === prev)) return prev;
        return data.snapshot!.programs[0]?.id || "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const perspective = forcedPerspective ?? snapshot?.perspective ?? "internal";
  const selected = snapshot?.programs.find((p) => p.id === selectedId) ?? null;

  const visibleSteps = useMemo(
    () => STEPS.filter((s) => !s.hideFor?.includes(perspective)),
    [perspective]
  );

  useEffect(() => {
    if (perspective === "vendor" && step !== "workorders" && step !== "overview") {
      setStep("workorders");
    }
  }, [perspective, step]);

  const episodes = useMemo(
    () =>
      selected && snapshot
        ? snapshot.episodes.filter((e) => e.program_id === selected.id).sort((a, b) => a.episode_no - b.episode_no)
        : [],
    [snapshot, selected]
  );
  const tasks = useMemo(
    () => (selected && snapshot ? snapshot.preprodTasks.filter((t) => t.program_id === selected.id) : []),
    [snapshot, selected]
  );
  const workOrders = useMemo(
    () => (selected && snapshot ? snapshot.workOrders.filter((w) => w.program_id === selected.id) : []),
    [snapshot, selected]
  );
  const uploads = useMemo(
    () => (selected && snapshot ? snapshot.uploads.filter((u) => u.program_id === selected.id) : []),
    [snapshot, selected]
  );
  const sessions = useMemo(
    () => (selected && snapshot ? snapshot.sessions.filter((s) => s.program_id === selected.id) : []),
    [snapshot, selected]
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="p-8 text-center text-stone-500">載入製作控管…</p>;
  }

  if (error && !snapshot) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-rose-800">{error}</p>
        <button type="button" className="mt-4 rounded-xl border px-4 py-2 text-sm" onClick={() => void load()}>
          重試
        </button>
      </div>
    );
  }

  if (!snapshot) return null;

  const title =
    perspective === "vendor"
      ? "外包工單"
      : perspective === "client"
        ? "案主製作進度"
        : perspective === "kol"
          ? "KOL 製作進度"
          : "製作控管";

  const stepDef = visibleSteps.find((s) => s.id === step) ?? visibleSteps[0]!;

  return (
    <div
      className={
        embedded
          ? "rounded-3xl border border-stone-200/80 bg-[#f4f2ed] shadow-lg shadow-stone-300/30"
          : "min-h-screen bg-[#f4f2ed]"
      }
    >
      <header
        className={`${embedded ? "rounded-t-3xl" : "sticky top-0 z-20"} border-b border-stone-200/90 bg-[#f4f2ed]/95 backdrop-blur-md`}
      >
        <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 ${embedded ? "" : "mx-auto max-w-7xl"}`}>
          <div>
            {!embedded && (
              <Link href="/dashboard" className="text-xs font-semibold text-stone-500 hover:text-stone-800">
                ← 回 Dashboard
              </Link>
            )}
            <h1 className="text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">{title}</h1>
            {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 disabled:opacity-50"
          >
            重新整理
          </button>
        </div>
      </header>

      <main className={`px-4 py-5 sm:px-6 ${embedded ? "" : "mx-auto max-w-7xl"}`}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          {/* 左：選專案 */}
          <aside className="space-y-2 lg:sticky lg:top-20 lg:self-start">
            {perspective === "internal" && (
              <>
                <form
                  className="rounded-2xl border border-stone-200 bg-white p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newProgramName.trim()) return;
                    void run(async () => {
                      const res = await fetch("/api/production-case", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: newProgramName.trim(),
                          client_name: newProgramClient.trim() || undefined,
                        }),
                      });
                      const data = (await res.json()) as { ok?: boolean; program?: PcProgram; error?: string };
                      if (!res.ok || !data.ok || !data.program) throw new Error(data.error ?? "建立失敗");
                      setNewProgramName("");
                      setNewProgramClient("");
                      setSelectedId(data.program.id);
                      setStep("overview");
                    });
                  }}
                >
                  <p className="text-xs font-bold text-stone-900">新增空白專案</p>
                  <input
                    value={newProgramName}
                    onChange={(e) => setNewProgramName(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                    placeholder="節目名稱"
                    required
                  />
                  <input
                    value={newProgramClient}
                    onChange={(e) => setNewProgramClient(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                    placeholder="客戶（可空）"
                  />
                  <button
                    type="submit"
                    disabled={busy || !newProgramName.trim()}
                    className="mt-2 w-full rounded-lg bg-stone-900 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    建立專案
                  </button>
                </form>

                <form
                  className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!sheetUrl.trim()) return;
                    void run(async () => {
                      const data = (await postAction({
                        action: "import_cue_sheet",
                        sheet_url: sheetUrl.trim(),
                      })) as { programId?: string };
                      setSheetUrl("");
                      if (data.programId) {
                        setSelectedId(data.programId);
                        setStep("overview");
                      }
                    });
                  }}
                >
                  <p className="text-xs font-bold text-amber-950">或匯入 Cue 試算表</p>
                  <input
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                    placeholder="試算表網址"
                  />
                  <button
                    type="submit"
                    disabled={busy || !sheetUrl.trim()}
                    className="mt-2 w-full rounded-lg bg-amber-500 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {busy ? "讀取中…" : "匯入"}
                  </button>
                </form>
              </>
            )}

            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">專案</p>
            {snapshot.programs.map((p) => {
              const wos = snapshot.workOrders.filter((w) => w.program_id === p.id);
              const pending = wos.filter((w) => w.status === "等待前置" || w.status === "待審核").length;
              const active = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id);
                    setStep(perspective === "vendor" ? "workorders" : "overview");
                  }}
                  className={`w-full rounded-2xl border px-3.5 py-3 text-left transition ${
                    active
                      ? "border-amber-400 bg-amber-50/80 ring-2 ring-amber-200"
                      : "border-stone-200 bg-white hover:border-stone-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-bold text-stone-900">{p.name}</p>
                    <Badge className={stageTone(p.workflow_stage)}>{p.workflow_stage}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-stone-500">
                    工單 {wos.length}
                    {pending ? ` · 待處理 ${pending}` : ""}
                  </p>
                </button>
              );
            })}
            {!snapshot.programs.length && <p className="px-1 text-sm text-stone-400">尚無專案</p>}
          </aside>

          {/* 右：大面積細節 */}
          <section className="min-w-0">
            {!selected ? (
              <div className="rounded-2xl border border-dashed border-stone-300 py-24 text-center text-sm text-stone-400">
                請從左側選擇專案
              </div>
            ) : (
              <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
                <div className="border-b border-stone-100 px-5 py-4">
                  <p className="text-xs text-stone-400">{selected.id}</p>
                  <h2 className="text-lg font-bold text-stone-900">{selected.name}</h2>
                  <p className="mt-0.5 text-sm text-stone-500">
                    客戶 {selected.client_name || "—"} · PM {selected.pm_name || "—"}
                  </p>
                </div>

                <div className="flex gap-1 overflow-x-auto border-b border-stone-100 px-4 py-2">
                  {visibleSteps.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStep(s.id)}
                      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold ${
                        step === s.id ? "bg-amber-500 text-white" : "bg-stone-50 text-stone-600 hover:bg-stone-100"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className="px-5 py-5">
                  <p className="mb-4 text-sm text-stone-500">{stepDef.blurb}</p>
                  <DetailBody
                    step={step}
                    program={selected}
                    episodes={episodes}
                    tasks={tasks}
                    workOrders={workOrders}
                    uploads={uploads}
                    sessions={sessions}
                    perspective={perspective}
                    busy={busy}
                    deliveryUrl={deliveryUrl}
                    setDeliveryUrl={setDeliveryUrl}
                    onGoStep={setStep}
                    onCreate={(body) => void run(() => postAction(body))}
                    onAdvanceStage={() =>
                      void run(() =>
                        postAction({
                          action: "advance_program",
                          id: selected.id,
                          stage: selected.workflow_stage,
                        })
                      )
                    }
                    onClientSubmit={() =>
                      void run(() => postAction({ action: "client_submit_onboarding", id: selected.id }))
                    }
                    onDelete={() => {
                      if (!window.confirm(`確定刪除「${selected.name}」？無法復原。`)) return;
                      void run(async () => {
                        await postAction({ action: "delete_program", id: selected.id });
                        setSelectedId("");
                      });
                    }}
                    onUnlockWo={(id) => void run(() => postAction({ action: "unlock_workorder", id }))}
                    onAdvanceWo={(id) => void run(() => postAction({ action: "advance_workorder", id }))}
                    onSubmitDelivery={(id) =>
                      void run(() =>
                        postAction({
                          action: "submit_delivery",
                          workorder_id: id,
                          delivery_url: deliveryUrl || undefined,
                          delivery_note: "交付",
                        })
                      )
                    }
                    onApproveWo={(id) =>
                      void run(() => postAction({ action: "review_workorder", id, result: "通過" }))
                    }
                    onRejectWo={(id) =>
                      void run(() =>
                        postAction({ action: "review_workorder", id, result: "退回", reject_reason: "需修改" })
                      )
                    }
                    onMarkUpload={(id) =>
                      void run(() => postAction({ action: "patch_upload", id, patch: { status: "已上架" } }))
                    }
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function DetailBody({
  step,
  program,
  episodes,
  tasks,
  workOrders,
  uploads,
  sessions,
  perspective,
  busy,
  deliveryUrl,
  setDeliveryUrl,
  onGoStep,
  onCreate,
  onAdvanceStage,
  onClientSubmit,
  onDelete,
  onUnlockWo,
  onAdvanceWo,
  onSubmitDelivery,
  onApproveWo,
  onRejectWo,
  onMarkUpload,
}: {
  step: ProgramStep;
  program: PcProgram;
  episodes: PcEpisode[];
  tasks: PcPreprodTask[];
  workOrders: PcWorkOrder[];
  uploads: PcUploadChecklist[];
  sessions: PcRecordingSession[];
  perspective: PcPerspective;
  busy: boolean;
  deliveryUrl: string;
  setDeliveryUrl: (v: string) => void;
  onGoStep: (s: ProgramStep) => void;
  onCreate: (body: Record<string, unknown>) => void;
  onAdvanceStage: () => void;
  onClientSubmit: () => void;
  onDelete: () => void;
  onUnlockWo: (id: string) => void;
  onAdvanceWo: (id: string) => void;
  onSubmitDelivery: (id: string) => void;
  onApproveWo: (id: string) => void;
  onRejectWo: (id: string) => void;
  onMarkUpload: (id: string) => void;
}) {
  const [epNo, setEpNo] = useState("");
  const [epTitleInput, setEpTitleInput] = useState("");
  const [epRecording, setEpRecording] = useState("");
  const [epAir, setEpAir] = useState("");
  const [preprodName, setPreprodName] = useState("");
  const [preprodEp, setPreprodEp] = useState("");
  const [preprodAssignee, setPreprodAssignee] = useState("");
  const [preprodDue, setPreprodDue] = useState("");
  const [woName, setWoName] = useState("");
  const [woEp, setWoEp] = useState("");
  const [woAssignee, setWoAssignee] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [sessionStudio, setSessionStudio] = useState("");

  const links = parseNoteLinks(program.note);
  const epTitle = (id: string | null) => {
    if (!id) return "整檔節目";
    const ep = episodes.find((e) => e.id === id);
    return ep ? ep.title || `第${ep.episode_no}集` : id;
  };
  const canAdd = perspective === "internal";
  const nextEpSuggestion = String((episodes.reduce((m, e) => Math.max(m, e.episode_no), 0) || 0) + 1);

  if (step === "overview") {
    return (
      <div className="space-y-5">
        <div>
          <Badge className={stageTone(program.workflow_stage)}>{program.workflow_stage}</Badge>
          <div className="mt-3">
            <StagePipeline stage={program.workflow_stage} />
          </div>
        </div>
        {links.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-stone-500">相關資料</p>
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <a
                  key={`${link.label}-${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-full border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-800 hover:border-amber-400 hover:bg-amber-50"
                >
                  {link.label} ↗
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {perspective === "internal" && canAdvanceProgram(program.workflow_stage) && (
            <button
              type="button"
              disabled={busy}
              onClick={onAdvanceStage}
              className="rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              整檔推進至「{nextProgramStage(program.workflow_stage)}」
            </button>
          )}
          {perspective === "client" &&
            (program.workflow_stage === "待案主填寫" || program.workflow_stage === "待開案") && (
              <button
                type="button"
                disabled={busy}
                onClick={onClientSubmit}
                className="rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                送出開案資料
              </button>
            )}
          <button
            type="button"
            onClick={() => onGoStep("workorders")}
            className="rounded-full bg-stone-900 px-4 py-2 text-xs font-bold text-white"
          >
            去工單與交付 →
          </button>
          {perspective === "internal" && (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-800 disabled:opacity-50"
            >
              刪除此案
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step === "episodes") {
    const saveEpisodeField = (id: string, patch: Record<string, unknown>) => {
      onCreate({ action: "patch_episode", id, patch });
    };
    return (
      <div className="space-y-4">
        {canAdd && (
          <form
            className="rounded-xl border border-dashed border-stone-300 bg-stone-50/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!epTitleInput.trim()) return;
              const n = Number(epNo || nextEpSuggestion);
              onCreate({
                action: "create_episode",
                program_id: program.id,
                episode_no: n,
                title: epTitleInput.trim(),
                recording_date: epRecording || undefined,
                air_date: epAir || undefined,
              });
              setEpNo("");
              setEpTitleInput("");
              setEpRecording("");
              setEpAir("");
            }}
          >
            <p className="text-xs font-bold text-stone-800">新增單集</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs text-stone-600">
                集數
                <input
                  value={epNo}
                  onChange={(e) => setEpNo(e.target.value)}
                  className="mt-1 block w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                  placeholder={nextEpSuggestion}
                  inputMode="numeric"
                />
              </label>
              <label className="min-w-[12rem] flex-1 text-xs text-stone-600">
                標題（必填）
                <input
                  value={epTitleInput}
                  onChange={(e) => setEpTitleInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                  placeholder="例：第14集｜來賓名"
                  required
                />
              </label>
              <label className="text-xs text-stone-600">
                錄音日
                <input
                  type="date"
                  value={epRecording}
                  onChange={(e) => setEpRecording(e.target.value)}
                  className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-stone-600">
                播出日
                <input
                  type="date"
                  value={epAir}
                  onChange={(e) => setEpAir(e.target.value)}
                  className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !epTitleInput.trim()}
                className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                新增單集
              </button>
            </div>
          </form>
        )}
        <p className="text-[11px] text-stone-500">下方表格可直接改標題、錄音日、播出日（離開欄位即儲存）。</p>
        <div className="overflow-x-auto rounded-xl border border-stone-200">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2.5">集</th>
                <th className="px-3 py-2.5">標題</th>
                <th className="px-3 py-2.5">狀態</th>
                <th className="px-3 py-2.5">錄音日</th>
                <th className="px-3 py-2.5">播出日</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep) => (
                <tr key={ep.id} className="border-t border-stone-100">
                  <td className="px-3 py-2 text-stone-500">#{ep.episode_no}</td>
                  <td className="px-3 py-1.5">
                    {canAdd ? (
                      <input
                        key={`${ep.id}-title-${ep.title}`}
                        defaultValue={ep.title || ""}
                        disabled={busy}
                        className="w-full min-w-[10rem] rounded border border-transparent bg-transparent px-1.5 py-1 font-medium hover:border-stone-300 focus:border-amber-400 focus:bg-white focus:outline-none"
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (!next || next === (ep.title || "")) return;
                          saveEpisodeField(ep.id, { title: next });
                        }}
                      />
                    ) : (
                      <span className="font-medium">{ep.title || ep.label}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge className="bg-stone-100 text-stone-700">{ep.status}</Badge>
                  </td>
                  <td className="px-3 py-1.5">
                    {canAdd ? (
                      <input
                        key={`${ep.id}-rec-${ep.recording_date ?? ""}`}
                        type="date"
                        defaultValue={ep.recording_date ?? ""}
                        disabled={busy}
                        className="rounded border border-transparent bg-transparent px-1 py-1 hover:border-stone-300 focus:border-amber-400 focus:bg-white focus:outline-none"
                        onBlur={(e) => {
                          const next = e.target.value;
                          if (next === (ep.recording_date ?? "")) return;
                          saveEpisodeField(ep.id, { recording_date: next });
                        }}
                      />
                    ) : (
                      ep.recording_date ?? "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {canAdd ? (
                      <input
                        key={`${ep.id}-air-${ep.air_date ?? ""}`}
                        type="date"
                        defaultValue={ep.air_date ?? ""}
                        disabled={busy}
                        className="rounded border border-transparent bg-transparent px-1 py-1 hover:border-stone-300 focus:border-amber-400 focus:bg-white focus:outline-none"
                        onBlur={(e) => {
                          const next = e.target.value;
                          if (next === (ep.air_date ?? "")) return;
                          saveEpisodeField(ep.id, { air_date: next });
                        }}
                      />
                    ) : (
                      ep.air_date ?? "—"
                    )}
                  </td>
                </tr>
              ))}
              {!episodes.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-stone-400">
                    尚無單集
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (step === "preprod") {
    const patchTask = (id: string, patch: Record<string, unknown>) => {
      onCreate({ action: "patch_preprod", id, patch });
    };
    const activeTasks = tasks.filter((t) => t.status !== "已取消");
    const doneCount = activeTasks.filter((t) => t.status === "已完成" || t.status === "不適用").length;
    const openCount = activeTasks.length - doneCount;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold text-stone-400">全部</p>
            <p className="text-lg font-bold text-stone-900">{activeTasks.length}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold text-amber-800/70">未完成</p>
            <p className="text-lg font-bold text-amber-950">{openCount}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold text-emerald-800/70">已完成</p>
            <p className="text-lg font-bold text-emerald-950">{doneCount}</p>
          </div>
        </div>

        {canAdd && (
          <form
            className="rounded-xl border border-dashed border-stone-300 bg-stone-50/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!preprodName.trim()) return;
              onCreate({
                action: "create_preprod",
                program_id: program.id,
                task_type: preprodName.trim(),
                episode_id: preprodEp || null,
                assignee_name: preprodAssignee.trim() || undefined,
                due_date: preprodDue || undefined,
              });
              setPreprodName("");
              setPreprodEp("");
              setPreprodAssignee("");
              setPreprodDue("");
            }}
          >
            <p className="text-xs font-bold text-stone-800">新增前製任務</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="min-w-[10rem] flex-1 text-xs text-stone-600">
                任務名稱（必填）
                <input
                  value={preprodName}
                  onChange={(e) => setPreprodName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                  placeholder="例：訪綱企劃"
                  required
                />
              </label>
              <label className="text-xs text-stone-600">
                綁定單集
                <select
                  value={preprodEp}
                  onChange={(e) => setPreprodEp(e.target.value)}
                  className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                >
                  <option value="">整檔節目</option>
                  {episodes.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      #{ep.episode_no} {ep.title || ep.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-stone-600">
                負責人
                <input
                  value={preprodAssignee}
                  onChange={(e) => setPreprodAssignee(e.target.value)}
                  className="mt-1 w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                  placeholder="姓名"
                />
              </label>
              <label className="text-xs text-stone-600">
                到期日
                <input
                  type="date"
                  value={preprodDue}
                  onChange={(e) => setPreprodDue(e.target.value)}
                  className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !preprodName.trim()}
                className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                新增前製
              </button>
            </div>
          </form>
        )}

        <ul className="space-y-3">
          {activeTasks.map((t) => (
            <li key={t.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-stone-900">{t.task_type}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{epTitle(t.episode_id)}</p>
                </div>
                <Badge className={preprodTone(t.status)}>{t.status}</Badge>
              </div>

              {canAdd ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs text-stone-600">
                    狀態
                    <select
                      value={t.status}
                      disabled={busy}
                      className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                      onChange={(e) => patchTask(t.id, { status: e.target.value })}
                    >
                      {PREPROD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-stone-600">
                    負責人
                    <input
                      key={`${t.id}-assignee-${t.assignee_name ?? ""}`}
                      defaultValue={t.assignee_name ?? ""}
                      disabled={busy}
                      className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                      placeholder="未指派"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next === (t.assignee_name ?? "")) return;
                        patchTask(t.id, { assignee_name: next || null });
                      }}
                    />
                  </label>
                  <label className="text-xs text-stone-600">
                    到期日
                    <input
                      key={`${t.id}-due-${t.due_date ?? ""}`}
                      type="date"
                      defaultValue={t.due_date ?? ""}
                      disabled={busy}
                      className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                      onBlur={(e) => {
                        const next = e.target.value;
                        if (next === (t.due_date ?? "")) return;
                        patchTask(t.id, { due_date: next || null });
                      }}
                    />
                  </label>
                  <label className="text-xs text-stone-600">
                    交付連結
                    <input
                      key={`${t.id}-url-${t.deliverable_url ?? ""}`}
                      defaultValue={t.deliverable_url ?? ""}
                      disabled={busy}
                      className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                      placeholder="https://…"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next === (t.deliverable_url ?? "")) return;
                        patchTask(t.id, { deliverable_url: next || null });
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-500">
                  <span>負責人 {t.assignee_name || "—"}</span>
                  <span>到期 {t.due_date || "—"}</span>
                  {t.deliverable_url ? (
                    <a href={t.deliverable_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-amber-800">
                      查看交付 ↗
                    </a>
                  ) : null}
                </div>
              )}

              {canAdd && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.status === "未開始" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patchTask(t.id, { status: "進行中" })}
                      className="rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      開始進行
                    </button>
                  )}
                  {(t.status === "進行中" || t.status === "需修改") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patchTask(t.id, { status: "待審核" })}
                      className="rounded-full bg-stone-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      送出待審
                    </button>
                  )}
                  {t.status === "待審核" && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => patchTask(t.id, { status: "已完成" })}
                        className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        通過完成
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => patchTask(t.id, { status: "需修改" })}
                        className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-800 disabled:opacity-50"
                      >
                        退回修改
                      </button>
                    </>
                  )}
                  {t.status !== "已完成" && t.status !== "已取消" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patchTask(t.id, { status: "已完成" })}
                      className="rounded-full border border-stone-300 px-3 py-1.5 text-[11px] font-semibold text-stone-700 disabled:opacity-50"
                    >
                      直接完成
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`取消任務「${t.task_type}」？`)) return;
                      patchTask(t.id, { status: "已取消" });
                    }}
                    className="rounded-full border border-rose-200 px-3 py-1.5 text-[11px] font-semibold text-rose-700 disabled:opacity-50"
                  >
                    取消任務
                  </button>
                </div>
              )}

              {t.deliverable_url && canAdd ? (
                <a
                  href={t.deliverable_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[11px] font-semibold text-amber-800 hover:underline"
                >
                  開啟交付連結 ↗
                </a>
              ) : null}
            </li>
          ))}
          {!activeTasks.length && (
            <li className="rounded-xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-400">
              尚無前製任務，請在上方新增
            </li>
          )}
        </ul>
      </div>
    );
  }

  if (step === "workorders") {
    return (
      <div className="space-y-4">
        <ol className="rounded-xl border border-stone-200 bg-stone-50/80 px-4 py-3 text-xs text-stone-600">
          <li className="font-bold text-stone-800">操作順序</li>
          <li className="mt-1">1. 等待前置 → 解鎖開始</li>
          <li>2. 未開始 → 開始製作</li>
          <li>3. 進行中／需修改 → 貼網址 → 送出交付</li>
          <li>4. 待審核 → 通過或退回重做</li>
        </ol>
        {canAdd && (
          <form
            className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!woName.trim()) return;
              onCreate({
                action: "create_workorder",
                program_id: program.id,
                service_name: woName.trim(),
                episode_id: woEp || null,
                assignee_name: woAssignee.trim() || undefined,
              });
              setWoName("");
              setWoEp("");
              setWoAssignee("");
            }}
          >
            <label className="min-w-[8rem] flex-1 text-xs text-stone-600">
              工單名稱
              <input
                value={woName}
                onChange={(e) => setWoName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                placeholder="例：音檔剪輯"
                required
              />
            </label>
            <label className="text-xs text-stone-600">
              單集
              <select
                value={woEp}
                onChange={(e) => setWoEp(e.target.value)}
                className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              >
                <option value="">整檔節目</option>
                {episodes.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    #{ep.episode_no} {ep.title || ep.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-600">
              負責人
              <input
                value={woAssignee}
                onChange={(e) => setWoAssignee(e.target.value)}
                className="mt-1 w-28 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                placeholder="可空"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !woName.trim()}
              className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              新增工單
            </button>
          </form>
        )}
        <ul className="space-y-3">
          {workOrders.map((wo) => {
            const needsDelivery = wo.status === "進行中" || wo.status === "需修改";
            return (
              <li key={wo.id} className="rounded-xl border border-stone-200 bg-stone-50/40 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-stone-900">{wo.service_name}</p>
                    <p className="text-xs text-stone-500">
                      {epTitle(wo.episode_id)}
                      {wo.assignee_name ? ` · ${wo.assignee_name}` : ""}
                    </p>
                  </div>
                  <Badge className={woTone(wo.status)}>{wo.status}</Badge>
                </div>
                {wo.prereq_missing && <p className="mt-1 text-xs text-rose-700">還缺：{wo.prereq_missing}</p>}
                {perspective === "internal" && (
                  <p className="mt-1.5 text-[11px] text-stone-500">
                    客戶 {formatMoney(wo.client_amount)} · 外包 {formatMoney(wo.vendor_amount)} · 修改{" "}
                    {wo.revision_round}/{wo.included_revisions ?? "—"}
                  </p>
                )}
                {needsDelivery && (perspective === "internal" || perspective === "vendor") && (
                  <label className="mt-2 block text-xs text-stone-600">
                    交付網址
                    <input
                      value={deliveryUrl}
                      onChange={(e) => setDeliveryUrl(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
                      placeholder="https://drive.google.com/…"
                    />
                  </label>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {perspective === "internal" && wo.status === "等待前置" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onUnlockWo(wo.id)}
                      className="rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      解鎖開始
                    </button>
                  )}
                  {(perspective === "internal" || perspective === "vendor") && wo.status === "未開始" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAdvanceWo(wo.id)}
                      className="rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      開始製作
                    </button>
                  )}
                  {needsDelivery && (perspective === "internal" || perspective === "vendor") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSubmitDelivery(wo.id)}
                      className="rounded-full bg-stone-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      送出交付
                    </button>
                  )}
                  {perspective === "internal" && (wo.status === "待審核" || wo.status === "已送出") && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onApproveWo(wo.id)}
                        className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        審核通過
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRejectWo(wo.id)}
                        className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-800 disabled:opacity-50"
                      >
                        退回重做
                      </button>
                    </>
                  )}
                  {perspective === "internal" && wo.status === "已完成" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onAdvanceWo(wo.id)}
                      className="rounded-full border border-stone-300 px-3 py-1.5 text-[11px] font-semibold text-stone-700 disabled:opacity-50"
                    >
                      標記已請款
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {!workOrders.length && <li className="py-10 text-center text-sm text-stone-400">尚無工單</li>}
        </ul>
      </div>
    );
  }

  if (step === "upload") {
    return (
      <ul className="space-y-2">
        {uploads.map((u) => (
          <li
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/50 px-3 py-2.5"
          >
            <div>
              <p className="text-sm font-medium">{epTitle(u.episode_id)}</p>
              {u.upload_note ? <p className="text-xs text-stone-500">{u.upload_note}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-stone-100 text-stone-700">{u.status}</Badge>
              {perspective === "internal" && u.status !== "已上架" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onMarkUpload(u.id)}
                  className="rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                >
                  標記已上架
                </button>
              )}
            </div>
          </li>
        ))}
        {!uploads.length && <li className="py-10 text-center text-sm text-stone-400">尚無上架檢核</li>}
      </ul>
    );
  }

  // sessions
  return (
    <div className="space-y-4">
      {canAdd && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            onCreate({
              action: "create_session",
              program_id: program.id,
              session_date: sessionDate || undefined,
              studio_name: sessionStudio.trim() || undefined,
            });
            setSessionDate("");
            setSessionStudio("");
          }}
        >
          <label className="text-xs text-stone-600">
            日期
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="mt-1 block rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="min-w-[8rem] flex-1 text-xs text-stone-600">
            棚別／地點
            <input
              value={sessionStudio}
              onChange={(e) => setSessionStudio(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
              placeholder="例：大錄音室"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            新增場次
          </button>
        </form>
      )}
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/50 px-3 py-2.5 text-sm"
          >
            <div>
              <p className="font-medium">
                {s.session_date ?? "未排"} {s.start_time ?? ""}
                {s.end_time ? `–${s.end_time}` : ""}
              </p>
              <p className="text-xs text-stone-500">{s.studio_name || "未填棚別"}</p>
            </div>
            <Badge className="bg-stone-100 text-stone-700">{s.status}</Badge>
          </li>
        ))}
        {!sessions.length && <li className="py-10 text-center text-sm text-stone-400">尚無錄音場次</li>}
      </ul>
    </div>
  );
}
