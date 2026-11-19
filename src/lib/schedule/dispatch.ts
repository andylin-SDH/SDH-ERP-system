import type { ScheduleClaim, ScheduleConflict, ScheduleSlot, ScheduleWeekPayload } from "./types";

export type DispatchSelection = { date: string; place: string; slots: string[]; person?: string; endDate?: string };
export type ClaimRange = { person: string; auto: boolean; slots: string[]; start: string; end: string };

/** Keep gaps and automatic/manual sources separate, so deleting a range cannot delete another. */
export function claimRanges(claims: ScheduleClaim[], slots: ScheduleSlot[]): ClaimRange[] {
  const groups = new Map<string, ScheduleClaim[]>();
  for (const claim of claims) {
    const key = `${claim.person}|${!!claim.auto}`;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  const result: ClaimRange[] = [];
  for (const group of groups.values()) {
    const ids = new Set(group.map((claim) => claim.slot));
    let range: ClaimRange | undefined;
    for (const slot of slots) {
      if (!ids.has(slot.id)) { range = undefined; continue; }
      if (!range || range.end !== slot.start) {
        range = { person: group[0].person, auto: !!group[0].auto, slots: [], start: slot.start, end: slot.end };
        result.push(range);
      }
      range.slots.push(slot.id);
      range.end = slot.end;
    }
  }
  return result;
}

/** Split issue targets by place and contiguous time; never fill gaps between warnings. */
export function conflictTargets(conflict: ScheduleConflict, date: string, slots: ScheduleSlot[]): DispatchSelection[] {
  const places = [...new Set(conflict.cells.filter((cell) => cell.date === date).map((cell) => cell.place))];
  return places.flatMap((place) => {
    const claims = conflict.cells.filter((cell) => cell.date === date && cell.place === place).map((cell) => ({ ...cell, person: "target" }));
    return claimRanges(claims, slots).map((range) => ({ date, place, slots: range.slots }));
  });
}

export function selectionSlots(week: ScheduleWeekPayload, selection: DispatchSelection): ScheduleSlot[] {
  const place = week.config.places.find((item) => item.id === selection.place);
  return week.config.slots.filter((slot) => selection.slots.includes(slot.id) && place?.slots.includes(slot.id));
}

export function conflictingClaims(week: ScheduleWeekPayload, selection: DispatchSelection, person: string): ScheduleClaim[] {
  return week.claims.filter((claim) => claim.person === person && claim.date === selection.date &&
    selection.slots.includes(claim.slot) && claim.place !== selection.place);
}

export function bookingOverlaps(start: string, end: string, date: string, from: string, to: string): boolean {
  return new Date(start).getTime() < new Date(`${date}T${to}:00+08:00`).getTime() &&
    new Date(end).getTime() > new Date(`${date}T${from}:00+08:00`).getTime();
}
