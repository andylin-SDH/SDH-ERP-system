/**
 * Supabase 服務端客戶端（用於 API routes、Server Components）
 * 使用 service_role key，具完整權限
 * 延遲初始化，避免 build 時因未設定 env 失敗
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY");
  }
  _client = createClient(url, key);
  return _client;
}
