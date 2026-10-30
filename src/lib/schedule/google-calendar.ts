import { google } from "googleapis";
import path from "path";

export type StudioEvent = {
  title: string;
  text: string;
  emails: string[];
  start: Date;
  end: Date;
};

/** 用服務帳戶讀日曆全名。公開連結維持只顯示忙碌。 */
export async function listStudioEvents(keyFile: string, calendarId: string, rangeStart: Date, rangeEnd: Date): Promise<StudioEvent[]> {
  const resolved = path.isAbsolute(keyFile) ? keyFile : path.resolve(process.cwd(), keyFile);
  const auth = new google.auth.GoogleAuth({
    keyFile: resolved,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
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
