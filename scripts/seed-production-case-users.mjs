/**
 * 建立製作案 UAT 測試帳號（寫入 public.users；密碼皆為 PcUat2026!）
 * 用法：node scripts/seed-production-case-users.mjs
 * 需 .env.local 的 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * 本專案 users 表為中文欄位：帳號／姓名／角色／部門／密碼
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
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);
const PASSWORD = "PcUat2026!";

const users = [
  { email: "pc-pm@sdh-uat.test", name: "測試PM", role: "製作人", dept: "製作案UAT" },
  { email: "pc-vendor@sdh-uat.test", name: "測試外包", role: "外包", dept: "製作案UAT" },
  { email: "pc-client@sdh-uat.test", name: "測試案主", role: "製作案主", dept: "製作案UAT" },
  { email: "pc-kol@sdh-uat.test", name: "測試KOL", role: "KOL", dept: "製作案UAT" },
];

async function upsertUser(u) {
  const { data: existing, error: selErr } = await supabase
    .from("users")
    .select('"帳號"')
    .eq("帳號", u.email)
    .maybeSingle();
  if (selErr) throw selErr;

  const row = {
    帳號: u.email,
    姓名: u.name,
    角色: u.role,
    部門: u.dept,
    密碼: PASSWORD,
    active_flag: true,
  };

  if (existing) {
    const { error } = await supabase.from("users").update(row).eq("帳號", u.email);
    if (error) throw error;
    console.log("updated", u.email, u.role);
    return;
  }

  const { error } = await supabase.from("users").insert(row);
  if (error) throw error;
  console.log("inserted", u.email, u.role);
}

for (const u of users) {
  try {
    await upsertUser(u);
  } catch (e) {
    console.error("fail", u.email, e.message ?? e);
  }
}

console.log("\nUAT 密碼（全部相同）:", PASSWORD);
console.log("入口：");
console.log("  內部 PM → /dashboard 製作控管  ", users[0].email);
console.log("  外包     → /production-case/vendor ", users[1].email);
console.log("  案主     → /production-case/client ", users[2].email);
console.log("  KOL      → /production-case/kol    ", users[3].email);
