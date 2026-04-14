/**
 * Users 資料層（Supabase）
 * 支援兩種欄位命名：英文 email/name/password 或 中文 帳號/姓名/密碼
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import type { User } from "@/lib/types";

/** 從 DB 列轉成 User（相容 帳號/姓名 或 email/name） */
function rowToUser(r: Record<string, unknown>): User {
  const email = (r["email"] ?? r["帳號"] ?? "") as string;
  const name = (r["name"] ?? r["姓名"] ?? "") as string;
  const role = (r["role"] ?? r["角色"] ?? "") as string;
  const dept = (r["dept"] ?? r["部門"] ?? "") as string;
  const scope = r["scope"] as string | undefined;
  const activeFlag = (r["active_flag"] ?? false) as boolean;
  return { email, name, role, dept, scope, activeFlag };
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: string;
  dept?: string;
  scope?: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: string;
  dept?: string;
  scope?: string;
  password?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser(payload: CreateUserInput): Promise<User> {
  const email = String(payload.email ?? "").trim().toLowerCase();
  const name = String(payload.name ?? "").trim();
  const password = String(payload.password ?? "").trim();
  const role = String(payload.role ?? "").trim();
  if (!email || !name || !password || !role) {
    throw new Error("帳號、姓名、密碼、角色為必填");
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new Error("帳號必須為有效的 Email 格式（供發信通知使用）");
  }
  const supabase = getSupabase();
  const insertEn = {
    email,
    name: name || email,
    password,
    role: role || "經紀人",
    dept: payload.dept?.trim() || null,
    scope: payload.scope?.trim() || null,
    active_flag: true,
  };
  const insertZh = {
    帳號: email,
    姓名: name || email,
    密碼: password,
    角色: role || "經紀人",
    部門: payload.dept?.trim() || null,
    scope: payload.scope?.trim() || null,
    active_flag: true,
  };
  const { data: dataEn, error: errEn } = await supabase.from("users").insert(insertEn).select("email, name, role, dept, scope, active_flag").maybeSingle();
  if (!errEn && dataEn) {
    log("users.db", "createUser 成功（英文欄位）", { email });
    return rowToUser(dataEn as unknown as Record<string, unknown>);
  }
  const { data, error } = await supabase
    .from("users")
    .insert(insertZh)
    // Supabase select parser 對中文欄位需加上雙引號
    .select('"帳號","姓名","角色","部門","scope","active_flag"')
    .maybeSingle();
  if (error) {
    log("users.db", "createUser 失敗", { error: String(error?.message) });
    throw error;
  }
  log("users.db", "createUser 成功（中文欄位）", { email });
  return rowToUser(data as unknown as Record<string, unknown>);
}

/** 依 email（帳號）更新使用者資料，支援中英文欄位 */
export async function updateUser(email: string, payload: UpdateUserInput): Promise<User | null> {
  const raw = normalizeEmail(email);
  if (!raw) return null;

  const supabase = getSupabase();
  const updatesEn: Record<string, unknown> = {};
  if (payload.name !== undefined) updatesEn.name = payload.name.trim();
  if (payload.role !== undefined) updatesEn.role = payload.role.trim();
  if (payload.dept !== undefined) updatesEn.dept = payload.dept?.trim() || null;
  if (payload.scope !== undefined) updatesEn.scope = payload.scope?.trim() || null;
  if (payload.password !== undefined && payload.password.trim()) updatesEn.password = payload.password.trim();

  const updatesZh: Record<string, unknown> = {};
  if (payload.name !== undefined) updatesZh.姓名 = payload.name.trim();
  if (payload.role !== undefined) updatesZh.角色 = payload.role.trim();
  if (payload.dept !== undefined) updatesZh.部門 = payload.dept?.trim() || null;
  if (payload.scope !== undefined) updatesZh.scope = payload.scope?.trim() || null;
  if (payload.password !== undefined && payload.password.trim()) updatesZh.密碼 = payload.password.trim();

  const { data: dataEn, error: errEn } = await supabase
    .from("users")
    .update(updatesEn)
    .eq("email", raw)
    .select("email, name, role, dept, scope, active_flag")
    .maybeSingle();

  if (!errEn && dataEn) {
    log("users.db", "updateUser 成功（英文欄位）", { email: raw?.slice(0, 25) });
    return rowToUser(dataEn as unknown as Record<string, unknown>);
  }

  const { data: dataZh, error } = await supabase
    .from("users")
    .update(updatesZh)
    .eq("帳號", raw)
    // Supabase select parser 對中文欄位需加上雙引號
    .select('"帳號","姓名","角色","部門","scope","active_flag"')
    .maybeSingle();

  if (error) {
    log("users.db", "updateUser 失敗", { error: String(error?.message) });
    throw error;
  }
  if (!dataZh) return null;
  log("users.db", "updateUser 成功（中文欄位）", { email: raw?.slice(0, 25) });
  return rowToUser(dataZh as unknown as Record<string, unknown>);
}

/**
 * 更新登入密碼：對 email／帳號 × password／密碼 盡量雙寫，避免只命中一種欄位組合時 UPDATE 0 列或只改一欄導致驗證／登入異常。
 * 最後以 verifyCredentials 確認新密碼可登入。
 */
export async function updateUserPassword(email: string, newPassword: string): Promise<User | null> {
  const raw = normalizeEmail(email);
  const p = String(newPassword ?? "").trim();
  if (!raw || !p) return null;

  const supabase = getSupabase();
  /** 同時寫入 password 與「密碼」，避免一欄為空字串時 verify 仍讀到舊值 */
  const attempts: Array<{ label: string; promise: PromiseLike<{ error: { message: string } | null }> }> = [
    { label: "both+email", promise: supabase.from("users").update({ password: p, 密碼: p }).eq("email", raw) },
    { label: "both+帳號", promise: supabase.from("users").update({ password: p, 密碼: p }).eq("帳號", raw) },
    { label: "password+email", promise: supabase.from("users").update({ password: p }).eq("email", raw) },
    { label: "密碼+帳號", promise: supabase.from("users").update({ 密碼: p }).eq("帳號", raw) },
    { label: "密碼+email", promise: supabase.from("users").update({ 密碼: p }).eq("email", raw) },
    { label: "password+帳號", promise: supabase.from("users").update({ password: p }).eq("帳號", raw) },
  ];

  for (const { label, promise } of attempts) {
    const { error } = await promise;
    if (error) {
      log("users.db", `updateUserPassword ${label}`, { error: String(error.message) });
    }
  }

  const ok = await verifyCredentials(raw, p);
  if (!ok) {
    log("users.db", "updateUserPassword 寫入後驗證失敗", { raw: raw.slice(0, 25) });
    return null;
  }
  return getUserByEmail(raw);
}

export async function getUsers(): Promise<User[]> {
  const supabase = getSupabase();
  const { data: dataEn, error: errEn } = await supabase
    .from("users")
    .select("email, name, role, dept, scope, active_flag")
    .eq("active_flag", true)
    .order("email");
  if (!errEn && dataEn?.length) {
    return (dataEn ?? []).map((r) => rowToUser(r as unknown as Record<string, unknown>));
  }
  const { data, error } = await supabase
    .from("users")
    // Supabase select parser 對中文欄位需加上雙引號
    .select('"帳號","姓名","角色","部門","scope","active_flag"')
    .eq("active_flag", true)
    .order("帳號");
  if (error) throw error;
  return (data ?? []).map((r) => rowToUser(r as unknown as Record<string, unknown>));
}

function normalizeEmail(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function decodeEmail(value: string): string {
  let s = String(value ?? "").trim();
  try {
    while (s !== decodeURIComponent(s)) s = decodeURIComponent(s);
  } catch {
    /* 非 encoded 則略過 */
  }
  return s;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const decoded = decodeEmail(email);
  const raw = normalizeEmail(decoded);
  log("users.db", "getUserByEmail 輸入", { email: email?.slice(0, 30), decoded: decoded?.slice(0, 30), raw: raw?.slice(0, 30) });
  if (!raw) {
    log("users.db", "getUserByEmail 略過：email 為空", {});
    return null;
  }

  const supabase = getSupabase();
  const { data: dataEn, error: errEn } = await supabase
    .from("users")
    .select("email, name, role, dept, scope, active_flag")
    .eq("email", raw)
    .maybeSingle();
  if (!errEn && dataEn) {
    const foundRecord = dataEn as unknown as Record<string, unknown>;
    log("users.db", "getUserByEmail 找到使用者（英文欄位）", {
      email: foundRecord.email,
      role: foundRecord.role,
    });
    return rowToUser(foundRecord);
  }
  if (errEn) {
    log("users.db", "getUserByEmail 英文查詢錯誤（改試中文帳號）", { error: String(errEn?.message) });
  } else {
    log("users.db", "getUserByEmail 英文欄位無列，改試帳號", { raw });
  }
  const { data: dataZh, error: errZh } = await supabase
    .from("users")
    // Supabase select parser 對中文欄位需加上雙引號
    .select('"帳號","姓名","角色","部門","scope","active_flag"')
    .eq("帳號", raw)
    .maybeSingle();
  if (errZh) {
    log("users.db", "getUserByEmail 查詢錯誤", { error: String(errZh?.message) });
    throw errZh;
  }
  if (!dataZh) {
    log("users.db", "getUserByEmail 中文欄位未找到", { raw });
    return null;
  }
  const foundRecord = dataZh as unknown as Record<string, unknown>;
  log("users.db", "getUserByEmail 找到使用者（中文欄位）", {
    email: foundRecord["帳號"],
    role: foundRecord["角色"],
  });
  return rowToUser(foundRecord);
}

export async function verifyCredentials(
  email: string,
  password: string
): Promise<User | null> {
  const rawEmail = email.trim().toLowerCase();
  const rawPassword = password.trim();
  log("users.db", "verifyCredentials 輸入", { emailLen: rawEmail?.length, hasPassword: !!rawPassword });
  if (!rawEmail || !rawPassword) {
    log("users.db", "verifyCredentials 略過：email 或密碼為空", {});
    return null;
  }

  const supabase = getSupabase();
  let data: Record<string, unknown> | null = null;
  /** 須同時帶 password 與「密碼」：舊資料可能只寫入中文欄位，僅查 password 會比對失敗 */
  const { data: dataEn, error: errEn } = await supabase
    .from("users")
    .select('email, name, role, dept, scope, password, active_flag, "密碼"')
    .eq("email", rawEmail)
    .maybeSingle();
  if (!errEn && dataEn) {
    data = dataEn as unknown as Record<string, unknown>;
  }
  if (!data) {
    const { data: dataZh, error } = await supabase
      .from("users")
      // 中文欄位資料表可能沒有 password 欄位，避免 select 觸發「column users.password does not exist」
      .select('"帳號","姓名","角色","部門","scope","密碼","active_flag"')
      .eq("帳號", rawEmail)
      .maybeSingle();
    if (error) {
      log("users.db", "verifyCredentials 查詢錯誤", { error: String(error?.message) });
      throw error;
    }
    data = dataZh as unknown as Record<string, unknown> | null;
  }
  if (!data) {
    log("users.db", "verifyCredentials 未找到使用者", { rawEmail: rawEmail?.slice(0, 25) });
    return null;
  }
  /** password 若為空字串，?? 不會改取「密碼」，須兩欄併用 */
  const storedPwd =
    String(data.password ?? "").trim() || String(data.密碼 ?? "").trim();
  if (storedPwd !== rawPassword) {
    log("users.db", "verifyCredentials 密碼不符", { rawEmail: rawEmail?.slice(0, 25) });
    return null;
  }
  log("users.db", "verifyCredentials 成功", { email: data.email ?? data.帳號, role: data.role ?? data.角色 });
  return rowToUser(data);
}

/**
 * 從 姓名 或 email 解析出使用者的 email（供寄送任務指派通知用）
 * - 若輸入含 @，視為 email，直接查詢
 * - 否則視為姓名，從 users 中比對 姓名 或 帳號 取得 email
 */
export async function getEmailByNameOrEmail(nameOrEmail: string): Promise<string | null> {
  const s = String(nameOrEmail ?? "").trim();
  if (!s) return null;
  if (s.includes("@")) {
    const u = await getUserByEmail(s);
    return u?.email ?? null;
  }
  const users = await getUsers();
  const found = users.find(
    (u) =>
      (u.name && String(u.name).trim().toLowerCase() === s.toLowerCase()) ||
      (u.email && String(u.email).trim().toLowerCase() === s.toLowerCase())
  );
  return found?.email ?? null;
}
