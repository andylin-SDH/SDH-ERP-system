/**
 * Users 資料層（Supabase）
 * 支援兩種欄位命名：英文 email/name/password 或 中文 帳號/姓名/密碼
 */

import { getSupabase } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import type { User } from "@/lib/types";

/** 從 DB 列轉成 User（相容 帳號/姓名 或 email/name） */
function rowToUser(r: Record<string, unknown>): User {
  const email = (r.email ?? r.帳號 ?? "") as string;
  const name = (r.name ?? r.姓名 ?? "") as string;
  const role = (r.role ?? r.角色 ?? "") as string;
  const dept = (r.dept ?? r.部門 ?? "") as string;
  const scope = (r.scope ?? r.scope) as string | undefined;
  const activeFlag = (r.active_flag ?? r.active_flag ?? false) as boolean;
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
    return rowToUser(dataEn as Record<string, unknown>);
  }
  const { data, error } = await supabase.from("users").insert(insertZh).select("帳號, 姓名, 角色, 部門, scope, active_flag").maybeSingle();
  if (error) {
    log("users.db", "createUser 失敗", { error: String(error?.message) });
    throw error;
  }
  log("users.db", "createUser 成功（中文欄位）", { email });
  return rowToUser(data as Record<string, unknown>);
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
    return rowToUser(dataEn as Record<string, unknown>);
  }

  const { data: dataZh, error } = await supabase
    .from("users")
    .update(updatesZh)
    .eq("帳號", raw)
    .select("帳號, 姓名, 角色, 部門, scope, active_flag")
    .maybeSingle();

  if (error) {
    log("users.db", "updateUser 失敗", { error: String(error?.message) });
    throw error;
  }
  if (!dataZh) return null;
  log("users.db", "updateUser 成功（中文欄位）", { email: raw?.slice(0, 25) });
  return rowToUser(dataZh as Record<string, unknown>);
}

export async function getUsers(): Promise<User[]> {
  const supabase = getSupabase();
  const { data: dataEn, error: errEn } = await supabase
    .from("users")
    .select("email, name, role, dept, scope, active_flag")
    .eq("active_flag", true)
    .order("email");
  if (!errEn && dataEn?.length) {
    return (dataEn ?? []).map((r) => rowToUser(r as Record<string, unknown>));
  }
  const { data, error } = await supabase
    .from("users")
    .select("帳號, 姓名, 角色, 部門, scope, active_flag")
    .eq("active_flag", true)
    .order("帳號");
  if (error) throw error;
  return (data ?? []).map((r) => rowToUser(r as Record<string, unknown>));
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
    .select("email, name, role, dept, scope, active_flag");
  let list: Array<Record<string, unknown>> = [];
  let useAccount = false;
  if (!errEn && dataEn?.length) {
    list = (dataEn ?? []) as Array<Record<string, unknown>>;
  } else {
    const { data, error } = await supabase
      .from("users")
      .select("帳號, 姓名, 角色, 部門, scope, active_flag");
    if (error) {
      log("users.db", "getUserByEmail 查詢錯誤", { error: String(error?.message) });
      throw error;
    }
    list = (data ?? []) as Array<Record<string, unknown>>;
    useAccount = true;
  }
  const emailKey = useAccount ? "帳號" : "email";
  log("users.db", "getUserByEmail 查詢結果筆數", { count: list.length, useAccount });
  const found = list.find((r) => normalizeEmail(String(r[emailKey] ?? "")) === raw);
  if (!found) {
    log("users.db", "getUserByEmail 未找到符合的使用者", { raw });
    return null;
  }
  log("users.db", "getUserByEmail 找到使用者", { email: (found as Record<string, unknown>)[emailKey], role: found.role ?? found.角色 });
  return rowToUser(found);
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
  const { data: dataEn, error: errEn } = await supabase
    .from("users")
    .select("email, name, role, dept, scope, password, active_flag")
    .eq("email", rawEmail)
    .maybeSingle();
  if (!errEn && dataEn) {
    data = dataEn as Record<string, unknown>;
  }
  if (!data) {
    const { data: dataZh, error } = await supabase
      .from("users")
      .select("帳號, 姓名, 角色, 部門, scope, 密碼, active_flag")
      .eq("帳號", rawEmail)
      .maybeSingle();
    if (error) {
      log("users.db", "verifyCredentials 查詢錯誤", { error: String(error?.message) });
      throw error;
    }
    data = dataZh as Record<string, unknown> | null;
  }
  if (!data) {
    log("users.db", "verifyCredentials 未找到使用者", { rawEmail: rawEmail?.slice(0, 25) });
    return null;
  }
  const pwd = (data.password ?? data.密碼) as string;
  if (pwd !== rawPassword) {
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
