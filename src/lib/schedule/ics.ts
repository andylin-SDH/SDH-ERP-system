/** 公開 iCal 解析。只處理 Google 日曆匯出會用到的重複規則。 */

const DAY_MS = 86400000;
const TZ_MS = 8 * 3600000;
const TZ_OFFSETS: Record<string, number> = {
  UTC: 0,
  "Etc/UTC": 0,
  GMT: 0,
  "Asia/Taipei": TZ_MS,
  "Asia/Shanghai": TZ_MS,
  "Asia/Hong_Kong": TZ_MS,
  "Asia/Singapore": TZ_MS,
  "Asia/Tokyo": 9 * 3600000,
};
const DAYCODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type IcsDate = { ms: number; allDay: boolean };
type IcsEvent = {
  uid?: string;
  title?: string;
  text?: string;
  status?: string;
  start?: IcsDate;
  end?: IcsDate;
  duration?: number | null;
  rrule?: Record<string, unknown>;
  recurrenceId?: IcsDate;
  exdates: IcsDate[];
  extra: string[];
};

function unfold(text: string): string {
  return String(text).replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeText(value: string): string {
  return String(value).replace(/\\[nN]/g, "\n").replace(/\\([,;\\])/g, "$1");
}

function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') {
      quoted = !quoted;
      cur += ch;
    } else if (ch === ";" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function parseDate(value: string, params: Record<string, string>): IcsDate | null {
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (match) return { ms: Date.UTC(+match[1], +match[2] - 1, +match[3]) - TZ_MS, allDay: true };
  match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match) return null;
  const utc = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
  if (match[7] === "Z") return { ms: utc, allDay: false };
  const tz = params.TZID;
  const off = tz && TZ_OFFSETS[tz] !== undefined ? TZ_OFFSETS[tz] : TZ_MS;
  return { ms: utc - off, allDay: false };
}

function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const ms = ((+match[2] || 0) * 7 + (+match[3] || 0)) * DAY_MS + ((+match[4] || 0) * 3600 + (+match[5] || 0) * 60 + (+match[6] || 0)) * 1000;
  return match[1] === "-" ? -ms : ms;
}

function parseRrule(value: string): Record<string, unknown> {
  const rule: Record<string, unknown> = {};
  for (const kv of value.split(";")) {
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    const key = kv.slice(0, eq).toUpperCase();
    const raw = kv.slice(eq + 1);
    if (key === "FREQ") rule.FREQ = raw.toUpperCase();
    else if (key === "INTERVAL") rule.INTERVAL = Math.max(1, +raw || 1);
    else if (key === "COUNT") rule.COUNT = +raw;
    else if (key === "UNTIL") rule.UNTIL = parseDate(raw, {});
    else if (key === "BYDAY") rule.BYDAY = raw.split(",").map((item) => item.toUpperCase());
    else if (key === "BYMONTHDAY") rule.BYMONTHDAY = raw.split(",").map(Number);
    else if (key === "BYMONTH") rule.BYMONTH = raw.split(",").map(Number);
  }
  return rule;
}

function parseEvents(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: IcsEvent | null = null;
  for (const line of unfold(text).split("\n")) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: [], extra: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const parsed = splitLine(line);
    if (!parsed) continue;
    switch (parsed.name) {
      case "UID":
        cur.uid = parsed.value;
        break;
      case "SUMMARY":
        cur.title = unescapeText(parsed.value);
        break;
      case "DESCRIPTION":
        cur.text = unescapeText(parsed.value);
        break;
      case "STATUS":
        cur.status = parsed.value.toUpperCase();
        break;
      case "DTSTART":
        cur.start = parseDate(parsed.value, parsed.params) ?? undefined;
        break;
      case "DTEND":
        cur.end = parseDate(parsed.value, parsed.params) ?? undefined;
        break;
      case "DURATION":
        cur.duration = parseDuration(parsed.value);
        break;
      case "RRULE":
        cur.rrule = parseRrule(parsed.value);
        break;
      case "RECURRENCE-ID":
        cur.recurrenceId = parseDate(parsed.value, parsed.params) ?? undefined;
        break;
      case "EXDATE":
        for (const value of parsed.value.split(",")) {
          const date = parseDate(value, parsed.params);
          if (date) cur.exdates.push(date);
        }
        break;
      case "ORGANIZER":
      case "ATTENDEE": {
        const mail = /^mailto:(.+)$/i.exec(parsed.value);
        if (mail) cur.extra.push(mail[1]);
        if (parsed.params.CN) cur.extra.push(parsed.params.CN);
        break;
      }
      default:
        break;
    }
  }
  return events;
}

function localDay(ms: number): number {
  return Math.floor((ms + TZ_MS) / DAY_MS);
}

function civil(day: number) {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), wd: date.getUTCDay() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ruleMatches(rule: Record<string, unknown>, day: number, startDay: number): boolean {
  const interval = (rule.INTERVAL as number) || 1;
  const current = civil(day);
  const start = civil(startDay);
  const wdOf = (code: string) => DAYCODES[code.replace(/^[+-]?\d+/, "")];
  const byWd = ((rule.BYDAY as string[]) || []).map(wdOf);
  if (rule.FREQ === "DAILY") {
    if ((day - startDay) % interval !== 0) return false;
    return !byWd.length || byWd.includes(current.wd);
  }
  if (rule.FREQ === "WEEKLY") {
    const weekStartDay = startDay - ((start.wd + 6) % 7);
    const weekIndex = Math.floor((day - weekStartDay) / 7);
    if (weekIndex % interval !== 0) return false;
    return (byWd.length ? byWd : [start.wd]).includes(current.wd);
  }
  const months = (current.y - start.y) * 12 + (current.m - start.m);
  if (rule.FREQ === "MONTHLY") {
    if (months % interval !== 0) return false;
    if (rule.BYMONTHDAY) {
      const dim = daysInMonth(current.y, current.m);
      return (rule.BYMONTHDAY as number[]).some((n) => (n > 0 ? n === current.d : dim + n + 1 === current.d));
    }
    if (rule.BYDAY) {
      const dim = daysInMonth(current.y, current.m);
      return (rule.BYDAY as string[]).some((code) => {
        const match = /^([+-]?\d+)?([A-Z]{2})$/.exec(code);
        if (!match || DAYCODES[match[2]] !== current.wd) return false;
        if (!match[1]) return true;
        const n = +match[1];
        return n > 0 ? Math.ceil(current.d / 7) === n : Math.floor((dim - current.d) / 7) + 1 === -n;
      });
    }
    return current.d === start.d;
  }
  if (rule.FREQ === "YEARLY") {
    if ((current.y - start.y) % interval !== 0) return false;
    const monthOk = ((rule.BYMONTH as number[]) || [start.m]).includes(current.m);
    const dayOk = rule.BYMONTHDAY ? (rule.BYMONTHDAY as number[]).includes(current.d) : current.d === start.d;
    return monthOk && dayOk;
  }
  return false;
}

function occKey(uid: string, date: IcsDate): string {
  return `${uid}|${date.allDay ? `d${localDay(date.ms)}` : date.ms}`;
}

function occurrences(ev: IcsEvent, rangeStart: number, rangeEnd: number, overrides: Record<string, boolean>) {
  if (!ev.start) return [];
  const start = ev.start.ms;
  const end = ev.end
    ? ev.end.ms
    : ev.duration !== undefined && ev.duration !== null
      ? start + ev.duration
      : ev.start.allDay
        ? start + DAY_MS
        : start;
  const dur = Math.max(0, end - start);
  const hits = (s: number, e: number) => s < rangeEnd && (e > rangeStart || (e === s && s >= rangeStart));
  if (!ev.rrule) return hits(start, start + dur) ? [{ start, end: start + dur }] : [];
  const rule = ev.rrule;
  const untilDate = rule.UNTIL as IcsDate | undefined;
  const until = untilDate ? (untilDate.allDay ? untilDate.ms + DAY_MS - 1 : untilDate.ms) : Infinity;
  const startDay = localDay(start);
  const timeOfDay = start - (startDay * DAY_MS - TZ_MS);
  const lastDay = localDay(Math.min(rangeEnd, until));
  const out: { start: number; end: number }[] = [];
  let count = 0;
  for (let day = startDay; day <= lastDay && day - startDay < 40000; day++) {
    if (!ruleMatches(rule, day, startDay)) continue;
    const s = day * DAY_MS - TZ_MS + timeOfDay;
    if (s > until) break;
    count++;
    if (rule.COUNT && count > (rule.COUNT as number)) break;
    if (!hits(s, s + dur)) continue;
    const probe = { ms: s, allDay: ev.start.allDay };
    const excluded = ev.exdates.some((item) => (item.allDay ? localDay(item.ms) === day : item.ms === s));
    if (excluded || (ev.uid && overrides[occKey(ev.uid, probe)])) continue;
    out.push({ start: s, end: s + dur });
  }
  return out;
}

export type ExpandedEvent = {
  title: string;
  text: string;
  emails: string[];
  start: Date;
  end: Date;
  allDay: boolean;
};

export function expandIcsEvents(text: string, rangeStart: Date, rangeEnd: Date): ExpandedEvent[] {
  const raw = parseEvents(text);
  const overrides: Record<string, boolean> = {};
  for (const event of raw) {
    if (event.recurrenceId && event.uid) overrides[occKey(event.uid, event.recurrenceId)] = true;
  }
  const out: ExpandedEvent[] = [];
  for (const event of raw) {
    if (!event.start || event.status === "CANCELLED") continue;
    for (const hit of occurrences(event, rangeStart.getTime(), rangeEnd.getTime(), overrides)) {
      out.push({
        title: event.title || "",
        text: event.text || "",
        emails: event.extra,
        start: new Date(hit.start),
        end: new Date(hit.end),
        allDay: event.start.allDay,
      });
    }
  }
  return out;
}
