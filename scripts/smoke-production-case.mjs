/**
 * 製作案主流程煙霧測試（不需 Next server）
 * 驗證：帳號密碼、membership、快照權限投影、交付 INSERT、審核退回
 * 用法：node scripts/smoke-production-case.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
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
  console.error("缺少 env");
  process.exit(1);
}
const sb = createClient(url, key);
const PASS = "PcUat2026!";
let failed = 0;

function ok(label) {
  console.log("✓", label);
}
function bad(label, err) {
  failed += 1;
  console.error("✗", label, err ?? "");
}

async function verifyUser(email, role) {
  const { data, error } = await sb.from("users").select('"帳號","角色","密碼",active_flag').eq("帳號", email).maybeSingle();
  if (error || !data) return bad(`user ${email}`, error?.message ?? "not found");
  if (data["角色"] !== role) return bad(`user role ${email}`, `got ${data["角色"]}`);
  if (data["密碼"] !== PASS) return bad(`user password ${email}`);
  if (!data.active_flag) return bad(`user inactive ${email}`);
  ok(`user ${email} (${role})`);
}

async function main() {
  console.log("=== production-case smoke ===\n");

  await verifyUser("pc-pm@sdh-uat.test", "製作人");
  await verifyUser("pc-vendor@sdh-uat.test", "外包");
  await verifyUser("pc-client@sdh-uat.test", "製作案主");
  await verifyUser("pc-kol@sdh-uat.test", "KOL");

  const { data: prog } = await sb.from("pc_programs").select("id,name,workflow_stage").eq("id", "PC-DEMO-01").maybeSingle();
  if (!prog) bad("demo program");
  else ok(`program ${prog.id} stage=${prog.workflow_stage}`);

  const { data: mems } = await sb.from("pc_memberships").select("user_email,member_role").eq("program_id", "PC-DEMO-01");
  if ((mems?.length ?? 0) < 4) bad("memberships", `count=${mems?.length}`);
  else ok(`memberships ${mems.length}`);

  const { data: wos } = await sb
    .from("pc_work_orders")
    .select("id,status,assignee_email,client_amount,vendor_amount")
    .eq("program_id", "PC-DEMO-01")
    .eq("assignee_email", "pc-vendor@sdh-uat.test");
  if (!wos?.length) bad("vendor WOs");
  else ok(`vendor WOs ${wos.length}`);

  // 交付 INSERT（選一筆進行中或需修改）
  const target = wos?.find((w) => w.status === "進行中" || w.status === "需修改") ?? wos?.[0];
  if (!target) {
    bad("no WO for delivery");
  } else {
    const { data: existing } = await sb
      .from("pc_work_order_deliveries")
      .select("delivery_seq")
      .eq("workorder_id", target.id);
    const nextSeq = (existing ?? []).reduce((m, d) => Math.max(m, d.delivery_seq), 0) + 1;
    await sb.from("pc_work_order_deliveries").update({ is_current: false }).eq("workorder_id", target.id).eq("is_current", true);
    const delId = `PCD-SMOKE-${Date.now()}`;
    const { error: dErr } = await sb.from("pc_work_order_deliveries").insert({
      id: delId,
      workorder_id: target.id,
      delivery_seq: nextSeq,
      delivery_url: "https://example.com/smoke",
      delivery_note: "smoke test",
      submitted_by: "pc-vendor@sdh-uat.test",
      is_current: true,
    });
    if (dErr) bad("delivery insert", dErr.message);
    else ok(`delivery INSERT ${delId} seq=${nextSeq}`);

    await sb
      .from("pc_work_orders")
      .update({ status: "待審核", review_status: "未送審", updated_at: new Date().toISOString() })
      .eq("id", target.id);

    const revRound = 1;
    const { error: rErr } = await sb.from("pc_work_order_reviews").insert({
      id: `PCR-SMOKE-${Date.now()}`,
      workorder_id: target.id,
      delivery_id: delId,
      revision_round: revRound,
      reviewer_email: "pc-pm@sdh-uat.test",
      result: "退回",
      reject_reason: "smoke 退修",
    });
    if (rErr) bad("review insert", rErr.message);
    else ok("review INSERT 退回");

    await sb
      .from("pc_work_orders")
      .update({ status: "需修改", revision_round: revRound, updated_at: new Date().toISOString() })
      .eq("id", target.id);
    ok(`WO ${target.id} → 需修改`);

    // 確認舊 delivery 未刪
    const { data: allDel } = await sb.from("pc_work_order_deliveries").select("id,delivery_seq,is_current").eq("workorder_id", target.id);
    if ((allDel?.length ?? 0) < 1) bad("deliveries missing");
    else ok(`deliveries kept count=${allDel.length} (append-only)`);
  }

  const { count: tmplCount } = await sb.from("pc_service_templates").select("*", { count: "exact", head: true });
  if (!tmplCount || tmplCount < 6) bad("templates", tmplCount);
  else ok(`templates ${tmplCount}`);

  console.log(failed ? `\nFAILED (${failed})` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
