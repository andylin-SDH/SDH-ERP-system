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
    const next = await loadPair(taipeiMonday(), force);
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

  const futureStart = futureAnchor || addDays(taipeiMonday(), 14);
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
    const min = addDays(taipeiMonday(), 14);
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
            ? `你是${identity.me.person}。一天分早、午、晚，按鈕只會加上或拿掉${identity.me.canEditAnyone ? "你選的那一位" : "你"}。`
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
          earlierLabel={page === "future" && futureStart > addDays(taipeiMonday(), 14) ? "← 前兩週" : undefined}
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
const GLANCE_PERIOD_LABEL: Record<string, string> = { am: "早", pm: "中", eve: "晚" };

function glanceCell(week: ScheduleWeekPayload, actor: string | null, date: string, placeId: string, periodId: string) {
  const place = week.config.places.find((item) => item.id === placeId);
  const slots = week.config.slots.filter((slot) => slot.period === periodId && place?.slots.includes(slot.id));
  if (!place || slots.length === 0) return null;
  const slotIds = new Set(slots.map((slot) => slot.id));
  const items = slots.map((slot) => ({ date, slot: slot.id, place: placeId }));
  const people = [
    ...new Set(
      week.claims
        .filter((claim) => !claim.auto && claim.date === date && claim.place === placeId && slotIds.has(claim.slot))
        .map((claim) => claim.person)
    ),
  ];
  const titles = week.bookings
    .filter((booking) => booking.placeId === placeId && booking.slots.some((slot) => slot.date === date && slotIds.has(slot.slot)))
    .map((booking) => booking.show || booking.title)
    .filter((title, index, all) => title && title !== "Busy" && all.indexOf(title) === index);
  const hasBooking = week.bookings.some(
    (booking) => booking.placeId === placeId && booking.slots.some((slot) => slot.date === date && slotIds.has(slot.slot))
  );
  return {
    place,
    items,
    people,
    titles,
    hasBooking,
    needsStaff: place.kind === "studio" && hasBooking && people.length === 0,
    actorOn: !!actor && people.includes(actor),
  };
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
            <tr>
              {week.dates.map((date) => {
                const [y, m, d] = date.split("-").map(Number);
                const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
                const weekend = wd === 0 || wd === 6;
                const past = date < today;
                const editable = canToggle && !!actor && !past;
                return (
                  <td key={date} className={`min-w-[8.5rem] border-t border-stone-100 px-1.5 py-1.5 align-top ${weekend ? "bg-stone-50/80" : ""} ${past ? "opacity-70" : ""}`}>
                    <div className="flex flex-col gap-2">
                      {week.config.periods.map((period) => (
                        <div key={period.id}>
                          <p className="mb-1 text-[10px] font-bold tracking-wide text-stone-500">{GLANCE_PERIOD_LABEL[period.id] ?? period.label}</p>
                          <div className="flex flex-col gap-1">
                            {GLANCE_PLACE_IDS.map((placeId) => {
                              const cell = glanceCell(week, actor, date, placeId, period.id);
                              if (!cell) return null;
                              const tone = cell.needsStaff
                                ? "border-red-300 bg-red-50 text-red-900"
                                : cell.actorOn
                                  ? BLOCK_TONE[placeId]
                                  : cell.hasBooking
                                    ? "border-amber-200 bg-amber-50 text-amber-950"
                                    : "border-stone-200 bg-white text-stone-500";
                              return (
                                <button
                                  key={placeId}
                                  type="button"
                                  disabled={!editable || saving}
                                  onClick={() => editable && onToggle(cell.items, !cell.actorOn)}
                                  className={`rounded-md border px-1.5 py-1 text-left ${tone} ${editable ? "cursor-pointer hover:brightness-95" : "cursor-default"} disabled:cursor-default`}
                                >
                                  <span className="block text-[11px] font-bold leading-tight">{cell.place.name}</span>
                                  {cell.titles[0] ? <span className="block truncate text-[10px]">{cell.titles.join("、")}</span> : null}
                                  {cell.needsStaff ? <span className="block text-[10px] font-semibold">要排人</span> : null}
                                  {cell.people.length > 0 ? <span className="block truncate text-[10px]">{cell.people.join("、")}</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-stone-100 px-3 py-2 text-[11px] text-stone-500">
        一天只分早、中、晚。錄音室那個時段有錄音、又還沒人，會標「要排人」。點一下是排上或取消你自己。已過的日期不能改。請假稍後再做。
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

