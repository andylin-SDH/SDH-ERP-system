/**
 * SDH ERP 對外正式網域（收款連結、通知信）。
 * 勿使用 Vercel 預覽網址（*-team.vercel.app）；可被 NEXT_PUBLIC_APP_URL 覆寫。
 */
export const SDH_PUBLIC_APP_ORIGIN = "https://erp.sdh-corp.com";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function normalizeOrigin(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return stripTrailingSlash(t.startsWith("http") ? t : `https://${t}`);
}

function hostFromUrlOrHost(raw: string): string {
  const t = raw.trim().replace(/^https?:\/\//, "");
  return t.split("/")[0]?.toLowerCase() ?? "";
}

/** Vercel 預覽部署網址（含 hash、team 名稱），不可給匯款方 */
function isVercelPreviewHost(host: string): boolean {
  const h = hostFromUrlOrHost(host);
  if (!h.endsWith(".vercel.app")) return false;
  // 專案正式 *.vercel.app 別名可接受；其餘 *.vercel.app 皆視為 preview
  if (h === "sdh-erp-system.vercel.app") return false;
  return true;
}

/** 應用程式根 URL（郵件連結、收款連結、登入後導向用） */
export function getAppBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return normalizeOrigin(fromEnv);

  // Vercel 預覽／分支部署：固定用正式網域
  if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
    return SDH_PUBLIC_APP_ORIGIN;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    if (isVercelPreviewHost(vercelUrl)) return SDH_PUBLIC_APP_ORIGIN;
    return normalizeOrigin(vercelUrl);
  }

  return "http://localhost:3000";
}

/** 任務／專案通知信：直達 Dashboard 並帶 query 開啟對應專案（與任務） */
export function buildDashboardTaskDeepLink(params: {
  projectId: string;
  taskId?: string | null;
}): string {
  const projectId = String(params.projectId ?? "").trim();
  const qs = new URLSearchParams();
  if (projectId) qs.set("project", projectId);
  const taskId = String(params.taskId ?? "").trim();
  if (taskId) qs.set("task", taskId);
  const query = qs.toString();
  return `${getAppBaseUrl()}/dashboard${query ? `?${query}` : ""}`;
}

/** 登入頁：解析登入成功後應導向的路徑（僅允許站內相對路徑） */
export function resolvePostLoginPath(searchParams: URLSearchParams): string {
  const next = searchParams.get("next")?.trim();
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;

  const project = searchParams.get("project")?.trim();
  if (project) {
    const qs = new URLSearchParams({ project });
    const task = searchParams.get("task")?.trim();
    if (task) qs.set("task", task);
    return `/dashboard?${qs.toString()}`;
  }

  return "/dashboard";
}
