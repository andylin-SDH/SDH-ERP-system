import fs from "fs";
import { google } from "googleapis";
import path from "path";

export type StudioEvent = {
  title: string;
  text: string;
  emails: string[];
  start: Date;
  end: Date;
};

type GoogleAuthOptions = ConstructorParameters<typeof google.auth.GoogleAuth>[0];

/**
 * 環境變數可填：
 * 1) 服務帳戶 JSON 字串（Vercel 用，整份貼上）
 * 2) 本機 JSON 檔路徑
 */
export function resolveGoogleAuthOptions(source: string): GoogleAuthOptions {
  const raw = source.trim();
  if (!raw) throw new Error("服務帳戶憑證是空的");

  if (raw.startsWith("{")) {
    try {
      return {
        credentials: JSON.parse(raw) as object,
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      };
    } catch {
      throw new Error("服務帳戶 JSON 格式錯誤");
    }
  }

  const resolved = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`找不到服務帳戶檔案：${path.basename(resolved)}`);
  }
  return {
    keyFile: resolved,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  };
}

/** 用服務帳戶讀日曆全名。公開連結維持只顯示忙碌。 */
export async function listStudioEvents(
  credentialsSource: string,
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<StudioEvent[]> {
  const auth = new google.auth.GoogleAuth(resolveGoogleAuthOptions(credentialsSource));
  const calendar = google.calendar({ version: "v3", auth });
  const events: StudioEvent[] = [];
  let pageToken: string | undefined;
  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500,
      pageToken,
    });
    for (const ev of res.data.items ?? []) {
      if (ev.status === "cancelled") continue;
      const startRaw = ev.start?.dateTime ?? ev.start?.date;
      const endRaw = ev.end?.dateTime ?? ev.end?.date;
      if (!startRaw || !endRaw) continue;
      const start = new Date(ev.start?.date ? `${startRaw}T00:00:00+08:00` : startRaw);
      const end = new Date(ev.end?.date ? `${endRaw}T00:00:00+08:00` : endRaw);
      events.push({
        title: ev.summary?.trim() || "（無標題）",
        text: ev.description ?? "",
        emails: (ev.attendees ?? []).map((person) => person.email ?? "").filter(Boolean),
        start,
        end,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return events;
}
