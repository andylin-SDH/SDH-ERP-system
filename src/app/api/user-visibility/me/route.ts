/** 強制動態執行 */
export const dynamic = "force-dynamic";

/**
 * 取得「目前登入者」自己的可見範圍
 * 供 Dashboard 載入時過濾顯示
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail } from "@/modules/users";
import { getUserVisibility } from "@/lib/db/user-visibility";
import { getSectionsForRole } from "@/lib/db/system-config";
import { TABLE_KEYS } from "@/config/table-columns";

const COOKIE_NAME = "erp_email";

function getEmailFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  let value = match[1].trim();
  try {
    while (value !== decodeURIComponent(value)) value = decodeURIComponent(value);
  } catch {
    /* ignore */
  }
  return value || null;
}

export async function GET(request: NextRequest) {
  const email = getEmailFromCookie(request.headers.get("cookie"));
  if (!email) {
    return NextResponse.json({ ok: false, error: "未登入" }, { status: 401 });
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return NextResponse.json({ ok: false, error: "找不到使用者" }, { status: 404 });
  }
  if (String(user.role ?? "").trim() === "KOL") {
    return NextResponse.json(
      { ok: false, error: "KOL 帳號僅可使用老師專屬入口（/kol）" },
      { status: 403 }
    );
  }

  const visibility = await getUserVisibility(email);
  if (visibility && visibility.tables.length > 0) {
    return NextResponse.json({
      ok: true,
      tables: visibility.tables,
      columns: visibility.columns,
      overview_kpis: visibility.overview_kpis,
      source: "custom",
    });
  }

  const roleSections = await getSectionsForRole(user.role);
  const defaultTables = TABLE_KEYS.filter((t) => {
    const map: Record<string, string> = { master: "master", partners: "partners", tasks: "tasks" };
    return roleSections.includes(map[t] ?? t);
  });
  return NextResponse.json({
    ok: true,
    tables: defaultTables,
    columns: {},
    overview_kpis: visibility?.overview_kpis ?? null,
    source: "role",
  });
}
