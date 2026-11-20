/**
 * 批次匯入 iCue Cue 表（CSV）→ pc_*
 *
 * 用法：
 *   node scripts/import-pc-cue-sheets.mjs
 *   node scripts/import-pc-cue-sheets.mjs --dry-run
 *
 * 多專案：編輯 data/pc-import/manifest.json，每個專案放一份同格式 CSV。
 * 規則：只 INSERT；idempotency_key / id 衝突則跳過（不覆蓋既有資料）。
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const IMPORT_DIR = join(ROOT, "data", "pc-import");
const DRY = process.argv.includes("--dry-run");

function loadEnvLocal() {
  const path = resolve(ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function toIsoDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "x" || s === "X" || s === "已完成") return null;
  // skip Excel epoch junk
  if (s.startsWith("1900/")) return null;
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function isDoneMark(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "x" || s === "X") return false;
  if (s === "已完成" || s === "TRUE" || s === "true") return true;
  if (toIsoDate(s)) return true;
  if (s.includes("超連結") || s.startsWith("http")) return true;
  return false;
}

function episodeStatus(row) {
  if (isDoneMark(row["上架"])) return "已上架";
  if (isDoneMark(row["音檔完稿"]) || isDoneMark(row["短影片完稿"])) return "後製中";
  if (toIsoDate(row["錄製日期"])) return "已錄音";
  if (toIsoDate(row["播出日期"])) return "預排";
  return "預排";
}

function woStatusFromCue(doneCell) {
  if (isDoneMark(doneCell)) return "已完成";
  const s = String(doneCell ?? "").trim();
  if (!s || s === "x" || s === "X") return "等待前置";
  return "進行中";
}

function parseCueCsv(csvText) {
  const rows = parseCsv(csvText);
  const folders = {};
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const a = String(r[0] ?? "").trim();
    if (a === "NO." || a === "No." || a === "no.") {
      headerIdx = i;
      break;
    }
    // folder links in first columns
    if (a && r.some((c) => String(c).includes("drive.google.com"))) {
      const link = r.find((c) => String(c).includes("drive.google.com"));
      if (link) folders[a] = String(link).trim();
    }
  }
  if (headerIdx < 0) throw new Error("找不到 NO. 標題列（非 iCue Cue 表格式？）");
  const headers = rows[headerIdx].map((h) => String(h ?? "").trim());
  // de-dupe duplicate header names
  const seen = new Map();
  const uniqueHeaders = headers.map((h) => {
    if (!h) return h;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h}_${n}`;
  });

  const episodes = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || !String(cells[0] ?? "").trim()) continue;
    const obj = {};
    uniqueHeaders.forEach((h, idx) => {
      if (h) obj[h] = cells[idx] ?? "";
    });
    const epNo = Number(obj["集"]);
    if (!Number.isFinite(epNo) || epNo <= 0) continue;
    episodes.push(obj);
  }
  return { folders, episodes };
}

async function insertIgnore(table, row) {
  if (DRY) {
    console.log(`  [dry] ${table}`, row.id ?? row);
    return { inserted: true };
  }
  const { error } = await sb.from(table).insert(row);
  if (!error) return { inserted: true };
  if (String(error.message).includes("duplicate") || error.code === "23505") {
    return { inserted: false, skipped: true };
  }
  // PostgREST unique often: "duplicate key value"
  if (/already exists|unique|重複/i.test(error.message)) {
    return { inserted: false, skipped: true };
  }
  throw new Error(`${table}: ${error.message}`);
}

async function importProject(project) {
  const csvPath = join(IMPORT_DIR, project.csv);
  if (!existsSync(csvPath)) throw new Error(`找不到 CSV：${csvPath}`);
  const { folders, episodes } = parseCueCsv(readFileSync(csvPath, "utf8"));
  const programId = project.id;
  const noteParts = [
    project.sheet_url ? `Cue表 ${project.sheet_url}` : null,
    ...Object.entries(folders).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean);

  console.log(`\n▶ ${project.program_name} (${programId}) · ${episodes.length} 集`);

  const programRow = {
    id: programId,
    name: project.program_name,
    client_name: project.client_name ?? null,
    source_mode: "CUE_SHEET_IMPORT",
    workflow_version: "V2_FULL_LIFECYCLE",
    workflow_stage: "後製中",
    status: "進行中",
    pm_email: project.pm_email ?? null,
    pm_name: project.pm_name ?? null,
    total_episodes: episodes.length,
    first_air_date: toIsoDate(episodes[0]?.["播出日期"]) ?? toIsoDate(episodes[0]?.["錄製日期"]),
    frequency: "每週",
    services: project.services ?? {},
    included_revisions: 2,
    note: noteParts.join("\n"),
  };
  let r = await insertIgnore("pc_programs", programRow);
  console.log(r.skipped ? "  program skipped (exists)" : "  program inserted");

  let epIns = 0;
  let woIns = 0;
  let upIns = 0;
  const editor = project.editor_name ?? null;

  for (const ep of episodes) {
    const season = Number(ep["季"]) || 1;
    const epNo = Number(ep["集"]);
    const epId = `${programId}-S${season}E${epNo}`;
    const label = `${season}-${epNo}`;
    const guest = String(ep["來賓名稱"] ?? "").trim();
    const epRow = {
      id: epId,
      program_id: programId,
      season,
      episode_no: epNo,
      label,
      title: guest ? `第${epNo}集｜${guest}` : `第${epNo}集`,
      air_date: toIsoDate(ep["播出日期"]),
      recording_date: toIsoDate(ep["錄製日期"]),
      topic: guest || null,
      topic_status: guest ? "已確認" : "暫定",
      status: episodeStatus(ep),
      material_status: isDoneMark(ep["音檔完稿"]) ? "已交接" : "未交接",
      guest_requirement: guest ? "已確認" : "待確認",
      note: editor ? `剪輯：${editor}` : null,
    };
    r = await insertIgnore("pc_episodes", epRow);
    if (r.inserted) epIns += 1;

    const woDefs = [
      { name: "音檔剪輯", code: "AUDIO_EDIT", cell: ep["音檔完稿"] },
      { name: "短影剪輯", code: "SHORT_VIDEO_EDIT", cell: ep["短影片完稿"] },
      { name: "短影腳本", code: "SHORT_SCRIPT", cell: ep["短影腳本"] },
      { name: "資訊欄撰寫", code: "SHOWNOTES", cell: ep["資訊欄"] },
    ];
    for (const [i, def] of woDefs.entries()) {
      // skip short script rows that are clearly N/A with only x and no date work - still create for tracking
      const status = woStatusFromCue(def.cell);
      const woId = `${programId}-WO-${season}-${epNo}-${def.code}`;
      const idem = `${epId}|${def.name}|1`;
      r = await insertIgnore("pc_work_orders", {
        id: woId,
        program_id: programId,
        episode_id: epId,
        service_name: def.name,
        service_code: def.code,
        unit_seq: 1,
        workorder_kind: def.code === "SHORT_SCRIPT" ? "PRE_PRODUCTION" : "POST_PRODUCTION",
        assignee_name: editor,
        status,
        prereq_status: status === "等待前置" ? "等待前置" : "已解鎖",
        client_billable: true,
        vendor_payable: Boolean(editor),
        included_revisions: 2,
        revision_round: 0,
        review_status: status === "已完成" ? "通過" : "未送審",
        idempotency_key: idem,
      });
      if (r.inserted) woIns += 1;
      void i;
    }

    const uploaded = isDoneMark(ep["上架"]);
    r = await insertIgnore("pc_upload_checklist", {
      id: `${programId}-UP-${season}-${epNo}`,
      episode_id: epId,
      program_id: programId,
      status: uploaded ? "已上架" : "未準備",
      title_confirmed: Boolean(guest),
      upload_note: guest || null,
    });
    if (r.inserted) upIns += 1;
  }

  // program-level cover WO once
  r = await insertIgnore("pc_work_orders", {
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
  });
  if (r.inserted) woIns += 1;

  if (!DRY) {
    await sb.from("pc_operation_logs").insert({
      action_type: "Cue表匯入",
      actor_email: "import-script",
      program_id: programId,
      entity_type: "pc_programs",
      entity_id: programId,
      status: "成功",
      note: `episodes+${epIns} wo+${woIns} upload+${upIns}`,
    });
  }

  console.log(`  done: episodes+${epIns} work_orders+${woIns} uploads+${upIns}`);
  return { epIns, woIns, upIns };
}

async function main() {
  const manifestPath = join(IMPORT_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error("缺少 data/pc-import/manifest.json");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const projects = manifest.projects ?? [];
  if (!projects.length) {
    console.error("manifest.projects 為空");
    process.exit(1);
  }
  console.log(`匯入 ${projects.length} 個專案${DRY ? "（dry-run）" : ""}`);
  for (const p of projects) {
    try {
      await importProject(p);
    } catch (e) {
      console.error(`✗ ${p.program_name}:`, e.message ?? e);
    }
  }
  console.log("\n完成。之後新專案：把 CSV 放到 data/pc-import/，並在 manifest.json 加一筆即可。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
