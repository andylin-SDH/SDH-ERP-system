import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { getSupabase } from "@/lib/supabase/server";
import { logPcAction } from "./db";

type CueEpisode = Record<string, string>;

export function extractSpreadsheetId(urlOrId: string): string {
  const raw = urlOrId.trim();
  if (!raw) throw new Error("請貼上 Google 試算表網址");
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw) && !raw.includes("/")) return raw;
  const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m?.[1]) return m[1];
  throw new Error("網址格式不對，請貼完整的 docs.google.com/spreadsheets/d/... 連結");
}

function resolveSheetsAuth() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.SCHEDULE_CALENDAR_BIG_KEY,
    process.env.SCHEDULE_CALENDAR_SMALL_KEY,
    "sdh-erp-system-63ac1e6283c3.json",
  ].filter(Boolean) as string[];

  for (const source of candidates) {
    const raw = source.trim();
    if (!raw) continue;
    try {
      if (raw.startsWith("{")) {
        return new google.auth.GoogleAuth({
          credentials: JSON.parse(raw) as object,
          scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });
      }
      const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
      if (!fs.existsSync(resolved)) continue;
      return new google.auth.GoogleAuth({
        keyFile: resolved,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });
    } catch {
      /* try next */
    }
  }
  throw new Error("找不到 Google 服務帳號憑證，無法讀取試算表");
}

function toIsoDate(raw: string | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /^x$/i.test(s) || s === "已完成") return null;
  if (s.startsWith("1900/")) return null;
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function isDoneMark(raw: string | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s || /^x$/i.test(s)) return false;
  if (s === "已完成" || /^true$/i.test(s)) return true;
  if (toIsoDate(s)) return true;
  if (s.includes("超連結") || s.startsWith("http")) return true;
  return false;
}

function episodeStatus(row: CueEpisode): string {
  if (isDoneMark(row["上架"])) return "已上架";
  if (isDoneMark(row["音檔完稿"]) || isDoneMark(row["短影片完稿"])) return "後製中";
  if (toIsoDate(row["錄製日期"])) return "已錄音";
  return "預排";
}

function woStatus(cell: string | undefined): string {
  if (isDoneMark(cell)) return "已完成";
  const s = String(cell ?? "").trim();
  if (!s || /^x$/i.test(s)) return "等待前置";
  return "進行中";
}

export function parseCueRows(rows: string[][]): { episodes: CueEpisode[]; folderNotes: string[] } {
  const folderNotes: string[] = [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const a = String(rows[i]?.[0] ?? "").trim();
    if (a === "NO." || a === "No." || a === "no.") {
      headerIdx = i;
      break;
    }
    const link = rows[i]?.find((c) => String(c).includes("drive.google.com"));
    if (a && link) folderNotes.push(`${a}: ${String(link).trim()}`);
  }
  if (headerIdx < 0) {
    throw new Error("試算表找不到「NO.」標題列，請確認是 iCue Cue 表格式");
  }
  const headers = (rows[headerIdx] ?? []).map((h) => String(h ?? "").trim());
  const seen = new Map<string, number>();
  const unique = headers.map((h) => {
    if (!h) return h;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h}_${n}`;
  });
  const episodes: CueEpisode[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (!String(cells[0] ?? "").trim()) continue;
    const obj: CueEpisode = {};
    unique.forEach((h, idx) => {
      if (h) obj[h] = String(cells[idx] ?? "").trim();
    });
    const epNo = Number(obj["集"]);
    if (!Number.isFinite(epNo) || epNo <= 0) continue;
    episodes.push(obj);
  }
  if (!episodes.length) throw new Error("試算表沒有解析到任何集數");
  return { episodes, folderNotes };
}

async function fetchCueSheet(spreadsheetId: string): Promise<{
  title: string;
  sheetUrl: string;
  rows: string[][];
}> {
  const auth = resolveSheetsAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const title = String(meta.data.properties?.title ?? "").trim() || spreadsheetId;
  const firstSheet = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  const range = `'${firstSheet.replace(/'/g, "''")}'!A1:Z200`;
  const values = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = (values.data.values ?? []).map((r) => r.map((c) => String(c ?? "")));
  if (!rows.length) throw new Error("試算表是空的，或服務帳號沒有讀取權限");
  return {
    title,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    rows,
  };
}

function programIdForSheet(spreadsheetId: string): string {
  // 同一本表固定同一個節目 ID，重跑只補缺不覆蓋
  return `PC-GS-${spreadsheetId.slice(0, 12)}`;
}

function programNameFromTitle(title: string): string {
  return title.replace(/\s*Cue表\s*$/i, "").trim() || title;
}

async function tryInsert(table: string, row: Record<string, unknown>): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase.from(table).insert(row);
  if (!error) return true;
  if (error.code === "23505" || /duplicate|unique|already exists|重複/i.test(error.message)) return false;
  throw new Error(`${table}: ${error.message}`);
}

async function writeCueToDb(input: {
  programId: string;
  programName: string;
  clientName?: string;
  sheetUrl: string;
  episodes: CueEpisode[];
  folderNotes: string[];
  actorEmail?: string;
}): Promise<{ episodes: number; workOrders: number; uploads: number; createdProgram: boolean }> {
  const { programId, episodes } = input;
  const editor = String(episodes.find((e) => e["剪輯"])?.["剪輯"] ?? "").trim() || null;
  const note = [`Cue表 ${input.sheetUrl}`, ...input.folderNotes].filter(Boolean).join("\n");

  const createdProgram = await tryInsert("pc_programs", {
    id: programId,
    name: input.programName,
    client_name: input.clientName?.trim() || null,
    source_mode: "CUE_SHEET_IMPORT",
    workflow_version: "V2_FULL_LIFECYCLE",
    workflow_stage: "後製中",
    status: "進行中",
    pm_email: input.actorEmail ?? null,
    total_episodes: episodes.length,
    first_air_date: toIsoDate(episodes[0]?.["播出日期"]) ?? toIsoDate(episodes[0]?.["錄製日期"]),
    frequency: "每週",
    services: {
      AUDIO_EDIT: { quantity: episodes.length },
      SHORT_VIDEO_EDIT: { quantity: episodes.length },
      SHORT_SCRIPT: { quantity: episodes.length },
      SHOWNOTES: { quantity: episodes.length },
      COVER_PACKAGE: { quantity: 1 },
    },
    included_revisions: 2,
    note,
    updated_by: input.actorEmail ?? null,
  });

  // 節目已存在時：只補空 note（不覆蓋名稱等已有欄）
  if (!createdProgram) {
    const supabase = getSupabase();
    const { data } = await supabase.from("pc_programs").select("note").eq("id", programId).maybeSingle();
    if (data && !String((data as { note?: string }).note ?? "").trim()) {
      await supabase.from("pc_programs").update({ note }).eq("id", programId).is("note", null);
    }
  }

  let epN = 0;
  let woN = 0;
  let upN = 0;

  for (const ep of episodes) {
    const season = Number(ep["季"]) || 1;
    const epNo = Number(ep["集"]);
    const epId = `${programId}-S${season}E${epNo}`;
    const guest = String(ep["來賓名稱"] ?? "").trim();
    if (
      await tryInsert("pc_episodes", {
        id: epId,
        program_id: programId,
        season,
        episode_no: epNo,
        label: `${season}-${epNo}`,
        title: guest ? `第${epNo}集｜${guest}` : `第${epNo}集`,
        air_date: toIsoDate(ep["播出日期"]),
        recording_date: toIsoDate(ep["錄製日期"]),
        topic: guest || null,
        topic_status: guest ? "已確認" : "暫定",
        status: episodeStatus(ep),
        material_status: isDoneMark(ep["音檔完稿"]) ? "已交接" : "未交接",
        guest_requirement: guest ? "已確認" : "待確認",
        note: editor ? `剪輯：${editor}` : null,
      })
    ) {
      epN += 1;
    }

    const defs = [
      { name: "音檔剪輯", code: "AUDIO_EDIT", cell: ep["音檔完稿"], kind: "POST_PRODUCTION" },
      { name: "短影剪輯", code: "SHORT_VIDEO_EDIT", cell: ep["短影片完稿"], kind: "POST_PRODUCTION" },
      { name: "短影腳本", code: "SHORT_SCRIPT", cell: ep["短影腳本"], kind: "PRE_PRODUCTION" },
      { name: "資訊欄撰寫", code: "SHOWNOTES", cell: ep["資訊欄"], kind: "POST_PRODUCTION" },
    ] as const;

    for (const def of defs) {
      const status = woStatus(def.cell);
      if (
        await tryInsert("pc_work_orders", {
          id: `${programId}-WO-${season}-${epNo}-${def.code}`,
          program_id: programId,
          episode_id: epId,
          service_name: def.name,
          service_code: def.code,
          unit_seq: 1,
          workorder_kind: def.kind,
          assignee_name: editor,
          status,
          prereq_status: status === "等待前置" ? "等待前置" : "已解鎖",
          client_billable: true,
          vendor_payable: Boolean(editor),
          included_revisions: 2,
          revision_round: 0,
          review_status: status === "已完成" ? "通過" : "未送審",
          idempotency_key: `${epId}|${def.name}|1`,
        })
      ) {
        woN += 1;
      }
    }

    if (
      await tryInsert("pc_upload_checklist", {
        id: `${programId}-UP-${season}-${epNo}`,
        episode_id: epId,
        program_id: programId,
        status: isDoneMark(ep["上架"]) ? "已上架" : "未準備",
        title_confirmed: Boolean(guest),
        upload_note: guest || null,
      })
    ) {
      upN += 1;
    }
  }

  if (
    await tryInsert("pc_work_orders", {
      id: `${programId}-WO-COVER`,
      program_id: programId,
      episode_id: null,
      service_name: "封面設計",
      service_code: "COVER_PACKAGE",
      unit_seq: 1,
      workorder_kind: "PRE_PRODUCTION",
      status: "已完成",
      prereq_status: "已解鎖",
      client_billable: true,
      vendor_payable: false,
      is_program_singleton: true,
      singleton_key: "COVER_PACKAGE",
      included_revisions: 2,
      revision_round: 0,
      review_status: "通過",
      idempotency_key: `${programId}|封面設計|1`,
    })
  ) {
    woN += 1;
  }

  await logPcAction({
    action_type: "Cue表試算表匯入",
    actor_email: input.actorEmail,
    program_id: programId,
    entity_type: "pc_programs",
    entity_id: programId,
    status: "成功",
    note: `ep+${epN} wo+${woN} up+${upN} sheet=${input.sheetUrl}`,
  });

  return { episodes: epN, workOrders: woN, uploads: upN, createdProgram };
}

/** 貼 Google 試算表網址 → 伺服器讀取 → 寫入 pc_*（只新增） */
export async function importCueFromSheetUrl(input: {
  sheet_url: string;
  program_name?: string;
  client_name?: string;
  actor_email?: string;
}): Promise<{
  programId: string;
  programName: string;
  episodes: number;
  workOrders: number;
  uploads: number;
  createdProgram: boolean;
}> {
  const spreadsheetId = extractSpreadsheetId(input.sheet_url);
  const fetched = await fetchCueSheet(spreadsheetId);
  const { episodes, folderNotes } = parseCueRows(fetched.rows);
  const programId = programIdForSheet(spreadsheetId);
  const programName = input.program_name?.trim() || programNameFromTitle(fetched.title);
  const result = await writeCueToDb({
    programId,
    programName,
    clientName: input.client_name,
    sheetUrl: fetched.sheetUrl,
    episodes,
    folderNotes,
    actorEmail: input.actor_email,
  });
  return {
    programId,
    programName,
    episodes: result.episodes,
    workOrders: result.workOrders,
    uploads: result.uploads,
    createdProgram: result.createdProgram,
  };
}
