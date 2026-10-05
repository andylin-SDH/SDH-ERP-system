import { SCHEDULE_CONFIG, STUDIO_CALENDARS } from "@/lib/schedule/config.server";
import { expandIcsEvents } from "@/lib/schedule/ics";
import { schedulePersonOf } from "@/lib/schedule/identity";
import {
  addDays,
  bookingSlots,
  buildDayInfo,
  classifyBooking,
  effectiveClaims,
  expandStoredClaims,
  findConflicts,
  isDateStr,
  mondayOf,
  presetClaims,
  weekDates,
  weekStats,
} from "@/lib/schedule/logic";
import type { FollowShow, ScheduleBooking, ScheduleClaim, ScheduleConfig, ScheduleWeekPayload } from "@/lib/schedule/types";
import { FollowTableMissingError, listFollowShowRecords } from "@/lib/db/follow-shows";
import { applyClaimRows, listClaimsBetween, ScheduleTableMissingError } from "@/lib/db/schedule";
import { planClaimChange, type ClaimChangeItem } from "@/lib/schedule/logic";

const CACHE_MS = 5 * 60 * 1000;
let calendarCache: { key: string; at: number; bookings: Omit<ScheduleBooking, "slots">[]; warnings: string[] } | null = null;

export function invalidateScheduleCalendarCache() {
  calendarCache = null;
}

async function configForWeek(): Promise<{ cfg: ScheduleConfig; warnings: string[] }> {
  try {
    const rows = await listFollowShowRecords();
    return { cfg: { ...SCHEDULE_CONFIG, FOLLOW_SHOWS: rows }, warnings: [] };
  } catch (error) {
    if (error instanceof FollowTableMissingError) {
      return { cfg: SCHEDULE_CONFIG, warnings: [error.message] };
    }
    throw error;
  }
}

function followKey(shows: FollowShow[]): string {
  return shows.map((show) => `${show.show}|${show.keywords.join(",")}|${(show.usuallyWith ?? []).join(",")}|${(show.codes ?? []).join(",")}`).join(";");
}

function publicConfig() {
  const meeting = SCHEDULE_CONFIG.RULES.mondayMeeting;
  return {
    people: SCHEDULE_CONFIG.PEOPLE,
    places: SCHEDULE_CONFIG.PLACES,
    periods: SCHEDULE_CONFIG.PERIODS,
    slots: SCHEDULE_CONFIG.SLOTS,
    followPerson: SCHEDULE_CONFIG.RULES.followPerson,
    backupPlaceId: SCHEDULE_CONFIG.RULES.backupPlaceId,
    offStaff: SCHEDULE_CONFIG.RULES.offHours.staff,
    mondayMeeting: meeting.enabled
      ? { start: meeting.start, end: meeting.end, placeId: meeting.placeId, label: meeting.label }
      : null,
    presetPeople: SCHEDULE_CONFIG.PRESETS.map((preset) => preset.person),
  };
}

async function loadBookings(weekStart: string, force: boolean, cfg: ScheduleConfig): Promise<{ bookings: ScheduleBooking[]; warnings: string[] }> {
  const now = Date.now();
  const cacheKey = `${weekStart}:${followKey(cfg.FOLLOW_SHOWS)}`;
  if (!force && calendarCache && calendarCache.key === cacheKey && now - calendarCache.at < CACHE_MS) {
    return {
      warnings: calendarCache.warnings,
      bookings: calendarCache.bookings.map((booking) => ({
        ...booking,
        slots: bookingSlots(weekStart, booking, SCHEDULE_CONFIG),
      })),
    };
  }
  const rangeStart = new Date(`${weekStart}T00:00:00${SCHEDULE_CONFIG.TZ_OFFSET}`);
  const rangeEnd = new Date(`${addDays(weekStart, 7)}T00:00:00${SCHEDULE_CONFIG.TZ_OFFSET}`);
  const warnings: string[] = [];
  const bookings: Omit<ScheduleBooking, "slots">[] = [];
  await Promise.all(
    STUDIO_CALENDARS.map(async (calendar) => {
      try {
        const response = await fetch(calendar.icsUrl, { cache: "no-store" });
        if (!response.ok) {
          warnings.push(`讀取「${calendar.name}」日曆失敗：HTTP ${response.status}`);
          return;
        }
        const text = await response.text();
        if (!text.includes("BEGIN:VCALENDAR")) {
          warnings.push(`讀取「${calendar.name}」日曆失敗：回傳的內容不是日曆檔`);
          return;
        }
        const events = expandIcsEvents(text, rangeStart, rangeEnd);
        if (events.length && events.every((event) => /^(busy|忙碌)$/i.test(event.title.trim()))) {
          warnings.push(`「${calendar.name}」日曆只公開了忙碌／空閒，看不到預約標題`);
        }
        for (const event of events) {
          const title = event.title || "（無標題）";
          const classified = classifyBooking(title, event.text, event.emails, cfg);
          bookings.push({
            calendar: calendar.name,
            placeId: calendar.placeId,
            color: calendar.color,
            title,
            start: event.start.toISOString(),
            end: event.end.toISOString(),
            kind: classified.kind,
            show: classified.show,
            owner: classified.owner,
            companions: classified.companions,
          });
        }
      } catch (error) {
        warnings.push(`讀取「${calendar.name}」日曆失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
      }
    })
  );
  bookings.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  if (!warnings.length) calendarCache = { key: cacheKey, at: now, bookings, warnings };
  return {
    warnings,
    bookings: bookings.map((booking) => ({
      ...booking,
      slots: bookingSlots(weekStart, booking, SCHEDULE_CONFIG),
    })),
  };
}

export function normalizeWeekStart(weekStart: string | null | undefined): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const raw = weekStart && isDateStr(weekStart) ? weekStart : today;
  return mondayOf(raw);
}

export async function buildScheduleWeek(
  weekStartInput: string | null | undefined,
  user: { name?: string | null; email?: string | null; role?: string | null },
  force = false
): Promise<ScheduleWeekPayload> {
  const weekStart = normalizeWeekStart(weekStartInput);
  const dates = weekDates(weekStart);
  const raw = expandStoredClaims(await listClaimsBetween(dates[0], addDays(dates[6], 1)), SCHEDULE_CONFIG);
  const holidays: Record<string, string> = {};
  for (const holiday of SCHEDULE_CONFIG.HOLIDAYS) holidays[holiday.date] = holiday.name || "假日";
  const follow = await configForWeek();
  const fetched = await loadBookings(weekStart, force, follow.cfg);
  const warnings = [...fetched.warnings, ...follow.warnings];
  const dayInfo = buildDayInfo(weekStart, holidays, SCHEDULE_CONFIG);
  const effective = effectiveClaims(weekStart, raw, fetched.bookings, dayInfo, SCHEDULE_CONFIG);
  return forViewer(
    {
      weekStart,
      dates,
      dayInfo,
      config: publicConfig(),
      claims: effective.claims,
      bookings: fetched.bookings,
      warnings,
      conflicts: findConflicts(weekStart, raw, fetched.bookings, dayInfo, SCHEDULE_CONFIG),
      stats: weekStats(weekStart, raw, dayInfo, SCHEDULE_CONFIG, fetched.bookings),
      meetings: effective.meetings,
    },
    user
  );
}

function forViewer(
  week: Omit<ScheduleWeekPayload, "me">,
  user: { name?: string | null; email?: string | null; role?: string | null }
): ScheduleWeekPayload {
  const person = schedulePersonOf(user);
  const canSeeAll = String(user.role ?? "") === "董事長" || person === "維尼";
  const me = { person, canEditAnyone: String(user.role ?? "") === "董事長", canSeeAll };
  if (canSeeAll) return { ...week, me };
  return {
    ...week,
    me,
    claims: person ? week.claims.filter((claim) => claim.person === person) : [],
    stats: person ? week.stats.filter((stat) => stat.name === person) : [],
    conflicts: person ? week.conflicts.filter((conflict) => conflict.message.includes(person)) : [],
  };
}

export async function changeScheduleClaims(
  weekStartInput: string,
  person: string,
  items: ClaimChangeItem[],
  on: boolean,
  user: { name?: string | null; email?: string | null; role?: string | null }
): Promise<ScheduleWeekPayload> {
  const weekStart = normalizeWeekStart(weekStartInput);
  assertCanEdit(person, user);
  if (!items.length) throw new Error("沒有要寫入的時段");
  if (items.length > 200) throw new Error("一次最多 200 個整點");
  const dates = weekDates(weekStart);
  const stored = await listClaimsBetween(dates[0], addDays(dates[6], 1));
  const current = expandStoredClaims(stored, SCHEDULE_CONFIG);
  const plan = planClaimChange(weekStart, person, items, on, items.length === 1, current, SCHEDULE_CONFIG);
  if (plan.error) throw new Error(plan.error);
  const same = (claim: { date: string; slot: string; place: string; person: string }, item: { date: string; slot: string; place: string }) =>
    claim.person === person && claim.date === item.date && claim.slot === item.slot && claim.place === item.place;
  const legacy = stored.filter(
    (claim) =>
      /^h\d{2}$/.test(claim.slot) &&
      claim.person === person &&
      expandStoredClaims([claim], SCHEDULE_CONFIG).some((slot) => items.some((item) => same(slot, item)))
  );
  const remove = [...plan.remove.filter((claim) => stored.some((row) => same(row, claim))), ...legacy];
  const add = on
    ? items
        .filter((item) => current.some((claim) => same(claim, item)) || plan.add.some((claim) => same(claim, item)))
        .filter((item) => !stored.some((claim) => same(claim, item)))
        .map((item) => ({ ...item, person }))
    : plan.add;
  await applyClaimRows(add, remove);
  return buildScheduleWeek(weekStart, user, false);
}

export async function applySchedulePresets(
  weekStartInput: string,
  user: { name?: string | null; email?: string | null; role?: string | null }
): Promise<ScheduleWeekPayload & { presetAdded: number }> {
  const weekStart = normalizeWeekStart(weekStartInput);
  const self = schedulePersonOf(user);
  const isChairman = String(user.role ?? "") === "董事長";
  const targets = SCHEDULE_CONFIG.PRESETS.map((preset) => preset.person);
  if (!isChairman && (!self || !targets.includes(self))) {
    throw new Error("只有董事長或本人可以預排");
  }
  const week = await buildScheduleWeek(weekStart, user, false);
  const dates = weekDates(weekStart);
  const current = expandStoredClaims(await listClaimsBetween(dates[0], addDays(dates[6], 1)), SCHEDULE_CONFIG);
  const planned = presetClaims(weekStart, current, week.bookings, week.dayInfo, SCHEDULE_CONFIG).filter(
    (claim) => isChairman || claim.person === self
  );
  const have = new Set(current.map((claim) => `${claim.date}|${claim.slot}|${claim.place}|${claim.person}`));
  const add = planned.filter((claim) => !have.has(`${claim.date}|${claim.slot}|${claim.place}|${claim.person}`));
  await applyClaimRows(add, []);
  const next = await buildScheduleWeek(weekStart, user, false);
  return { ...next, presetAdded: add.length };
}

function assertCanEdit(person: string, user: { name?: string | null; email?: string | null; role?: string | null }) {
  if (String(user.role ?? "") === "董事長") {
    if (!SCHEDULE_CONFIG.PEOPLE.some((item) => item.name === person)) throw new Error(`不認識這位人員：${person}`);
    return;
  }
  const self = schedulePersonOf(user);
  if (!self || self !== person) throw new Error("只能改自己的班");
}

export { ScheduleTableMissingError };
