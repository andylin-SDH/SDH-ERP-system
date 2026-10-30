"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScheduleWeekPayload } from "@/lib/schedule/types";
import { FollowList } from "@/components/schedule/FollowList";

const PLACE_TONE: Record<string, string> = {
  bigOffice: "border-sky-200 bg-sky-50",
  smallOffice: "border-emerald-200 bg-emerald-50",
  bigStudio: "border-amber-200 bg-amber-50",
  smallStudio: "border-violet-200 bg-violet-50",
  leave: "border-stone-200 bg-stone-100",
};

const PERIOD_FACE: Record<string, string> = { am: "早", pm: "午", eve: "晚" };

const BLOCK_TONE: Record<string, string> = {
  bigOffice: "border-sky-300 bg-sky-100 text-sky-950",
  smallOffice: "border-emerald-300 bg-emerald-100 text-emerald-950",
  bigStudio: "border-amber-300 bg-amber-100 text-amber-950",
  smallStudio: "border-violet-300 bg-violet-100 text-violet-950",
  leave: "border-stone-300 bg-stone-200 text-stone-700",
};

function weekdayParts(date: string): { name: string; day: string } {
  const names = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { name: names[wd], day: `${m}/${d}` };
}

function weekdayLabel(date: string): string {
  const { name, day } = weekdayParts(date);
  return `${day} ${name}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${mm}-${dd}`;
}

function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function weekCaption(weekStart: string): string {
  const [ay, am, ad] = taipeiToday().split("-").map(Number);
  const [by, bm, bd] = weekStart.split("-").map(Number);
  const delta = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000 / 7);
  if (delta === 0) return "這一週";
  if (delta === 1) return "下一週";
  if (delta === -1) return "上週";
  if (delta > 1) return `${delta} 週後`;
  return `${-delta} 週前`;
}

async function fetchWeek(weekStart: string, force: boolean): Promise<ScheduleWeekPayload | null> {
  const params = new URLSearchParams({ week: weekStart });
  if (force) params.set("force", "1");
  const response = await fetch(`/api/schedule?${params.toString()}`);
  const body = (await response.json()) as { ok: boolean; data?: ScheduleWeekPayload; error?: string };
  return body.ok && body.data ? body.data : null;
}

function conflictKeysOf(week: ScheduleWeekPayload): Map<string, "error" | "warn"> {
  const map = new Map<string, "error" | "warn">();
  for (const conflict of week.conflicts) {
    for (const cell of conflict.cells) {
      const key = `${cell.date}|${cell.slot}|${cell.place}`;
      if (map.get(key) !== "error") map.set(key, conflict.severity);
    }
  }
  return map;
}

export function ScheduleBoard({
  canEdit,
}: {
  canEdit: boolean;
}) {
  const [page, setPage] = useState<"near" | "future" | "follow">("near");
  const [nearWeeks, setNearWeeks] = useState<ScheduleWeekPayload[] | null>(null);
  const [futureWeeks, setFutureWeeks] = useState<ScheduleWeekPayload[] | null>(null);
  const [futureAnchor, setFutureAnchor] = useState("");
  const [loadingNear, setLoadingNear] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingPerson, setEditingPerson] = useState<string>("");
  const [gridWeek, setGridWeek] = useState(0);

  const loadPair = useCallback(async (weekStart: string, force: boolean) => {
    const loaded = await Promise.all([weekStart, addDays(weekStart, 7)].map((date) => fetchWeek(date, force)));
    if (loaded.some((item) => !item)) return null;
    return loaded as ScheduleWeekPayload[];
  }, []);

  const loadNear = useCallback(async (force = false) => {
    setLoadingNear(true);
    setError(null);
    const next = await loadPair(taipeiToday(), force);
    setLoadingNear(false);
    if (!next) {
      setError("讀取班表失敗");
      return;
    }
    setNearWeeks(next);
    setEditingPerson((prev) => {
      const first = next[0];
      if (first.me.canEditAnyone && prev && first.config.people.some((person) => person.name === prev)) return prev;
      return first.me.person ?? "";
    });
  }, [loadPair]);

  const loadFuture = useCallback(async (weekStart: string, force = false) => {
    setError(null);
    const next = await loadPair(weekStart, force);
    if (!next) {
      setError("讀取班表失敗");
      return;
    }
    setFutureWeeks(next);
  }, [loadPair]);

  useEffect(() => {
    void loadNear();
  }, [loadNear]);

  const futureStart = futureAnchor || addDays(taipeiToday(), 14);
  useEffect(() => {
    if (page !== "future") return;
    void loadFuture(futureStart);
  }, [futureStart, loadFuture, page]);

  function replaceWeek(next: ScheduleWeekPayload) {
    const apply = (prev: ScheduleWeekPayload[] | null) =>
      prev?.some((item) => item.weekStart === next.weekStart) ? prev.map((item) => (item.weekStart === next.weekStart ? next : item)) : prev;
    setNearWeeks(apply);
    setFutureWeeks(apply);
  }

  async function writeClaims(weekStart: string, person: string, items: { date: string; slot: string; place: string }[], on: boolean) {
    if (!canEdit) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, person, items, on }),
    });
    const body = (await response.json()) as { ok: boolean; data?: ScheduleWeekPayload; error?: string };
    setSaving(false);
    if (!body.ok || !body.data) {
      setError(body.error || "寫入失敗");
      return;
    }
    replaceWeek(body.data);
  }

  async function preset(weekStart: string) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/schedule/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart }),
    });
    const body = (await response.json()) as { ok: boolean; data?: ScheduleWeekPayload & { presetAdded?: number }; error?: string };
    setSaving(false);
    if (!body.ok || !body.data) {
      setError(body.error || "預排失敗");
      return;
    }
    replaceWeek(body.data);
    setNotice(body.data.presetAdded ? `已補上 ${body.data.presetAdded} 個整點` : "沒有要補的空白時段");
  }

  function shiftFuture(direction: -1 | 1) {
    const min = addDays(taipeiToday(), 14);
    const next = addDays(futureStart, direction * 14);
    if (next < min) return;
    setFutureAnchor(next);
    setGridWeek(0);
  }

  const identity = nearWeeks?.[0] ?? futureWeeks?.[0] ?? null;
  const actor = identity ? (identity.me.canEditAnyone ? editingPerson : identity.me.person) : null;
  const canToggle = canEdit && !!actor;
  const futureReady = futureWeeks?.[0]?.weekStart === futureStart;
  const activeWeeks = page === "future" ? (futureReady ? futureWeeks : null) : nearWeeks;
  const activeLoading = page === "future" ? !futureReady : loadingNear && !nearWeeks;
  const tabs = [
    { id: "near" as const, label: "近兩週班表" },
    { id: "future" as const, label: "未來班表" },
    { id: "follow" as const, label: "跟錄名單" },
  ];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">班表</h2>
        <p className="mt-1 text-sm text-stone-600">
          {identity?.me.person
            ? `你是${identity.me.person}。缺人的格子會寫還缺幾人，按旁邊的 + 加上${identity.me.canEditAnyone ? "你選的那一位" : "你"}，人名旁邊的 × 拿掉。`
            : identity
              ? "你不在排班名單裡，可以看，不能改。"
              : "正在讀取班表…"}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPage(tab.id)}
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
              page === tab.id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-white hover:text-stone-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {page !== "follow" && identity?.me.canEditAnyone && canEdit && (
        <label className="flex items-center gap-2 text-sm text-stone-700">
          正在排
          <select
            className="rounded-lg border border-stone-300 bg-white px-2 py-1"
            value={editingPerson}
            onChange={(event) => setEditingPerson(event.target.value)}
          >
            {identity.config.people.map((person) => (
              <option key={person.name} value={person.name}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {notice && page !== "follow" && <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{notice}</p>}
      {page !== "follow" &&
        activeWeeks?.[0]?.warnings.map((warning) => (
          <p key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {warning}
          </p>
        ))}

      {page === "follow" ? (
        <FollowList people={identity?.config.people.map((person) => person.name) ?? []} canMutate={canEdit} />
      ) : activeLoading || !activeWeeks ? (
        <p className="text-sm text-stone-500">正在讀取班表…</p>
      ) : (
        <SchedulePair
          weeks={activeWeeks}
          actor={actor}
          canToggle={canToggle}
          saving={saving}
          gridWeek={Math.min(gridWeek, activeWeeks.length - 1)}
          onGridWeek={setGridWeek}
          onToggle={(weekStart, items, on) => {
            if (actor) void writeClaims(weekStart, actor, items, on);
          }}
          onPreset={(weekStart) => void preset(weekStart)}
          onRefresh={() => void (page === "future" ? loadFuture(futureStart, true) : loadNear(true))}
          earlierLabel={page === "future" && futureStart > addDays(taipeiToday(), 14) ? "← 前兩週" : undefined}
          laterLabel={page === "future" ? "後兩週 →" : undefined}
          onEarlier={() => shiftFuture(-1)}
          onLater={() => shiftFuture(1)}
        />
      )}
    </section>
  );
}

function weekRangeLabel(dates: string[]): string {
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  const face = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return `${m}/${d}（${names[wd]}）`;
  };
  return `${face(dates[0])} – ${face(dates[dates.length - 1])}`;
}

function hourText(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

const GLANCE_PLACE_IDS = ["smallStudio", "bigStudio", "bigOffice"] as const;
const GLANCE_PLACE_SHORT: Record<string, string> = { smallStudio: "小錄", bigStudio: "大錄", bigOffice: "新辦" };
const GLANCE_PERIOD_LABEL: Record<string, string> = { am: "早", pm: "中", eve: "晚" };

const PERIOD_BAND: Record<string, { box: string; chip: string }> = {
  am: { box: "border-stone-300 bg-stone-50", chip: "bg-stone-500 text-white" },
  pm: { box: "border-stone-400 bg-stone-100", chip: "bg-stone-600 text-white" },
  eve: { box: "border-stone-500 bg-stone-200", chip: "bg-stone-800 text-white" },
};

const PLACE_FACE: Record<string, { idle: string; filled: string }> = {
  smallStudio: { idle: "border-violet-300 bg-violet-50/70", filled: "border-violet-400 bg-violet-50" },
  bigStudio: { idle: "border-amber-300 bg-amber-50/70", filled: "border-amber-400 bg-amber-50" },
  bigOffice: { idle: "border-sky-200 bg-white", filled: "border-sky-300 bg-sky-50" },
};

const STUDIO_OTHER: Record<string, string> = { smallStudio: "bigStudio", bigStudio: "smallStudio" };
const FOLLOW_COVER = "林安迪";

function periodSlotIds(week: ScheduleWeekPayload, periodId: string): Set<string> {
  return new Set(week.config.slots.filter((slot) => slot.period === periodId).map((slot) => slot.id));
}

function hasFollowBooking(week: ScheduleWeekPayload, date: string, placeId: string, slotIds: Set<string>): boolean {
  return week.bookings.some(
    (booking) => booking.kind === "follow" && booking.placeId === placeId && booking.slots.some((slot) => slot.date === date && slotIds.has(slot.slot))
  );
}

function peopleInCell(week: ScheduleWeekPayload, date: string, placeId: string, slotIds: Set<string>, manualOnly: boolean): string[] {
  const follower = week.config.followPerson;
  const studio = placeId === "smallStudio" || placeId === "bigStudio";
  return [
    ...new Set(
      week.claims
        .filter((claim) => {
          if (claim.date !== date || claim.place !== placeId || !slotIds.has(claim.slot)) return false;
          if (!claim.auto) return true;
          return !manualOnly && studio && claim.person === follower;
        })
        .map((claim) => claim.person)
    ),
  ].filter((name) => manualOnly || name !== follower || !andyFollowMark(week, date, placeId, slotIds));
}

function studioShortBy(week: ScheduleWeekPayload, date: string, placeId: string, periodId: string, people: string[], manual: string[]): number {
  const slotIds = periodSlotIds(week, periodId);
  const followHere = hasFollowBooking(week, date, placeId, slotIds);
  const otherId = STUDIO_OTHER[placeId];
  const followOther = !!otherId && hasFollowBooking(week, date, otherId, slotIds);
  const andyLeave = week.claims.some(
    (claim) => !claim.auto && claim.person === FOLLOW_COVER && claim.place === "leave" && claim.date === date && slotIds.has(claim.slot)
  );
  const follower = week.config.followPerson;
  const followerHere = people.includes(follower);
  const followGap = followHere && followSlotsUncovered(week, date, placeId, slotIds);
  let need = 0;
  if (followHere && !followerHere) need += 1;
  else if (followGap) need += 1;
  if (followHere && andyLeave) need += 1;
  if (followOther && !followerHere) need += 1;
  const outsideSlots = new Set(
    week.bookings
      .filter((booking) => booking.kind === "other" && booking.placeId === placeId)
      .flatMap((booking) => booking.slots.filter((slot) => slot.date === date && slotIds.has(slot.slot)).map((slot) => slot.slot))
  );
  if (!followHere && !followOther && outsideSlots.size > 0 && manual.length === 0) {
    const coveredByFollower = [...outsideSlots].every((slot) =>
      week.claims.some((claim) => claim.person === follower && claim.date === date && claim.place === placeId && claim.slot === slot)
    );
    if (!coveredByFollower) need = Math.max(need, 1);
  }
  return Math.max(0, need - manual.length);
}

function followSlotsUncovered(week: ScheduleWeekPayload, date: string, placeId: string, slotIds: Set<string>): boolean {
  const follower = week.config.followPerson;
  let missing = false;
  for (const booking of week.bookings) {
    if (booking.kind !== "follow" || booking.placeId !== placeId) continue;
    for (const slot of booking.slots) {
      if (slot.date !== date || !slotIds.has(slot.slot)) continue;
      const covered = week.claims.some(
        (claim) => claim.date === date && claim.place === placeId && claim.slot === slot.slot && (claim.person === follower || !claim.auto)
      );
      if (!covered) missing = true;
    }
  }
  return missing;
}

function andyFollowMark(week: ScheduleWeekPayload, date: string, placeId: string, slotIds: Set<string>): boolean {
  const followSlots = new Set(
    week.bookings
      .filter((booking) => booking.kind === "follow" && booking.placeId === placeId)
      .flatMap((booking) => booking.slots.filter((slot) => slot.date === date && slotIds.has(slot.slot)).map((slot) => slot.slot))
  );
  return week.bookings.some((booking) => booking.andyRecording && booking.slots.some((slot) => slot.date === date && followSlots.has(slot.slot)));
}

function followTitles(week: ScheduleWeekPayload, date: string, placeId: string, slotIds: Set<string>): string[] {
  return [
    ...new Set(
      week.bookings
        .filter((booking) => booking.kind === "follow" && booking.placeId === placeId && booking.slots.some((slot) => slot.date === date && slotIds.has(slot.slot)))
        .map((booking) => booking.show || booking.title)
        .filter(Boolean)
    ),
  ];
}

function glanceCell(week: ScheduleWeekPayload, actor: string | null, date: string, placeId: string, periodId: string) {
  const place = week.config.places.find((item) => item.id === placeId);
  const slots = week.config.slots.filter((slot) => slot.period === periodId && place?.slots.includes(slot.id));
  if (!place || slots.length === 0) return null;
  const slotIds = new Set(slots.map((slot) => slot.id));
  const items = slots.map((slot) => ({ date, slot: slot.id, place: placeId }));
  const people = peopleInCell(week, date, placeId, slotIds, false);
  const manual = peopleInCell(week, date, placeId, slotIds, true);
  const titles = followTitles(week, date, placeId, slotIds);
  return {
    place,
    items,
    people,
    titles,
    andyMark: andyFollowMark(week, date, placeId, slotIds),
    shortBy: place.kind === "studio" ? studioShortBy(week, date, placeId, periodId, people, manual) : 0,
    actorOn: !!actor && people.includes(actor),
    actorRemovable: !!actor && manual.includes(actor),
  };
}

function ShiftSlot({
  placeId,
  placeName,
  people,
  actor,
  actorOn,
  actorRemovable,
  shortBy,
  titles,
  andyMark,
  editable,
  saving,
  ring,
  fill,
  onAdd,
  onRemove,
}: {
  placeId: string;
  placeName: string;
  people: string[];
  actor: string | null;
  actorOn: boolean;
  actorRemovable: boolean;
  shortBy: number;
  titles: string[];
  andyMark?: boolean;
  editable: boolean;
  saving: boolean;
  ring?: string;
  fill?: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const face = PLACE_FACE[placeId] ?? { idle: "border-stone-200 bg-white", filled: "border-stone-300 bg-stone-50" };
  const label = GLANCE_PLACE_SHORT[placeId] ?? placeName;
  const showAdd = editable && !actorOn;
  const hasBody = !!titles[0] || people.length > 0 || shortBy > 0 || !!andyMark;
  const addButton = showAdd ? (
    <button
      type="button"
      disabled={saving}
      aria-label={actor ? `把${actor}排上${placeName}` : `排上${placeName}`}
      title={actor ? `把${actor}排上` : "排上"}
      onClick={onAdd}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-stone-900 text-base leading-none text-white hover:bg-stone-700 disabled:opacity-40"
    >
      +
    </button>
  ) : null;
  return (
    <div className={`rounded-lg border border-l-4 px-1.5 py-1.5 ${fill ? "h-full" : ""} ${people.length > 0 || titles[0] || andyMark ? face.filled : face.idle} ${andyMark ? "ring-2 ring-amber-500" : ""} ${ring ?? ""}`}>
      <div className={`flex items-center justify-between gap-1 ${hasBody ? "border-b border-stone-300/80 pb-1" : ""}`}>
        <p className="text-[11px] font-semibold leading-none text-stone-700">{label}</p>
        {shortBy === 0 ? addButton : null}
      </div>
      {titles[0] ? (
        <p className="mt-1 flex items-start gap-1 text-[13px] font-bold leading-snug text-stone-950">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden title="跟錄">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12 18v3" strokeLinecap="round" />
          </svg>
          <span className="line-clamp-2 min-w-0">{titles.join("、")}</span>
        </p>
      ) : null}
      {andyMark ? <p className="mt-1 text-[11px] font-bold leading-snug text-amber-950">五吉郎在訪談需要其他人支援跟錄</p> : null}
      {people.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {people.map((name) => (
            <li key={name} className="flex items-center gap-1 rounded-md bg-white px-1.5 py-1 ring-1 ring-stone-200">
              <svg className="h-3.5 w-3.5 shrink-0 text-stone-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden title="人員">
                <circle cx="12" cy="8" r="4" />
                <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
              </svg>
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-stone-900">{name}</span>
              {editable && actorRemovable && name === actor ? (
                <button
                  type="button"
                  disabled={saving}
                  aria-label={`拿掉${name}`}
                  title={`拿掉${name}`}
                  onClick={onRemove}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-[13px] leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {shortBy > 0 ? (
        <div className="mt-1 flex items-center justify-between gap-1">
          <span className="text-[12px] font-semibold text-red-700">缺 {shortBy} 人</span>
          {addButton}
        </div>
      ) : null}
    </div>
  );
}

function PersonWeekGrid({
  week,
  actor,
  canToggle,
  saving,
  onToggle,
}: {
  week: ScheduleWeekPayload;
  actor: string | null;
  canToggle: boolean;
  saving: boolean;
  onToggle: (items: { date: string; slot: string; place: string }[], on: boolean) => void;
}) {
  const today = taipeiToday();
  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
  const stat = week.stats.find((item) => item.name === actor);
  const office = stat?.need == null ? `辦公室 ${stat?.officeDays ?? 0} 天` : `辦公室 ${stat.officeDays}/${stat.need} 天`;
  const legend = week.config.places.filter((place) => (GLANCE_PLACE_IDS as readonly string[]).includes(place.id));

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-3 py-2">
        <div>
          <p className="text-sm font-semibold text-stone-900">{actor ? `${actor} 的這一週` : "這一週"}</p>
          {actor ? (
            <p className="text-[11px] text-stone-500">
              {office}　錄音 {hourText(stat?.studioHours ?? 0)} 小時
            </p>
          ) : (
            <p className="text-[11px] text-stone-500">你不在排班名單裡，這格沒有個人班表。</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-stone-600">
          {legend.map((place) => (
            <span key={place.id} className={`rounded-md border px-1.5 py-0.5 ${BLOCK_TONE[place.id] ?? "border-stone-200 bg-stone-50"}`}>
              {place.name}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="bg-stone-50 text-xs text-stone-500">
              {week.dates.map((date) => {
                const [y, m, d] = date.split("-").map(Number);
                const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
                const weekend = wd === 0 || wd === 6;
                const holiday = week.dayInfo[date]?.holiday;
                return (
                  <th key={date} className={`border-b border-stone-200 px-2 py-2 font-semibold ${weekend ? "bg-stone-100/80" : ""} ${date === today ? "text-sky-800" : ""}`}>
                    <span className="block text-sm text-stone-800">{String(d).padStart(2, "0")}</span>
                    <span className="font-medium">{dayNames[wd]}</span>
                    {holiday ? <span className="mt-0.5 block font-normal text-[10px] text-amber-700">{holiday}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {week.config.periods.map((period) => {
              const band = PERIOD_BAND[period.id] ?? { box: "border-stone-300 bg-stone-50", chip: "bg-stone-600 text-white" };
              const placeIds = GLANCE_PLACE_IDS.filter((placeId) => glanceCell(week, actor, week.dates[0], placeId, period.id));
              return (
                <tr key={period.id}>
                  {week.dates.map((date) => {
                    const [y, m, d] = date.split("-").map(Number);
                    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
                    const weekend = wd === 0 || wd === 6;
                    const editable = canToggle && !!actor;
                    return (
                      <td key={date} className={`h-px min-w-[8.5rem] px-1.5 py-1 align-top ${weekend ? "bg-stone-50/80" : ""}`}>
                        <div className={`flex h-full flex-col rounded-lg border-2 p-1 ${band.box}`}>
                          <p className={`mb-1 rounded px-1 py-1 text-center leading-tight ${band.chip}`}>
                            <span className="block text-xs font-semibold">{GLANCE_PERIOD_LABEL[period.id] ?? period.label}</span>
                            <span className="block text-[9px] font-medium opacity-90">{period.start}–{period.end}</span>
                          </p>
                          <div
                            className="grid min-h-0 flex-1 gap-1"
                            style={{ gridTemplateRows: `repeat(${Math.max(placeIds.length, 1)}, minmax(auto, 1fr))` }}
                          >
                            {placeIds.map((placeId) => {
                              const cell = glanceCell(week, actor, date, placeId, period.id);
                              if (!cell) return <div key={placeId} />;
                              return (
                                <ShiftSlot
                                  key={placeId}
                                  placeId={placeId}
                                  placeName={cell.place.name}
                                  people={cell.people}
                                  actor={actor}
                                  actorOn={cell.actorOn}
                                  actorRemovable={cell.actorRemovable}
                                  shortBy={cell.shortBy}
                                    titles={cell.titles}
                                    andyMark={cell.andyMark}
                                    editable={editable}
                                  saving={saving}
                                  fill
                                  onAdd={() => onToggle(cell.items, true)}
                                  onRemove={() => onToggle(cell.items, false)}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-stone-100 px-3 py-2 text-[11px] text-stone-500">
        跟錄節目寫在格子上，五吉郎會先排好。缺人旁邊的 + 是排上正在排的人，人名旁的 × 拿掉。小錄是紫色、大錄是黃色、新辦是藍色。
      </p>
    </div>
  );
}

function SchedulePair({
  weeks,
  actor,
  canToggle,
  saving,
  gridWeek,
  onGridWeek,
  onToggle,
  onPreset,
  onRefresh,
  earlierLabel,
  laterLabel,
  onEarlier,
  onLater,
}: {
  weeks: ScheduleWeekPayload[];
  actor: string | null;
  canToggle: boolean;
  saving: boolean;
  gridWeek: number;
  onGridWeek: (index: number) => void;
  onToggle: (weekStart: string, items: { date: string; slot: string; place: string }[], on: boolean) => void;
  onPreset: (weekStart: string) => void;
  onRefresh: () => void;
  earlierLabel?: string;
  laterLabel?: string;
  onEarlier: () => void;
  onLater: () => void;
}) {
  const gridItem = weeks[gridWeek] ?? weeks[0];
  const [showPlaceGrids, setShowPlaceGrids] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-300 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-stone-900">{weekRangeLabel([weeks[0].dates[0], weeks[weeks.length - 1].dates[6]])}</p>
        <div className="flex flex-wrap items-center gap-2">
          {earlierLabel ? (
            <button type="button" className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700" onClick={onEarlier}>
              {earlierLabel}
            </button>
          ) : null}
          {laterLabel ? (
            <button type="button" className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700" onClick={onLater}>
              {laterLabel}
            </button>
          ) : null}
          <button type="button" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100" onClick={onRefresh}>
            重新整理
          </button>
        </div>
      </div>

      {gridItem ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {weeks.map((item, index) => (
              <button
                key={item.weekStart}
                type="button"
                onClick={() => onGridWeek(index)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  index === gridWeek ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-300"
                }`}
              >
                {weekCaption(item.weekStart)}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold text-stone-900">
            {weekCaption(gridItem.weekStart)}　{weekRangeLabel(gridItem.dates)}
          </p>
          <PersonWeekGrid
            week={gridItem}
            actor={actor}
            canToggle={canToggle}
            saving={saving}
            onToggle={(slots, on) => onToggle(gridItem.weekStart, slots, on)}
          />
          <ConflictList week={gridItem} />
          <button
            type="button"
            onClick={() => setShowPlaceGrids((open) => !open)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100"
          >
            {showPlaceGrids ? "收合依地點細格" : "依地點細格（早午晚）"}
          </button>
          {showPlaceGrids
            ? gridItem.config.places.map((place) => (
                <PlaceGrid
                  key={`${gridItem.weekStart}-${place.id}`}
                  placeId={place.id}
                  week={gridItem}
                  actor={actor}
                  canToggle={canToggle}
                  conflictKeys={conflictKeysOf(gridItem)}
                  onToggle={(slots, on) => onToggle(gridItem.weekStart, slots, on)}
                />
              ))
            : null}
          {canToggle && gridItem.config.presetPeople.length > 0 && (gridItem.me.canEditAnyone || gridItem.config.presetPeople.includes(gridItem.me.person ?? "")) && (
            <button type="button" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" onClick={() => onPreset(gridItem.weekStart)} disabled={saving}>
              預排{gridItem.config.presetPeople.join("、")}{weekCaption(gridItem.weekStart)}的時間
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConflictList({ week }: { week: ScheduleWeekPayload }) {
  const today = taipeiToday();
  const conflicts = week.conflicts.filter((conflict) => conflict.cells.length === 0 || conflict.cells.some((cell) => cell.date >= today));
  if (!conflicts.length) {
    return <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">這週沒有衝突。</p>;
  }
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-3">
      <p className="text-sm font-semibold text-stone-800">衝突檢查</p>
      <ul className="mt-2 space-y-1">
        {conflicts.map((conflict, index) => (
          <li key={`${conflict.type}-${index}`} className={`text-xs ${conflict.severity === "error" ? "text-red-700" : "text-amber-800"}`}>
            {conflict.severity === "error" ? "錯誤" : "提醒"}　{conflict.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function meetingNote(week: ScheduleWeekPayload, date: string, placeId: string): string | null {
  const hit = week.meetings.find((meeting) => meeting.date === date && meeting.placeId === placeId);
  if (!hit) return null;
  return `${hit.start}–${hit.end} 全員開會，不用點`;
}

function PlaceGrid({
  placeId,
  week,
  actor,
  canToggle,
  conflictKeys,
  onToggle,
}: {
  placeId: string;
  week: ScheduleWeekPayload;
  actor: string | null;
  canToggle: boolean;
  conflictKeys: Map<string, "error" | "warn">;
  onToggle: (items: { date: string; slot: string; place: string }[], on: boolean) => void;
}) {
  const place = week.config.places.find((item) => item.id === placeId);
  const dates = week.dates;
  if (!place || dates.length === 0) return null;
  const tone = PLACE_TONE[place.id] ?? "border-stone-200 bg-white";
  const rows = week.config.periods.map((period) => ({
    id: period.id,
    label: PERIOD_FACE[period.id] ?? period.label,
    time: `${period.start}–${period.end}`,
    slots: week.config.slots.filter((slot) => slot.period === period.id && place.slots.includes(slot.id)).map((slot) => slot.id),
  }));

  return (
    <div className={`overflow-x-auto rounded-2xl border p-3 ${tone}`}>
      <p className="mb-2 text-sm font-semibold text-stone-900">{place.name}</p>
      <table className="w-full min-w-[720px] border-separate border-spacing-1 text-left text-xs">
        <thead>
          <tr>
            <th className="w-16 px-1 py-1 font-medium text-stone-500">時段</th>
            {dates.map((date) => (
              <th key={date} className="px-1 py-1 font-medium text-stone-600">
                {weekdayLabel(date)}
                {week.dayInfo[date]?.holiday ? ` ${week.dayInfo[date].holiday}` : ""}
                {meetingNote(week, date, place.id) ? (
                  <span className="mt-0.5 block font-normal text-[10px] text-stone-500">{meetingNote(week, date, place.id)}</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const band = PERIOD_BAND[row.id] ?? { box: "border-stone-300 bg-stone-50", chip: "bg-stone-600 text-white" };
            return (
            <tr key={row.id}>
              <td className="px-1 py-1 align-top">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-black ${band.chip}`}>{row.label}</span>
                <span className="mt-0.5 block text-[10px] text-stone-500">{row.time}</span>
              </td>
              {dates.map((date) => {
                if (row.slots.length === 0) {
                  return (
                    <td key={date} className="align-top">
                      <div className="rounded-lg bg-white/40 px-1.5 py-2 text-[10px] text-stone-400">沒有這段</div>
                    </td>
                  );
                }
                const items = row.slots.map((slot) => ({ date, slot, place: place.id }));
                const slotIds = new Set(row.slots);
                const names = peopleInCell(week, date, place.id, slotIds, false);
                const manual = peopleInCell(week, date, place.id, slotIds, true);
                const actorOn = !!actor && names.includes(actor);
                const severity = items.reduce<"error" | "warn" | null>((current, item) => {
                  const hit = conflictKeys.get(`${item.date}|${item.slot}|${item.place}`);
                  if (hit === "error" || current === "error") return "error";
                  return hit ?? current;
                }, null);
                const ring = severity === "error" ? "ring-2 ring-red-400" : severity === "warn" ? "ring-2 ring-amber-300" : "";
                const shortBy = place.kind === "studio" ? studioShortBy(week, date, place.id, row.id, names, manual) : 0;
                return (
                  <td key={date} className="align-top">
                    <ShiftSlot
                      placeId={place.id}
                      placeName={place.name}
                      people={names}
                      actor={actor}
                      actorOn={actorOn}
                      actorRemovable={!!actor && manual.includes(actor)}
                      shortBy={shortBy}
                      titles={followTitles(week, date, place.id, slotIds)}
                      andyMark={andyFollowMark(week, date, place.id, slotIds)}
                      editable={canToggle}
                      saving={false}
                      ring={ring}
                      onAdd={() => onToggle(items, true)}
                      onRemove={() => onToggle(items, false)}
                    />
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

