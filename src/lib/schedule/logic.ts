/**
 * 班表純邏輯，改寫自排班系統 Logic.gs。
 * 日期用 YYYY-MM-DD，時間以台灣時間計算。畫面上是早、午、晚；內部每 30 分鐘一格。
 */
import type {
  DayInfo,
  MeetingCell,
  ScheduleBooking,
  ScheduleClaim,
  ScheduleConfig,
  ScheduleConflict,
  ScheduleSlot,
  ScheduleStat,
} from "@/lib/schedule/types";

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

export function isDateStr(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function mondayOf(dateStr: string): string {
  const wd = weekdayOf(dateStr);
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}（週${WEEKDAY_NAMES[weekdayOf(dateStr)]}）`;
}

function slotOf(cfg: ScheduleConfig, id: string): ScheduleSlot | null {
  return cfg.SLOTS.find((slot) => slot.id === id) ?? null;
}

function slotIdx(cfg: ScheduleConfig, id: string): number {
  return cfg.SLOTS.findIndex((slot) => slot.id === id);
}

function periodOfSlot(cfg: ScheduleConfig, slotId: string): string {
  return slotOf(cfg, slotId)?.period ?? "";
}

function periodSlotIds(cfg: ScheduleConfig, periodId: string): string[] {
  return cfg.SLOTS.filter((slot) => slot.period === periodId).map((slot) => slot.id);
}

function slotGroups(cfg: ScheduleConfig, ids: string[]): string[][] {
  const idx = [...new Set(ids.map((id) => slotIdx(cfg, id)).filter((i) => i >= 0))].sort((a, b) => a - b);
  const groups: number[][] = [];
  let cur: number[] = [];
  for (const i of idx) {
    if (cur.length && i === cur[cur.length - 1] + 1) cur.push(i);
    else {
      if (cur.length) groups.push(cur);
      cur = [i];
    }
  }
  if (cur.length) groups.push(cur);
  return groups.map((group) => group.map((i) => cfg.SLOTS[i].id));
}

function slotsText(cfg: ScheduleConfig, ids: string[]): string {
  for (const period of cfg.PERIODS) {
    const all = periodSlotIds(cfg, period.id);
    if (all.length === ids.length && all.every((id) => ids.includes(id))) return period.label;
  }
  const first = slotOf(cfg, ids[0]);
  const last = slotOf(cfg, ids[ids.length - 1]);
  return `${first?.start ?? ""}–${last?.end ?? ""}`;
}

function whenText(cfg: ScheduleConfig, date: string, ids: string[]): string {
  const text = slotsText(cfg, ids);
  return formatDateLabel(date) + (/^\d/.test(text) ? " " : "") + text;
}

function placeById(cfg: ScheduleConfig, id: string) {
  return cfg.PLACES.find((place) => place.id === id) ?? null;
}

function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 舊資料是整點（h09＝09:00–10:00）。讀取時攤成現在的半小時，同一格不重複。 */
export function expandStoredClaims(claims: ScheduleClaim[], cfg: ScheduleConfig): ScheduleClaim[] {
  const seen = new Set<string>();
  const out: ScheduleClaim[] = [];
  for (const claim of claims) {
    const legacy = /^h(\d{2})$/.exec(claim.slot);
    const pieces: ScheduleClaim[] = [];
    if (!legacy) pieces.push(claim);
    else {
      const start = Number(legacy[1]) * 60;
      const end = start + 60;
      for (const slot of cfg.SLOTS) {
        const slotStart = clockMinutes(slot.start);
        const slotEnd = clockMinutes(slot.end);
        if (slotStart < end && start < slotEnd) pieces.push({ ...claim, slot: slot.id });
      }
      if (!pieces.length) pieces.push(claim);
    }
    for (const piece of pieces) {
      const key = `${piece.person}|${piece.date}|${piece.slot}|${piece.place}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  return out;
}

export function placeKind(cfg: ScheduleConfig, id: string): string {
  return placeById(cfg, id)?.kind ?? "";
}

function placeName(cfg: ScheduleConfig, id: string): string {
  return placeById(cfg, id)?.name ?? id;
}

export function buildDayInfo(weekStart: string, holidays: Record<string, string>, cfg: ScheduleConfig): Record<string, DayInfo> {
  const info: Record<string, DayInfo> = {};
  for (const date of weekDates(weekStart)) {
    const holiday = holidays[date] ?? "";
    const weekend = !cfg.RULES.workdays.includes(weekdayOf(date));
    info[date] = { workday: !weekend && !holiday, holiday, weekend };
  }
  return info;
}

function isOffHours(date: string, slotId: string, dayInfo: Record<string, DayInfo>, cfg: ScheduleConfig): boolean {
  return !dayInfo[date]?.workday || cfg.RULES.offHours.periods.includes(periodOfSlot(cfg, slotId));
}

function includesCI(hay: string, needle: string | undefined): boolean {
  return !!needle && hay.includes(String(needle).toLowerCase());
}

export function classifyBooking(
  title: string,
  text: string,
  emails: string[],
  cfg: ScheduleConfig
): { kind: "own" | "follow" | "other"; show: string; owner: string; companions: string[]; via?: string } {
  const body = `${title || ""} ${text || ""}`.toLowerCase();
  const hay = `${body} ${(emails || []).join(" ")}`.toLowerCase();
  for (const own of cfg.OWN_SHOWS) {
    if (includesCI(hay, own.code) || includesCI(hay, own.email)) {
      return { kind: "own", show: own.show, owner: own.owner, companions: [] };
    }
  }
  for (const follow of cfg.FOLLOW_SHOWS) {
    for (const keyword of follow.keywords) {
      if (includesCI(body, keyword)) {
        return { kind: "follow", show: follow.show, owner: "", companions: follow.usuallyWith ?? [], via: "keyword" };
      }
    }
    for (const code of follow.codes ?? []) {
      if (includesCI(body, code)) {
        return { kind: "follow", show: follow.show, owner: "", companions: follow.usuallyWith ?? [], via: "code" };
      }
    }
  }
  for (const own of cfg.OWN_SHOWS) {
    if (includesCI(body, own.show)) {
      return { kind: "own", show: own.show, owner: own.owner, companions: [] };
    }
  }
  return { kind: "other", show: "", owner: "", companions: [] };
}

function slotRange(dateStr: string, slot: ScheduleSlot, cfg: ScheduleConfig) {
  return {
    start: new Date(`${dateStr}T${slot.start}:00${cfg.TZ_OFFSET}`),
    end: new Date(`${dateStr}T${slot.end}:00${cfg.TZ_OFFSET}`),
  };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function bookingSlots(weekStart: string, booking: { start: string; end: string }, cfg: ScheduleConfig) {
  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const out: { date: string; slot: string }[] = [];
  for (const date of weekDates(weekStart)) {
    for (const slot of cfg.SLOTS) {
      const range = slotRange(date, slot, cfg);
      if (overlaps(start, end, range.start, range.end)) out.push({ date, slot: slot.id });
    }
  }
  return out;
}

function cellKey(date: string, slot: string, place: string): string {
  return `${date}|${slot}|${place}`;
}

function isMeetingBackupExempt(date: string, slotId: string, dayInfo: Record<string, DayInfo>, cfg: ScheduleConfig): boolean {
  const meeting = cfg.RULES.mondayMeeting;
  if (!meeting?.enabled || !meeting.exemptBackup || weekdayOf(date) !== meeting.weekday || !dayInfo[date]?.workday) return false;
  const slot = slotOf(cfg, slotId);
  return !!slot && slot.start < meeting.end && meeting.start < slot.end;
}

export function meetingCells(
  weekStart: string,
  dayInfo: Record<string, DayInfo>,
  cfg: ScheduleConfig,
  bookings: ScheduleBooking[] = [],
  claims: ScheduleClaim[] = []
): MeetingCell[] {
  const meeting = cfg.RULES.mondayMeeting;
  if (!meeting?.enabled) return [];
  const follower = cfg.RULES.followPerson;
  const out: MeetingCell[] = [];
  for (const date of weekDates(weekStart)) {
    if (weekdayOf(date) !== meeting.weekday || !dayInfo[date]?.workday) continue;
    for (const slot of cfg.SLOTS) {
      if (!(slot.start < meeting.end && meeting.start < slot.end)) continue;
      const excused: string[] = [];
      for (const booking of bookings) {
        if (booking.kind !== "follow") continue;
        if (!booking.slots.some((item) => item.date === date && item.slot === slot.id)) continue;
        if (!excused.includes(follower)) excused.push(follower);
        for (const name of booking.companions) {
          const atStudio = claims.some(
            (claim) => claim.person === name && claim.date === date && claim.slot === slot.id && claim.place === booking.placeId
          );
          if (atStudio && !excused.includes(name)) excused.push(name);
        }
      }
      out.push({
        date,
        slot: slot.id,
        placeId: meeting.placeId,
        label: meeting.label || "全員會議",
        start: meeting.start,
        end: meeting.end,
        excused,
      });
    }
  }
  return out;
}

export function effectiveClaims(
  weekStart: string,
  claims: ScheduleClaim[],
  bookings: ScheduleBooking[],
  dayInfo: Record<string, DayInfo>,
  cfg: ScheduleConfig
): { claims: ScheduleClaim[]; meetings: MeetingCell[] } {
  const follower = cfg.RULES.followPerson;
  const backupId = cfg.RULES.backupPlaceId;
  let base = claims.filter((claim) => !claim.auto);
  const atStudio: Record<string, boolean> = {};
  for (const claim of base) {
    if (claim.person === follower && placeKind(cfg, claim.place) === "studio") atStudio[`${claim.date}|${claim.slot}`] = true;
  }
  base = base.filter((claim) => !(claim.person === follower && claim.place === backupId && atStudio[`${claim.date}|${claim.slot}`]));
  const meetings = meetingCells(weekStart, dayInfo, cfg, bookings, base);
  const leave: Record<string, boolean> = {};
  for (const claim of base) {
    if (placeKind(cfg, claim.place) === "leave") leave[`${claim.person}|${claim.date}|${claim.slot}`] = true;
  }
  let out = base.slice();
  for (const meeting of meetings) {
    for (const person of cfg.PEOPLE) {
      if (meeting.excused.includes(person.name) || leave[`${person.name}|${meeting.date}|${meeting.slot}`]) continue;
      out = out.filter(
        (claim) =>
          !(
            claim.person === person.name &&
            claim.date === meeting.date &&
            claim.slot === meeting.slot &&
            claim.place !== meeting.placeId &&
            placeKind(cfg, claim.place) === "office"
          )
      );
      const has = out.some(
        (claim) => claim.person === person.name && claim.date === meeting.date && claim.slot === meeting.slot && claim.place === meeting.placeId
      );
      if (!has) out.push({ date: meeting.date, slot: meeting.slot, place: meeting.placeId, person: person.name, auto: true });
    }
  }
  return { claims: out, meetings };
}

export function weekStats(
  weekStart: string,
  claims: ScheduleClaim[],
  dayInfo: Record<string, DayInfo>,
  cfg: ScheduleConfig,
  bookings: ScheduleBooking[]
): ScheduleStat[] {
  const eff = effectiveClaims(weekStart, claims, bookings, dayInfo, cfg).claims;
  const dates = weekDates(weekStart);
  const regularSlots = cfg.SLOTS.filter((slot) => !cfg.RULES.offHours.periods.includes(slot.period));
  const per: Record<string, { officeDates: Record<string, boolean>; byPlace: Record<string, Record<string, boolean>>; studio: Record<string, boolean>; leave: Record<string, boolean> }> = {};
  const leave: Record<string, boolean> = {};
  for (const person of cfg.PEOPLE) per[person.name] = { officeDates: {}, byPlace: {}, studio: {}, leave: {} };
  for (const claim of eff) {
    const stat = per[claim.person];
    if (!stat) continue;
    const kind = placeKind(cfg, claim.place);
    if (kind === "leave") {
      stat.leave[`${claim.date}|${periodOfSlot(cfg, claim.slot)}`] = true;
      leave[`${claim.person}|${claim.date}|${claim.slot}`] = true;
    } else if (kind === "office") {
      stat.officeDates[claim.date] = true;
      stat.byPlace[claim.place] = stat.byPlace[claim.place] ?? {};
      stat.byPlace[claim.place][claim.date] = true;
    } else if (kind === "studio") {
      stat.studio[`${claim.date}|${claim.slot}|${claim.place}`] = true;
    }
  }
  return cfg.PEOPLE.map((person) => {
    const stat = per[person.name];
    const officeDates = Object.keys(stat.officeDates).sort();
    const required = person.minOfficeDays === undefined ? null : person.minOfficeDays;
    const available = dates.filter(
      (date) => dayInfo[date]?.workday && !regularSlots.every((slot) => leave[`${person.name}|${date}|${slot.id}`])
    ).length;
    const need = required === null ? null : Math.min(required, available);
    const byPlace: Record<string, number> = {};
    for (const place of cfg.PLACES) {
      if (place.kind === "office") byPlace[place.id] = Object.keys(stat.byPlace[place.id] ?? {}).length;
    }
    return {
      name: person.name,
      role: person.role || "",
      officeDays: officeDates.length,
      officeDates,
      byPlace,
      studioHours: Object.keys(stat.studio).length / 2,
      leaveSlots: Object.keys(stat.leave).length,
      required,
      need,
      adjusted: need !== null && required !== null && need < required,
      met: need === null ? null : officeDates.length >= need,
    };
  });
}

export function presetClaims(
  weekStart: string,
  claims: ScheduleClaim[],
  bookings: ScheduleBooking[],
  dayInfo: Record<string, DayInfo>,
  cfg: ScheduleConfig
): ScheduleClaim[] {
  const out: ScheduleClaim[] = [];
  const names = cfg.PEOPLE.map((person) => person.name);
  const have: Record<string, boolean> = {};
  const busy: Record<string, boolean> = {};
  const leave: Record<string, boolean> = {};
  const meetingSlot: Record<string, boolean> = {};
  for (const meeting of meetingCells(weekStart, dayInfo, cfg)) meetingSlot[`${meeting.date}|${meeting.slot}`] = true;
  for (const claim of claims.filter((item) => !item.auto)) {
    const key = `${claim.person}|${claim.date}|${claim.slot}`;
    if (placeKind(cfg, claim.place) === "leave") {
      leave[key] = true;
      continue;
    }
    have[`${key}|${claim.place}`] = true;
    busy[key] = true;
  }
  for (const preset of cfg.PRESETS) {
    if (!names.includes(preset.person) || !preset.joinCompanionShows) continue;
    for (const booking of bookings) {
      if (booking.kind !== "follow" || !booking.companions.includes(preset.person)) continue;
      for (const slot of booking.slots) {
        if (isOffHours(slot.date, slot.slot, dayInfo, cfg)) continue;
        const key = `${preset.person}|${slot.date}|${slot.slot}`;
        if (leave[key] || have[`${key}|${booking.placeId}`]) continue;
        if (busy[key] && !meetingSlot[`${slot.date}|${slot.slot}`]) continue;
        have[`${key}|${booking.placeId}`] = true;
        busy[key] = true;
        out.push({ date: slot.date, slot: slot.slot, place: booking.placeId, person: preset.person });
      }
    }
  }
  return out;
}

export function followGaps(
  weekStart: string,
  claims: ScheduleClaim[],
  bookings: ScheduleBooking[],
  dayInfo: Record<string, DayInfo>,
  cfg: ScheduleConfig
) {
  const eff = effectiveClaims(weekStart, claims, bookings, dayInfo, cfg);
  const follower = cfg.RULES.followPerson;
  const backupId = cfg.RULES.backupPlaceId;
  const cellPeople: Record<string, string[]> = {};
  for (const claim of eff.claims) {
    if (placeKind(cfg, claim.place) === "leave") continue;
    const key = cellKey(claim.date, claim.slot, claim.place);
    cellPeople[key] = cellPeople[key] ?? [];
    cellPeople[key].push(claim.person);
  }
  const byHour: Record<string, ScheduleBooking[]> = {};
  for (const booking of bookings) {
    if (booking.kind !== "follow") continue;
    for (const slot of booking.slots) {
      const key = `${slot.date}|${slot.slot}`;
      byHour[key] = byHour[key] ?? [];
      byHour[key].push(booking);
    }
  }
  const perDate: Record<string, string[]> = {};
  for (const key of Object.keys(byHour)) {
    const [date, slot] = key.split("|");
    if (isOffHours(date, slot, dayInfo, cfg) || isMeetingBackupExempt(date, slot, dayInfo, cfg)) continue;
    const others = (cellPeople[cellKey(date, slot, backupId)] ?? []).filter((person) => person !== follower);
    if (others.length) continue;
    perDate[date] = perDate[date] ?? [];
    perDate[date].push(slot);
  }
  const gaps: {
    date: string;
    slots: string[];
    bookings: ScheduleBooking[];
  }[] = [];
  for (const date of Object.keys(perDate).sort()) {
    for (const group of slotGroups(cfg, perDate[date])) {
      const list: ScheduleBooking[] = [];
      const seen: Record<string, boolean> = {};
      for (const slot of group) {
        for (const booking of byHour[`${date}|${slot}`] ?? []) {
          const key = `${booking.calendar}|${booking.title}|${booking.start}`;
          if (!seen[key]) {
            seen[key] = true;
            list.push(booking);
          }
        }
      }
      gaps.push({ date, slots: group, bookings: list });
    }
  }
  return gaps;
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function eachRange<T extends { slot: string }>(
  cfg: ScheduleConfig,
  items: T[],
  keyFn: (item: T) => string,
  fn: (first: T, ids: string[], group: T[]) => void
) {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(item);
  }
  for (const key of order) {
    const list = groups.get(key)!;
    for (const ids of slotGroups(cfg, list.map((item) => item.slot))) {
      fn(list[0], ids, list.filter((item) => ids.includes(item.slot)));
    }
  }
}

export function findConflicts(
  weekStart: string,
  rawClaims: ScheduleClaim[],
  bookings: ScheduleBooking[],
  dayInfo: Record<string, DayInfo>,
  cfg: ScheduleConfig
): ScheduleConflict[] {
  const eff = effectiveClaims(weekStart, rawClaims, bookings, dayInfo, cfg);
  const claims = eff.claims;
  const rules = cfg.RULES;
  const dates = weekDates(weekStart);
  const follower = rules.followPerson;
  const backupId = rules.backupPlaceId;
  const offStaff = rules.offHours.staff;
  const leavePlace = cfg.PLACES.find((place) => place.kind === "leave");
  const out: ScheduleConflict[] = [];
  const work: ScheduleClaim[] = [];
  const cellPeople: Record<string, string[]> = {};
  const personSlot: Record<string, string[]> = {};
  const leaveSet: Record<string, boolean> = {};
  const personShifts: Record<string, Record<string, boolean>> = {};

  for (const claim of claims) {
    if (placeKind(cfg, claim.place) === "leave") {
      leaveSet[`${claim.person}|${claim.date}|${claim.slot}`] = true;
      continue;
    }
    work.push(claim);
    const key = cellKey(claim.date, claim.slot, claim.place);
    cellPeople[key] = cellPeople[key] ?? [];
    cellPeople[key].push(claim.person);
    const personKey = `${claim.person}|${claim.date}|${claim.slot}`;
    personSlot[personKey] = personSlot[personKey] ?? [];
    if (!personSlot[personKey].includes(claim.place)) personSlot[personKey].push(claim.place);
    if (!claim.auto) {
      personShifts[claim.person] = personShifts[claim.person] ?? {};
      personShifts[claim.person][`${claim.date}|${periodOfSlot(cfg, claim.slot)}`] = true;
    }
  }
  const people = (date: string, slot: string, place: string) => cellPeople[cellKey(date, slot, place)] ?? [];

  const leaveClash = work.filter((claim) => leaveSet[`${claim.person}|${claim.date}|${claim.slot}`]);
  eachRange(cfg, leaveClash, (claim) => `${claim.person}|${claim.date}|${claim.place}`, (claim, ids) => {
    out.push({
      type: "LEAVE_CONFLICT",
      severity: "error",
      message: `${claim.person} ${whenText(cfg, claim.date, ids)} 已請假，卻被排在 ${placeName(cfg, claim.place)}`,
      cells: [
        ...ids.map((slot) => ({ date: claim.date, slot, place: claim.place })),
        ...(leavePlace ? ids.map((slot) => ({ date: claim.date, slot, place: leavePlace.id })) : []),
      ],
    });
  });

  const doubles: { person: string; date: string; slot: string; places: string[] }[] = [];
  for (const key of Object.keys(personSlot)) {
    if (personSlot[key].length < 2) continue;
    const [person, date, slot] = key.split("|");
    doubles.push({ person, date, slot, places: personSlot[key].slice().sort() });
  }
  eachRange(cfg, doubles, (item) => `${item.person}|${item.date}|${item.places.join(",")}`, (item, ids) => {
    out.push({
      type: "DOUBLE_BOOKED",
      severity: "error",
      message: `${item.person} 在 ${whenText(cfg, item.date, ids)} 同時被排在 ${item.places.map((id) => placeName(cfg, id)).join("、")}`,
      cells: item.places.flatMap((place) => ids.map((slot) => ({ date: item.date, slot, place }))),
    });
  });

  const restricted = work.filter((claim) => isOffHours(claim.date, claim.slot, dayInfo, cfg) && !offStaff.includes(claim.person));
  eachRange(cfg, restricted, (claim) => `${claim.person}|${claim.date}|${claim.place}`, (claim, ids) => {
    out.push({
      type: "OFFHOURS_RESTRICTED",
      severity: "warn",
      message: `${claim.person} 排在 ${whenText(cfg, claim.date, ids)} ${placeName(cfg, claim.place)}，假日與平日晚上由 ${offStaff.join("、")} 排班`,
      cells: ids.map((slot) => ({ date: claim.date, slot, place: claim.place })),
    });
  });

  const suppress: Record<string, boolean> = {};
  const byHour: Record<string, ScheduleBooking[]> = {};
  for (const booking of bookings) {
    for (const slot of booking.slots) {
      const key = `${slot.date}|${slot.slot}`;
      byHour[key] = byHour[key] ?? [];
      byHour[key].push(booking);
    }
    if (!booking.slots.length) {
      out.push({
        type: "BOOKING_OUTSIDE_SLOTS",
        severity: "warn",
        cells: [],
        message: `${booking.calendar}「${booking.title}」的時間不在任何可排班的整點內，請確認是否需要人員到場`,
      });
    }
  }

  for (const gap of followGaps(weekStart, claims, bookings, dayInfo, cfg)) {
    for (const slot of gap.slots) suppress[cellKey(gap.date, slot, backupId)] = true;
    out.push({
      type: "BACKUP_MISSING",
      severity: "error",
      cells: gap.slots.map((slot) => ({ date: gap.date, slot, place: backupId })),
      message: `${whenText(cfg, gap.date, gap.slots)} ${follower} 要跟錄${unique(gap.bookings.map((booking) => `「${booking.show}」`)).join("")}，需要一位同仁去${placeName(cfg, backupId)}值班（目前沒有人）`,
    });
  }

  const followHours: Record<string, { date: string; slot: string; studios: string[]; shows: Record<string, string[]> }> = {};
  for (const booking of bookings) {
    if (booking.kind !== "follow") continue;
    for (const slot of booking.slots) {
      const key = `${slot.date}|${slot.slot}`;
      const row = followHours[key] ?? { date: slot.date, slot: slot.slot, studios: [], shows: {} };
      followHours[key] = row;
      if (!row.studios.includes(booking.placeId)) row.studios.push(booking.placeId);
      row.shows[booking.placeId] = row.shows[booking.placeId] ?? [];
      row.shows[booking.placeId].push(booking.show);
    }
  }
  const missing: { date: string; slot: string; place: string; covers: string[]; shows: string[] }[] = [];
  const notFollower: { date: string; slot: string; covers: string[]; studios: string[]; shows: Record<string, string[]> }[] = [];
  for (const row of Object.values(followHours)) {
    const covers = isOffHours(row.date, row.slot, dayInfo, cfg) ? offStaff : [follower];
    for (const placeId of row.studios) {
      if (people(row.date, row.slot, placeId).length === 0) {
        missing.push({ date: row.date, slot: row.slot, place: placeId, covers, shows: row.shows[placeId] });
      }
    }
    const anyoneThere = row.studios.some((placeId) => people(row.date, row.slot, placeId).length > 0);
    const coverThere = row.studios.some((placeId) => people(row.date, row.slot, placeId).some((person) => covers.includes(person)));
    if (anyoneThere && !coverThere) {
      notFollower.push({ date: row.date, slot: row.slot, covers, studios: row.studios, shows: row.shows });
    }
  }
  eachRange(cfg, missing, (item) => `${item.date}|${item.place}|${item.covers.join(",")}`, (item, ids, group) => {
    const shows = unique(group.flatMap((row) => row.shows)).map((show) => `「${show}」`).join("、");
    out.push({
      type: "FOLLOW_MISSING",
      severity: "error",
      cells: ids.map((slot) => ({ date: item.date, slot, place: item.place })),
      message: `${whenText(cfg, item.date, ids)} ${placeName(cfg, item.place)}${shows} 需要 ${item.covers.join("或")} 跟錄，目前沒有人排`,
    });
  });
  eachRange(cfg, notFollower, (item) => `${item.date}|${item.covers.join(",")}`, (item, ids, group) => {
    const studios = unique(group.flatMap((row) => row.studios));
    const shows = unique(group.flatMap((row) => row.studios.flatMap((placeId) => row.shows[placeId] ?? []))).map((show) => `「${show}」`).join("、");
    out.push({
      type: "FOLLOW_NOT_FOLLOWER",
      severity: "error",
      cells: studios.flatMap((place) => ids.map((slot) => ({ date: item.date, slot, place }))),
      message: `${whenText(cfg, item.date, ids)} 有需要跟錄的節目（${shows}），但 ${item.covers.join("或")} 沒有排進錄音室`,
    });
  });

  for (const booking of bookings) {
    if (booking.kind !== "follow") continue;
    for (const name of booking.companions) {
      const gone = booking.slots.filter((slot) => !people(slot.date, slot.slot, booking.placeId).includes(name));
      eachRange(cfg, gone, (slot) => slot.date, (slot, ids) => {
        out.push({
          type: "FOLLOW_COMPANION",
          severity: "warn",
          cells: ids.map((id) => ({ date: slot.date, slot: id, place: booking.placeId })),
          message: `${whenText(cfg, slot.date, ids)}「${booking.show}」通常由 ${name} 一起跟錄，他沒有排在${placeName(cfg, booking.placeId)}`,
        });
      });
    }
  }

  const offNo: { date: string; slot: string; place: string; title: string }[] = [];
  const studioNo: { date: string; slot: string; place: string; title: string }[] = [];
  for (const key of Object.keys(byHour)) {
    const [date, slot] = key.split("|");
    const off = isOffHours(date, slot, dayInfo, cfg);
    const seenPlace: Record<string, boolean> = {};
    for (const booking of byHour[key]) {
      if (booking.kind === "follow") continue;
      if (off) {
        if (booking.kind === "own" && offStaff.includes(booking.owner)) continue;
        const covered = people(date, slot, booking.placeId).some((person) => offStaff.includes(person));
        if (!covered) offNo.push({ date, slot, place: booking.placeId, title: booking.title });
      } else if (rules.studioBookingNeedsStaff && booking.kind === "other" && !seenPlace[booking.placeId]) {
        seenPlace[booking.placeId] = true;
        if (!people(date, slot, booking.placeId).length) studioNo.push({ date, slot, place: booking.placeId, title: booking.title });
      }
    }
  }
  eachRange(cfg, offNo, (item) => `${item.date}|${item.place}`, (item, ids, group) => {
    const titles = unique(group.map((row) => `「${row.title}」`)).join("、");
    out.push({
      type: "OFFHOURS_NO_STAFF",
      severity: "error",
      cells: ids.map((slot) => ({ date: item.date, slot, place: item.place })),
      message: `${whenText(cfg, item.date, ids)} ${placeName(cfg, item.place)}有${dayInfo[item.date]?.workday ? "晚上" : "假日"}預約（${titles}），需要 ${offStaff.join("或")} 排班`,
    });
  });
  eachRange(cfg, studioNo, (item) => `${item.date}|${item.place}`, (item, ids, group) => {
    out.push({
      type: "STUDIO_NO_STAFF",
      severity: "error",
      cells: ids.map((slot) => ({ date: item.date, slot, place: item.place })),
      message: `${whenText(cfg, item.date, ids)} ${placeName(cfg, item.place)}有預約「${group[0].title}」但沒有人排班`,
    });
  });

  const backupPlace = placeById(cfg, backupId);
  const away: { date: string; slot: string; reason: string }[] = [];
  if (backupPlace) {
    for (const date of dates) {
      for (const slot of backupPlace.slots) {
        if (isOffHours(date, slot, dayInfo, cfg) || isMeetingBackupExempt(date, slot, dayInfo, cfg)) continue;
        if (suppress[cellKey(date, slot, backupId)]) continue;
        const key = `${follower}|${date}|${slot}`;
        const elsewhere = (personSlot[key] ?? []).filter((place) => place !== backupId);
        const onLeave = !!leaveSet[key];
        if (!elsewhere.length && !onLeave) continue;
        const others = people(date, slot, backupId).filter((person) => person !== follower);
        if (others.length) continue;
        suppress[cellKey(date, slot, backupId)] = true;
        away.push({ date, slot, reason: onLeave ? " 請假" : ` 排在${elsewhere.map((id) => placeName(cfg, id)).join("、")}` });
      }
    }
  }
  eachRange(cfg, away, (item) => `${item.date}|${item.reason}`, (item, ids) => {
    out.push({
      type: "BACKUP_MISSING",
      severity: "error",
      cells: ids.map((slot) => ({ date: item.date, slot, place: backupId })),
      message: `${whenText(cfg, item.date, ids)} ${follower}${item.reason}，需要一位同仁去${placeName(cfg, backupId)}值班（目前沒有人）`,
    });
  });

  const understaffed: { date: string; slot: string; place: ScheduleConfig["PLACES"][number]; min: number }[] = [];
  const over: { date: string; slot: string; place: ScheduleConfig["PLACES"][number]; max: number }[] = [];
  for (const date of dates) {
    for (const place of cfg.PLACES) {
      if (place.kind === "leave") continue;
      const min = rules.minStaff[place.id] ?? 0;
      const max = rules.maxStaff[place.id];
      for (const slot of place.slots) {
        if (isOffHours(date, slot, dayInfo, cfg)) continue;
        const count = people(date, slot, place.id).length;
        const meetingFree = place.id === backupId && isMeetingBackupExempt(date, slot, dayInfo, cfg);
        if (count < min && !meetingFree && !suppress[cellKey(date, slot, place.id)]) {
          understaffed.push({ date, slot, place, min });
        }
        if (max !== undefined && count > max) over.push({ date, slot, place, max });
      }
    }
  }
  eachRange(cfg, understaffed, (item) => `${item.date}|${item.place.id}`, (item, ids) => {
    out.push({
      type: "UNDERSTAFFED",
      severity: "warn",
      cells: ids.map((slot) => ({ date: item.date, slot, place: item.place.id })),
      message:
        `${whenText(cfg, item.date, ids)} ${item.place.name}` +
        (item.min === 1 ? " 沒有人值班" : ` 人數不足（需要至少 ${item.min} 人）`) +
        (item.place.id === backupId ? `（${follower} 不在時一定要有人）` : ""),
    });
  });
  eachRange(cfg, over, (item) => `${item.date}|${item.place.id}`, (item, ids) => {
    out.push({
      type: "OVER_CAPACITY",
      severity: "error",
      cells: ids.map((slot) => ({ date: item.date, slot, place: item.place.id })),
      message: `${whenText(cfg, item.date, ids)} ${item.place.name} 人數超過上限（最多 ${item.max} 人）`,
    });
  });

  for (const stat of weekStats(weekStart, claims, dayInfo, cfg, bookings)) {
    if (stat.need !== null && stat.officeDays < stat.need) {
      out.push({
        type: "OFFICE_DAYS",
        severity: "warn",
        cells: [],
        message: `${stat.name} 本週進辦公室只排了 ${stat.officeDays} 天，至少需要 ${stat.need} 天${stat.adjusted ? "（已扣除假日與請假）" : ""}`,
      });
    }
  }
  if (rules.maxShiftsPerWeek !== null && rules.maxShiftsPerWeek !== undefined) {
    for (const person of cfg.PEOPLE) {
      const count = Object.keys(personShifts[person.name] ?? {}).length;
      if (count > rules.maxShiftsPerWeek) {
        out.push({
          type: "WEEKLY_LIMIT",
          severity: "warn",
          cells: [],
          message: `${person.name} 本週排了 ${count} 班（半天為一班），超過每週上限 ${rules.maxShiftsPerWeek} 班`,
        });
      }
    }
  }

  out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return out;
}

export type ClaimChangeItem = { date: string; slot: string; place: string };

/** 算出這次要新增、要取消的班。取消只針對這個人自己點掉的格子。 */
export function planClaimChange(
  weekStart: string,
  person: string,
  items: ClaimChangeItem[],
  on: boolean,
  strict: boolean,
  current: ScheduleClaim[],
  cfg: ScheduleConfig
): { add: ScheduleClaim[]; remove: ScheduleClaim[]; error?: string } {
  const dates = weekDates(weekStart);
  const names = cfg.PEOPLE.map((item) => item.name);
  if (!names.includes(person)) return { add: [], remove: [], error: `不認識這位人員：${person}` };
  for (const item of items) {
    const place = placeById(cfg, item.place);
    if (!isDateStr(item.date)) return { add: [], remove: [], error: "日期格式錯誤" };
    if (!dates.includes(item.date)) return { add: [], remove: [], error: "日期不在這一週內" };
    if (!place) return { add: [], remove: [], error: `不認識這個地點：${item.place}` };
    if (!slotOf(cfg, item.slot) || !place.slots.includes(item.slot)) {
      return { add: [], remove: [], error: `這個地點沒有這個時段：${item.slot}` };
    }
  }
  const follower = cfg.RULES.followPerson;
  const backupId = cfg.RULES.backupPlaceId;
  const kept = current.filter((claim) => !claim.auto).map((claim) => ({ ...claim, gone: false }));
  const adds: ScheduleClaim[] = [];
  const same = (claim: ScheduleClaim, item: ClaimChangeItem) =>
    claim.person === person && claim.date === item.date && claim.slot === item.slot && claim.place === item.place;
  const atStudio = (item: ClaimChangeItem) =>
    kept.some((entry) => !entry.gone && entry.person === follower && entry.date === item.date && entry.slot === item.slot && placeKind(cfg, entry.place) === "studio") ||
    adds.some((claim) => claim.person === follower && claim.date === item.date && claim.slot === item.slot && placeKind(cfg, claim.place) === "studio");

  for (const item of items) {
    if (on) {
      if (person === follower && item.place === backupId && atStudio(item)) {
        if (strict) {
          return {
            add: [],
            remove: [],
            error: `${follower}這個時段排在錄音室跟錄，${placeName(cfg, backupId)}請排另一位同仁值班`,
          };
        }
        continue;
      }
      const exists = kept.some((entry) => !entry.gone && same(entry, item)) || adds.some((claim) => same(claim, item));
      if (!exists) adds.push({ date: item.date, slot: item.slot, place: item.place, person });
      if (person === follower && placeKind(cfg, item.place) === "studio") {
        for (const entry of kept) {
          if (!entry.gone && entry.person === follower && entry.date === item.date && entry.slot === item.slot && entry.place === backupId) {
            entry.gone = true;
          }
        }
        for (let i = adds.length - 1; i >= 0; i--) {
          const claim = adds[i];
          if (claim.person === follower && claim.date === item.date && claim.slot === item.slot && claim.place === backupId) adds.splice(i, 1);
        }
      }
    } else {
      for (const entry of kept) {
        if (!entry.gone && same(entry, item)) entry.gone = true;
      }
      for (let i = adds.length - 1; i >= 0; i--) {
        if (same(adds[i], item)) adds.splice(i, 1);
      }
    }
  }
  return {
    add: adds,
    remove: kept.filter((entry) => entry.gone).map(({ gone: _gone, ...claim }) => claim),
  };
}
