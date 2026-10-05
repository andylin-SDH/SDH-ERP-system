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

function taipeiMonday(): string {
  const today = taipeiToday();
  const [y, m, d] = today.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(today, wd === 0 ? -6 : 1 - wd);
}

function weekCaption(weekStart: string): string {
  const [ay, am, ad] = taipeiMonday().split("-").map(Number);
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
  const [weeks, setWeeks] = useState<ScheduleWeekPayload[] | null>(null);
  const [anchor, setAnchor] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingPerson, setEditingPerson] = useState<string>("");

  const load = useCallback(async (weekStart: string, force = false) => {
    setLoading(true);
    setError(null);
    const start = weekStart || taipeiMonday();
    const loaded = await Promise.all([start, addDays(start, 7)].map((date) => fetchWeek(date, force)));
    setLoading(false);
    if (loaded.some((item) => !item)) {
      setError("讀取班表失敗");
      return;
    }
    const next = loaded as ScheduleWeekPayload[];
    setWeeks(next);
    setEditingPerson((prev) => {
      const first = next[0];
      if (first.me.canEditAnyone && prev && first.config.people.some((person) => person.name === prev)) return prev;
      return first.me.person ?? "";
    });
  }, []);

  useEffect(() => {
    void load(anchor);
  }, [anchor, load]);

  function replaceWeek(next: ScheduleWeekPayload) {
    setWeeks((prev) => prev?.map((item) => (item.weekStart === next.weekStart ? next : item)) ?? prev);
  }

  async function writeClaims(weekStart: string, person: string, items: { date: string; slot: string; place: string }[], on: boolean) {
    if (!canEdit || !weeks) return;
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
    if (!canEdit || !weeks) return;
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

  function shiftPair(direction: -1 | 1) {
    if (!weeks?.[0]) return;
    setAnchor(addDays(weeks[0].weekStart, direction * 14));
  }

  if (loading && !weeks) {
    return <p className="text-sm text-stone-500">正在讀取班表…</p>;
  }
  if (!weeks) {
    return <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">{error || "讀不到班表"}</p>;
  }

  const week = weeks[0];
  const actor = week.me.canEditAnyone ? editingPerson : week.me.person;
  const canToggle = canEdit && !!actor;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">班表</h2>
          <p className="mt-1 text-sm text-stone-600">
            {week.me.person
              ? `你是${week.me.person}。一天分早、午、晚，按鈕只會加上或拿掉${week.me.canEditAnyone ? "你選的那一位" : "你"}。`
              : "你不在排班名單裡，可以看，不能改。"}
          </p>
        </div>
      </div>

      {week.me.canEditAnyone && canEdit && (
        <label className="flex items-center gap-2 text-sm text-stone-700">
          正在排
          <select
            className="rounded-lg border border-stone-300 bg-white px-2 py-1"
            value={editingPerson}
            onChange={(event) => setEditingPerson(event.target.value)}
          >
            {week.config.people.map((person) => (
              <option key={person.name} value={person.name}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {notice && <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{notice}</p>}
      {week.warnings.map((warning) => (
        <p key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {warning}
        </p>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-300 bg-white px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-stone-500">一次看兩週</p>
          <p className="text-sm font-semibold text-stone-900">
            {weekRangeLabel([weeks[0].dates[0], weeks[1].dates[6]])}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 active:bg-black" onClick={() => shiftPair(-1)}>
            ← 前兩週
          </button>
          {weeks[0].weekStart !== taipeiMonday() && (
            <button type="button" className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-amber-300 active:bg-amber-500" onClick={() => setAnchor(taipeiMonday())}>
              回到現在
            </button>
          )}
          <button type="button" className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 active:bg-black" onClick={() => shiftPair(1)}>
            後兩週 →
          </button>
          <button
            type="button"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100 active:bg-stone-200"
            onClick={() => void load(weeks[0].weekStart, true)}
          >
            重新整理
          </button>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {weeks.map((item) => (
          <WeekPlan
            key={item.weekStart}
            week={item}
            actor={actor}
            canToggle={canToggle}
            saving={saving}
            onPickPerson={item.me.canEditAnyone && canEdit ? setEditingPerson : undefined}
            onToggle={(items, on) => {
              if (actor) void writeClaims(item.weekStart, actor, items, on);
            }}
          />
        ))}
      </div>

      {weeks.map((item) => {
        const keys = conflictKeysOf(item);
        return (
          <div key={`${item.weekStart}-grid`} className="space-y-4">
            <p className="text-sm font-semibold text-stone-900">
              {weekCaption(item.weekStart)}的格子　{weekRangeLabel(item.dates)}
            </p>
            <ConflictList week={item} />
            {item.config.places.map((place) => (
              <PlaceGrid
                key={`${item.weekStart}-${place.id}`}
                placeId={place.id}
                week={item}
                actor={actor}
                canToggle={canToggle}
                conflictKeys={keys}
                onToggle={(slots, on) => {
                  if (actor) void writeClaims(item.weekStart, actor, slots, on);
                }}
              />
            ))}
            {canToggle && item.config.presetPeople.length > 0 && (item.me.canEditAnyone || item.config.presetPeople.includes(item.me.person ?? "")) && (
              <button type="button" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" onClick={() => void preset(item.weekStart)} disabled={saving}>
                預排{item.config.presetPeople.join("、")}{weekCaption(item.weekStart)}的時間
              </button>
            )}
          </div>
        );
      })}

      <FollowList people={week.config.people.map((person) => person.name)} canMutate={canEdit} />
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

type BookingRow = {
  booking: ScheduleWeekPayload["bookings"][number];
  placeName: string;
  open: { date: string; slot: string }[];
  names: string[];
  mine: { date: string; slot: string }[];
};

function studioRows(week: ScheduleWeekPayload, actor: string | null): BookingRow[] {
  const studioIds = new Set(week.config.places.filter((place) => place.kind === "studio").map((place) => place.id));
  return week.bookings
    .filter((booking) => studioIds.has(booking.placeId) && booking.slots.length > 0)
    .map((booking) => {
      const placeName = week.config.places.find((place) => place.id === booking.placeId)?.name ?? booking.calendar;
      const covered = booking.slots.filter((slot) =>
        week.claims.some((claim) => !claim.auto && claim.date === slot.date && claim.slot === slot.slot && claim.place === booking.placeId)
      );
      const open = booking.slots.filter((slot) => !covered.some((item) => item.date === slot.date && item.slot === slot.slot));
      const names = [
        ...new Set(
          week.claims
            .filter((claim) => !claim.auto && claim.place === booking.placeId && booking.slots.some((slot) => slot.date === claim.date && slot.slot === claim.slot))
            .map((claim) => claim.person)
        ),
      ];
      const mine = actor
        ? booking.slots.filter((slot) =>
            week.claims.some(
              (claim) => !claim.auto && claim.person === actor && claim.date === slot.date && claim.slot === slot.slot && claim.place === booking.placeId
            )
          )
        : [];
      return { booking, placeName, open, names, mine };
    })
    .sort((a, b) => a.booking.start.localeCompare(b.booking.start) || a.placeName.localeCompare(b.placeName, "zh-Hant"));
}

type PeriodGroup = {
  key: string;
  periodId: string;
  label: string;
  time: string;
  placeId: string;
  placeName: string;
  open: { date: string; slot: string }[];
  mine: { date: string; slot: string }[];
  names: string[];
  titles: string[];
};

function periodGroups(week: ScheduleWeekPayload, date: string, rows: BookingRow[]): PeriodGroup[] {
  const periodOf = new Map(week.config.slots.map((slot) => [slot.id, slot.period]));
  const map = new Map<string, PeriodGroup & { slotIds: string[] }>();
  for (const row of rows) {
    const touched = new Set<string>();
    for (const slot of row.booking.slots) {
      if (slot.date !== date) continue;
      const periodId = periodOf.get(slot.slot);
      if (periodId) touched.add(periodId);
    }
    for (const periodId of touched) {
      const period = week.config.periods.find((item) => item.id === periodId);
      if (!period) continue;
      const key = `${periodId}|${row.booking.placeId}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          periodId,
          label: period.short || period.label,
          time: `${period.start}–${period.end}`,
          placeId: row.booking.placeId,
          placeName: row.placeName,
          open: [],
          mine: [],
          names: [],
          titles: [],
          slotIds: [],
        };
        map.set(key, group);
      }
      const title = `${row.booking.kind === "follow" ? "跟錄 " : row.booking.kind === "own" ? "自錄 " : ""}${row.booking.show || row.booking.title}`;
      if (!group.titles.includes(title)) group.titles.push(title);
      const seen = new Set(group.slotIds);
      for (const slot of row.booking.slots) {
        if (slot.date === date && periodOf.get(slot.slot) === periodId && !seen.has(slot.slot)) {
          group.slotIds.push(slot.slot);
          seen.add(slot.slot);
        }
      }
      const seenOpen = new Set(group.open.map((slot) => slot.slot));
      for (const slot of row.open) {
        if (slot.date === date && periodOf.get(slot.slot) === periodId && !seenOpen.has(slot.slot)) {
          group.open.push(slot);
          seenOpen.add(slot.slot);
        }
      }
      const seenMine = new Set(group.mine.map((slot) => slot.slot));
      for (const slot of row.mine) {
        if (slot.date === date && periodOf.get(slot.slot) === periodId && !seenMine.has(slot.slot)) {
          group.mine.push(slot);
          seenMine.add(slot.slot);
        }
      }
    }
  }
  for (const group of map.values()) {
    const slots = new Set(group.slotIds);
    group.names = [
      ...new Set(
        week.claims
          .filter((claim) => !claim.auto && claim.date === date && claim.place === group.placeId && slots.has(claim.slot))
          .map((claim) => claim.person)
      ),
    ];
  }
  const periodOrder = new Map(week.config.periods.map((period, index) => [period.id, index]));
  const placeOrder = new Map(week.config.places.map((place, index) => [place.id, index]));
  return [...map.values()].sort(
    (a, b) => (periodOrder.get(a.periodId) ?? 0) - (periodOrder.get(b.periodId) ?? 0) || (placeOrder.get(a.placeId) ?? 0) - (placeOrder.get(b.placeId) ?? 0)
  );
}

function officeNames(week: ScheduleWeekPayload, date: string, placeId: string): string[] {
  return [
    ...new Set(
      week.claims
        .filter((claim) => !claim.auto && claim.date === date && claim.place === placeId)
        .map((claim) => claim.person)
    ),
  ];
}

function WeekPlan({
  week,
  actor,
  canToggle,
  saving,
  onPickPerson,
  onToggle,
}: {
  week: ScheduleWeekPayload;
  actor: string | null;
  canToggle: boolean;
  saving: boolean;
  onPickPerson?: (name: string) => void;
  onToggle: (items: { date: string; slot: string; place: string }[], on: boolean) => void;
}) {
  const today = taipeiToday();
  const upcoming = week.dates.filter((date) => date >= today);
  const rows = studioRows(week, actor).filter((row) => row.booking.slots.some((slot) => slot.date >= today));
  const seeAll = week.me.canSeeAll;
  const mine = week.stats.find((stat) => stat.name === actor) ?? week.stats[0] ?? null;
  const pendingCount = seeAll ? upcoming.reduce((sum, date) => sum + periodGroups(week, date, rows).filter((group) => group.open.length > 0).length, 0) : 0;
  const shortPeople = seeAll ? week.stats.filter((stat) => stat.met === false) : [];
  const weekDone = seeAll ? pendingCount === 0 && shortPeople.length === 0 : mine?.met !== false;
  const caption = weekCaption(week.weekStart);
  const statusText = seeAll
    ? weekDone
      ? `${caption}排完了`
      : `${caption}還沒排完`
    : mine?.met === false
      ? `你的${caption}還沒排完`
      : mine?.met
        ? `你的${caption}排完了`
        : `你的${caption}`;
  const offices = week.config.places.filter((place) => place.kind === "office");

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-stone-900 bg-stone-100 shadow-md">
      <div className="bg-stone-900 px-4 py-4 text-white sm:px-5">
        <p className="text-xs font-semibold tracking-widest text-stone-300">{caption}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">{weekRangeLabel(week.dates)}</h3>
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${weekDone ? "bg-emerald-400 text-emerald-950" : "bg-red-500 text-white"}`}>
            {statusText}
            {saving ? "　儲存中…" : ""}
          </span>
        </div>
      </div>
      <div className="space-y-4 p-3 sm:p-4">

      {seeAll && (
      <div className="grid gap-2 sm:grid-cols-2">
        <p className={`rounded-xl px-3 py-2 text-sm ${pendingCount ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}>
          {upcoming.length === 0
            ? "這週剩下的日期都已經過了"
            : pendingCount
              ? `錄音室還有 ${pendingCount} 個時段沒人`
              : "還沒過的錄音室時段都已經有人"}
        </p>
        <p className={`rounded-xl px-3 py-2 text-sm ${shortPeople.length ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}>
          {shortPeople.length
            ? `辦公室天數還沒到：${shortPeople.map((stat) => `${stat.name}差 ${Math.max(0, (stat.need ?? 0) - stat.officeDays)} 天`).join("、")}`
            : "有規定的人，辦公室天數都到了"}
        </p>
      </div>
      )}

      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {week.stats.map((stat) => {
          const selected = actor === stat.name;
          const office =
            stat.need === null ? `辦公室 ${stat.officeDays} 天` : `辦公室 ${stat.officeDays}/${stat.need} 天${stat.met ? "　到了" : ""}`;
          const className = `h-full w-full rounded-xl border px-3 py-2 text-left text-xs ${
            selected ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-stone-50 text-stone-800"
          }`;
          const body = (
            <>
              <span className="block text-sm font-semibold">{stat.name}</span>
              <span className="mt-1 block">{office}</span>
              <span className="mt-0.5 block">錄音室 {hourText(stat.studioHours)} 小時</span>
            </>
          );
          return (
            <li key={stat.name}>
              {onPickPerson ? (
                <button type="button" onClick={() => onPickPerson(stat.name)} className={className}>
                  {body}
                </button>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-stone-500">錄音室時數是這週已經排進去的小時，不算進辦公室天數。辦公室要到下面的新辦公室、小辦公室自己點。</p>

      {seeAll && (
      <div className="space-y-4">
        {upcoming.length === 0 ? <p className="rounded-xl bg-white px-3 py-3 text-sm text-stone-600">已經過的日期不排了。</p> : null}
        {upcoming.map((date) => {
          const groups = periodGroups(week, date, rows);
          const openGroups = groups.filter((group) => group.open.length > 0);
          const doneGroups = groups.filter((group) => group.open.length === 0);
          const info = week.dayInfo[date];
          const parts = weekdayParts(date);
          const isToday = date === today;
          const headerTone = isToday ? "bg-amber-400 text-stone-950" : openGroups.length ? "bg-red-600 text-white" : "bg-stone-800 text-white";
          return (
            <section key={date} className="overflow-hidden rounded-2xl border-2 border-stone-800 bg-white">
              <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${headerTone}`}>
                <p className="flex items-baseline gap-2">
                  <span className="text-xl font-bold">{parts.name}</span>
                  <span className="text-base font-semibold">{parts.day}</span>
                  {isToday ? <span className="rounded-full bg-stone-950 px-2 py-0.5 text-xs font-bold text-white">今天</span> : null}
                  {info?.holiday ? <span className="text-sm font-semibold">{info.holiday}</span> : null}
                </p>
                <p className="text-sm font-bold">
                  {groups.length === 0 ? "這天沒有錄音室預約" : openGroups.length ? `錄音室還有 ${openGroups.length} 個時段沒人` : "這天錄音室都有人"}
                </p>
              </div>
              <div className="px-3 py-3">
              <p className="text-xs text-stone-600">
                {offices
                  .map((place) => {
                    const names = officeNames(week, date, place.id);
                    return `${place.name}　${names.length ? names.join("、") : "沒有人"}`;
                  })
                  .join("　／　")}
              </p>
              {openGroups.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {openGroups.map((group) => (
                    <li key={group.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-2 py-2">
                      <div>
                        <p className="text-sm font-semibold text-stone-900">
                          {group.label}　{group.time}　{group.placeName}
                        </p>
                        <p className="text-xs text-stone-600">
                          {group.titles.join("、")}
                          {group.names.length ? `　已有 ${group.names.join("、")}` : "　還沒有人"}
                        </p>
                      </div>
                      {canToggle && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => onToggle(group.open.map((slot) => ({ date: slot.date, slot: slot.slot, place: group.placeId })), true)}
                          className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          我來排
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {doneGroups.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {doneGroups.map((group) => (
                    <li key={`${group.key}-done`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
                      <span>
                        {group.label}　{group.time}　{group.placeName}　{group.names.join("、") || "已有人"}
                      </span>
                      {canToggle && group.mine.length > 0 && (
                        <button
                          type="button"
                          disabled={saving}
                          className="underline"
                          onClick={() => onToggle(group.mine.map((slot) => ({ date: slot.date, slot: slot.slot, place: group.placeId })), false)}
                        >
                          取消我的
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              </div>
            </section>
          );
        })}
      </div>
      )}
      </div>
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

const PERIOD_FACE: Record<string, string> = { am: "早", pm: "午", eve: "晚" };

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
  const today = taipeiToday();
  const dates = week.dates.filter((date) => date >= today);
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
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-1 py-1 align-top text-stone-700">
                <span className="block font-semibold">{row.label}</span>
                <span className="text-[10px] text-stone-500">{row.time}</span>
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
                const stored = items.some((item) =>
                  week.claims.some((claim) => !claim.auto && claim.person === actor && claim.date === item.date && claim.slot === item.slot && claim.place === item.place)
                );
                const severity = items.reduce<"error" | "warn" | null>((current, item) => {
                  const hit = conflictKeys.get(`${item.date}|${item.slot}|${item.place}`);
                  if (hit === "error" || current === "error") return "error";
                  return hit ?? current;
                }, null);
                const names = [
                  ...new Set(
                    week.claims
                      .filter((claim) => !claim.auto && claim.date === date && claim.place === place.id && row.slots.includes(claim.slot))
                      .map((claim) => claim.person)
                  ),
                ];
                const bookings = week.bookings.filter(
                  (booking) => booking.placeId === place.id && booking.slots.some((slot) => slot.date === date && row.slots.includes(slot.slot))
                );
                const ring = severity === "error" ? "ring-2 ring-red-400" : severity === "warn" ? "ring-2 ring-amber-300" : "";
                return (
                  <td key={date} className="align-top">
                    <div className={`min-h-16 rounded-lg bg-white/80 px-1.5 py-1 ${ring}`}>
                      <p className="text-stone-800">{names.length ? names.join("、") : "還沒有人"}</p>
                      {bookings.map((booking) => (
                        <p key={`${booking.start}-${booking.title}`} className="mt-1 truncate text-[10px] text-stone-500">
                          {booking.kind === "follow" ? "跟錄 " : booking.kind === "own" ? "自錄 " : ""}
                          {booking.show || booking.title}
                        </p>
                      ))}
                      {canToggle && (
                        <button
                          type="button"
                          onClick={() => onToggle(items, !stored)}
                          className={`mt-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${stored ? "bg-stone-900 text-white" : "bg-white text-stone-800 ring-1 ring-stone-300"}`}
                        >
                          {stored ? "取消" : "我要到"}
                        </button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

