/** 應用程式根 URL（郵件連結、登入後導向用） */
export function getAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return raw.replace(/\/$/, "");
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
