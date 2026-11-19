"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FollowList } from "./FollowList";
import { addDays, datesInRange, formatAttendanceDays, isDateStr, mondayOf } from "@/lib/schedule/logic";
import { bookingOverlaps, claimRanges, conflictingClaims, conflictTargets, selectionSlots, type DispatchSelection } from "@/lib/schedule/dispatch";
import type { ScheduleBooking, ScheduleConflict, ScheduleWeekPayload } from "@/lib/schedule/types";
import styles from "./ScheduleBoard.module.css";

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}
function dateLabel(date: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short" })
    .format(new Date(`${date}T12:00:00+08:00`));
}
function bookingTime(booking: ScheduleBooking) {
  const format = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" });
  const start = new Date(booking.start), end = new Date(booking.end);
  return day.format(start) === day.format(end) ? `${format.format(start)}–${format.format(end)}`
    : `${dateLabel(day.format(start))} ${format.format(start)}–${dateLabel(day.format(end))} ${format.format(end)}`;
}
async function requestWeek(url: string, options?: RequestInit): Promise<ScheduleWeekPayload & { presetAdded?: number }> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok || !body.data) throw new Error(body?.error || `班表連線失敗（${response.status}），請稍後重試`);
  return body.data;
}

export function ScheduleBoard({ canEdit }: { canEdit: boolean }) {
  const [date, setDate] = useState(todayInTaipei);
  const weekStart = mondayOf(date);
  const [page, setPage] = useState<"dispatch" | "leave" | "follow">("dispatch");
  const [data, setData] = useState<ScheduleWeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<DispatchSelection | null>(null);
  const mutation = useRef(false);
  const sequence = useRef(0);
  const editor = useRef<HTMLDivElement>(null);
  const week = data?.weekStart === weekStart ? data : null;

  useEffect(() => {
    const controller = new AbortController();
    const id = ++sequence.current;
    setLoading(true);
    setError("");
    requestWeek(`/api/schedule?week=${weekStart}${refresh ? "&force=1" : ""}`, { signal: controller.signal })
      .then((next) => { if (sequence.current === id) setData(next); })
      .catch((reason: unknown) => { if (!controller.signal.aborted && sequence.current === id) setError(reason instanceof Error ? reason.message : "讀取班表失敗"); })
      .finally(() => { if (!controller.signal.aborted && sequence.current === id) setLoading(false); });
    return () => controller.abort();
  }, [weekStart, refresh, page]);

  useEffect(() => {
    if (selection) {
      editor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      editor.current?.focus({ preventScroll: true });
    }
  }, [selection]);

  function navigate(next: string) {
    if (mutation.current || !isDateStr(next)) return;
    setDate(next); setSelection(null); setNotice("");
  }
  async function mutate(person: string, target: DispatchSelection, on: boolean) {
    if (!week || !canEdit || mutation.current) return;
    mutation.current = true;
    setSaving(true); setError(""); setNotice("");
    try {
      const leavePlace = week.config.places.find((item) => item.kind === "leave")?.id;
      const isLeave = target.place === leavePlace;
      const days = isLeave ? datesInRange(target.date, target.endDate ?? target.date) : [target.date];
      const items = days.flatMap((day) => target.slots.map((slot) => ({ date: day, place: target.place, slot })));
      const next = await requestWeek("/api/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: week.weekStart, person, on, items }),
      });
      const label = isLeave ? "請假" : "班次";
      const span = isLeave && days.length > 1 ? `（${days.length} 天）` : "";
      setData(next); setNotice(`${person}的${label}${span}已${on ? "儲存" : "取消"}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "儲存失敗，請重試"); }
    finally { mutation.current = false; setSaving(false); }
  }
  async function preset() {
    if (!week || !canEdit || mutation.current) return;
    mutation.current = true;
    setSaving(true); setError(""); setNotice("");
    try {
      const next = await requestWeek("/api/schedule/preset", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart }),
      });
      setData(next); setNotice(next.presetAdded ? `已補上 ${next.presetAdded} 個半小時班次` : "本週沒有需要補上的跟錄班次");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "預排失敗，請重試"); }
    finally { mutation.current = false; setSaving(false); }
  }

  const locked = saving || loading;
  const dayIssues = week?.conflicts.filter((issue) => issue.cells.some((cell) => cell.date === date)) ?? [];
  const weeklyIssues = week?.conflicts.filter((issue) => issue.cells.length === 0) ?? [];
  const canSchedule = canEdit && !!week && (week.me.canEditAnyone || !!week.me.person);
  return (
    <section className={styles.board} aria-label="場地班表" aria-busy={loading || saving}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>DAILY OPERATIONS</p><h2>場地調度</h2><p className={styles.subtitle}>先看場地，再安排人。預約、值班與待排班事項，一起掌握。</p></div>
        <nav className={styles.tabs} aria-label="班表功能">
          <button type="button" aria-pressed={page === "dispatch"} disabled={saving} onClick={() => { setPage("dispatch"); setSelection(null); }}>場地班表</button>
          <button type="button" aria-pressed={page === "leave"} disabled={saving} onClick={() => { setPage("leave"); setSelection(null); }}>請假</button>
          <button type="button" aria-pressed={page === "follow"} disabled={saving} onClick={() => { setPage("follow"); setSelection(null); }}>跟錄名單</button>
        </nav>
      </header>
      {page === "follow" ? <FollowList people={data?.config.people.map((person) => person.name) ?? []} canMutate={canEdit} /> : <>
        <div className={styles.toolbar}>
          <div className={styles.row}>
            <button type="button" disabled={locked} onClick={() => navigate(addDays(date, -7))} aria-label="上一週">←</button>
            <h3>{dateLabel(weekStart)} — {dateLabel(addDays(weekStart, 6))}</h3>
            <button type="button" disabled={locked} onClick={() => navigate(addDays(date, 7))} aria-label="下一週">→</button>
            <button type="button" disabled={saving} onClick={() => navigate(todayInTaipei())}>今天</button>
          </div>
          <div className={styles.row}>
            <label className={styles.datePicker}>跳至日期<input type="date" aria-label="跳至日期" value={date} disabled={saving} onChange={(event) => navigate(event.target.value)} /></label>
            {page === "dispatch" && <button type="button" disabled={locked} onClick={() => setRefresh((value) => value + 1)}>{loading ? "讀取中…" : "同步日曆"}</button>}
          </div>
        </div>
        <div className={styles.days} aria-label="選擇日期">
          {Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).map((day) => {
            const leavePlaceId = week?.config.places.find((place) => place.kind === "leave")?.id;
            const issueCount = page === "dispatch"
              ? week?.conflicts.filter((issue) => issue.cells.some((cell) => cell.date === day)).length ?? 0
              : leavePlaceId
                ? new Set(week?.claims.filter((claim) => claim.date === day && claim.place === leavePlaceId).map((claim) => claim.person)).size
                : 0;
            return <button type="button" key={day} aria-pressed={day === date} disabled={saving} onClick={() => navigate(day)}>
              <span>{dateLabel(day)}</span><small>{week?.dayInfo[day]?.holiday || (day === todayInTaipei() ? "今天" : week?.dayInfo[day]?.weekend ? "週末" : "平日")}</small>
              {issueCount > 0 && <span className={styles.dayCount}>{page === "dispatch" ? `${issueCount} 件待排班` : `${issueCount} 人請假`}</span>}
            </button>;
          })}
        </div>
        {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" disabled={locked} onClick={() => setRefresh((value) => value + 1)}>重新讀取</button></div>}
        <p className={styles.notice} role="status">{saving ? "正在儲存…" : notice}</p>
        {page === "dispatch" && week?.warnings.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
        {!week ? <div className={styles.empty}>{loading ? "正在載入場地預約與人員班表…" : "尚未取得班表，請重新讀取。"}</div> : page === "leave" ? (
          <LeavePage week={week} date={date} disabled={locked} canSchedule={canSchedule} selection={selection} editorRef={editor} onPickDay={navigate} onSelect={setSelection} onClose={() => setSelection(null)} onSave={mutate} />
        ) : <>
          {!week.me.canSeeAll && <p className={styles.scope}>目前依權限只顯示{week.me.person ? `${week.me.person}自己的排班與相關提醒` : "錄音預約"}；空白格不代表其他同仁沒有排班。</p>}
          <div className={styles.layout}>
            <div className={styles.main}>
              <div className={styles.matrix}>
                <div className={styles.matrixHeader}><h3>{dateLabel(date)} · 場地安排</h3><span className={styles.muted}>{week.me.canSeeAll ? "全員班表" : "個人班表"}</span></div>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead><tr><th scope="col">場地</th>{week.config.periods.map((period) => <th scope="col" key={period.id}>{period.label}<span>{period.start}–{period.end}</span></th>)}</tr></thead>
                    <tbody>{week.config.places.filter((place) => place.kind !== "leave").map((place) => <tr key={place.id}>
                      <th scope="row">{place.name}<span>{
                        place.id === "smallOffice" || place.id === "smallStudio"
                          ? "同一空間 · 值班／跟錄"
                          : place.kind === "studio" ? "預約與跟錄" : "辦公與值班"
                      }</span></th>
                      {week.config.periods.map((period) => {
                        const slots = week.config.slots.filter((slot) => slot.period === period.id && place.slots.includes(slot.id));
                        const ids = slots.map((slot) => slot.id);
                        const claims = week.claims.filter((claim) => claim.date === date && claim.place === place.id && ids.includes(claim.slot));
                        const bookings = week.bookings.filter((booking) => booking.placeId === place.id && bookingOverlaps(booking.start, booking.end, date, period.start, period.end));
                        const ranges = claimRanges(claims, slots);
                        const issues = dayIssues.filter((issue) => issue.cells.some((cell) => cell.date === date && cell.place === place.id && ids.includes(cell.slot)));
                        const selected = selection?.date === date && selection.place === place.id && selection.slots.some((slot) => ids.includes(slot));
                        return <td key={period.id} data-period={`${period.label} · ${period.start}–${period.end}`} className={selected ? styles.selectedCell : undefined}>
                          {!slots.length ? <p className={styles.muted}>非開放時段</p> : <div className={styles.cell}>
                            {bookings.map((booking, index) => <div className={styles.booking} key={`${booking.start}-${index}`}>
                              <span className={styles.micro}>日曆預約 · {booking.kind === "follow" ? "需跟錄" : booking.kind === "own" ? "自有節目" : "一般預約"}</span>
                              <strong>{booking.show || booking.title}</strong><span>{bookingTime(booking)}</span>
                              {booking.andyRecording && <small>安迪訪談</small>}
                            </div>)}
                            {place.kind === "studio" && !bookings.length && <p className={styles.muted}>{week.warnings.length ? "目前未讀到預約" : "無預約"}</p>}
                            {ranges.length > 0 && <span className={styles.micro}>值班人員</span>}
                            {ranges.map((range) => <button type="button" className={styles.claim} key={`${range.person}-${range.start}-${range.auto}`} disabled={locked} onClick={() => setSelection({ date, place: place.id, slots: range.slots, person: range.person })}>
                              <strong>{range.person}<span>{range.auto ? "↻ 自動" : "手動"}</span></strong><small>{range.start}–{range.end}</small>
                            </button>)}
                            {!ranges.length && <p className={styles.muted}>{week.me.canSeeAll ? "尚未排班" : "沒有你的班次"}</p>}
                            {issues.length > 0 && <button type="button" className={styles.cellIssue} disabled={locked} onClick={() => setSelection({ date, place: place.id, slots: ids })}>{issues.length} 件待排班 ↗</button>}
                            <button type="button" className={styles.add} disabled={locked} onClick={() => setSelection({ date, place: place.id, slots: ids })}>{canSchedule ? "＋ 安排班次" : "查看時段"}</button>
                          </div>}
                        </td>;
                      })}
                    </tr>)}</tbody>
                  </table>
                </div>
                <footer className={styles.matrixFoot}><span>預約來自 Google 日曆 · 值班來自 ERP</span><span>↻ 自動班次依會議／跟錄規則帶入</span></footer>
              </div>
              <details className={styles.weekSummary}><summary>本週到班天數（早／午各 0.5 天）</summary><div className={styles.stats}>{week.stats.map((stat) => <div key={stat.name}><strong>{stat.name}</strong><p>到班 {formatAttendanceDays(stat.officeDays)}{stat.need !== null ? ` / ${stat.need}` : ""} 天</p><small>辦公室＋錄音室合計 · 早或午各 0.5 · 其中錄音 {stat.studioHours} 小時{stat.adjusted ? " · 已調整應到天數" : ""}</small></div>)}</div></details>
            </div>
            <aside className={styles.sidebar} aria-label="班次調整與待排班事項">
              {selection && <div ref={editor} tabIndex={-1} className={styles.editorFocus}>
                <ShiftEditor key={`${selection.date}-${selection.place}-${selection.slots.join(",")}-${selection.person ?? ""}`} week={week} selection={selection} canEdit={canSchedule} saving={locked} onClose={() => setSelection(null)} onSave={mutate} />
              </div>}
              <div className={styles.panel}><p className={styles.eyebrow}>ACTION QUEUE</p><div className={styles.queueHeading}><h3>待排班事項</h3><span className={styles.badge}>{dayIssues.length}</span></div>
                <p className={styles.muted}>{dateLabel(date)}{week.me.canSeeAll ? " · 全員" : " · 你的相關提醒"}</p>
                {dayIssues.length === 0 && <p className={styles.clear}>{week.warnings.length ? "目前資料沒有待排班事項；日曆讀取仍有警告。" : "目前沒有待排班事項。"}</p>}
                {dayIssues.map((issue, index) => <Issue key={`${issue.type}-${index}`} issue={issue} week={week} date={date} disabled={locked} onSelect={setSelection} />)}
                {weeklyIssues.length > 0 && <details className={styles.weeklyIssues}><summary>本週其他提醒（{weeklyIssues.length}）</summary>{weeklyIssues.map((issue, index) => <p key={index}>{issue.message}</p>)}</details>}
              </div>
              {canSchedule && (week.me.canEditAnyone || week.config.presetPeople.includes(week.me.person ?? "")) && week.config.presetPeople.length > 0 && <div className={styles.panel}><h3>跟錄預排</h3><p className={styles.muted}>依跟錄名單，補上{week.me.canEditAnyone ? week.config.presetPeople.join("、") : week.me.person}本週可預排的班次。</p><button type="button" className={styles.fullButton} disabled={locked} onClick={() => void preset()}>補上本週跟錄班次</button></div>}
            </aside>
          </div>
        </>}
      </>}
    </section>
  );
}

function Issue({ issue, week, date, disabled, onSelect }: { issue: ScheduleConflict; week: ScheduleWeekPayload; date: string; disabled: boolean; onSelect: (target: DispatchSelection) => void }) {
  const targets = conflictTargets(issue, date, week.config.slots);
  return <div className={styles.issue}><span className={issue.severity === "error" ? styles.urgent : styles.attention}>{issue.severity === "error" ? "需要處理" : "提醒"}</span><p>{issue.message}</p><div className={styles.issueActions}>{targets.map((target) => {
    const slots = selectionSlots(week, target);
    return slots.length > 0 && <button type="button" disabled={disabled} key={`${target.place}-${target.slots[0]}`} onClick={() => onSelect(target)}>{week.config.places.find((place) => place.id === target.place)?.short} {slots[0].start}–{slots[slots.length - 1].end} →</button>;
  })}</div></div>;
}
function leaveSlotsFor(place: ScheduleWeekPayload["config"]["places"][number], week: ScheduleWeekPayload) {
  return week.config.slots.filter((slot) => slot.period !== "eve" && place.slots.includes(slot.id)).map((slot) => slot.id);
}

function personLeaveEntries(week: ScheduleWeekPayload, placeId: string, person: string, days: string[]) {
  return days.flatMap((day) =>
    claimRanges(
      week.claims.filter((claim) => claim.date === day && claim.place === placeId && claim.person === person),
      week.config.slots
    ).map((range) => ({ date: day, ...range }))
  );
}

function LeavePage({
  week, date, disabled, canSchedule, selection, editorRef, onPickDay, onSelect, onClose, onSave,
}: {
  week: ScheduleWeekPayload;
  date: string;
  disabled: boolean;
  canSchedule: boolean;
  selection: DispatchSelection | null;
  editorRef: RefObject<HTMLDivElement | null>;
  onPickDay: (day: string) => void;
  onSelect: (target: DispatchSelection) => void;
  onClose: () => void;
  onSave: (person: string, selection: DispatchSelection, on: boolean) => Promise<void>;
}) {
  const place = week.config.places.find((item) => item.kind === "leave");
  if (!place) return <div className={styles.empty}>尚未設定請假場地。</div>;
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.weekStart, index));
  const people = week.me.canSeeAll
    ? week.config.people
    : week.config.people.filter((person) => person.name === week.me.person);
  const dayClaims = week.claims.filter((claim) => claim.date === date && claim.place === place.id);
  const ranges = claimRanges(dayClaims, week.config.slots);
  const todayOnLeave = [...new Set(ranges.map((range) => range.person))];
  const weekLeavePeople = people
    .map((person) => ({
      name: person.name,
      entries: personLeaveEntries(week, place.id, person.name, days),
    }))
    .filter((row) => row.entries.length > 0);
  const weekCount = new Set(week.claims.filter((claim) => claim.place === place.id).map((claim) => `${claim.person}|${claim.date}`)).size;
  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        {!week.me.canSeeAll && <p className={styles.scope}>目前依權限只顯示{week.me.person ? `${week.me.person}自己的請假` : "可查看範圍"}。</p>}
        <div className={styles.matrix}>
          <div className={styles.matrixHeader}>
            <h3>目前請假情形</h3>
            <span className={styles.muted}>{week.me.canSeeAll ? "全員" : "僅顯示本人"} · 本週 {weekCount} 筆日次</span>
          </div>
          <div className={styles.leaveStatusBody}>
            <div className={styles.leaveToday}>
              <p className={styles.eyebrow}>SELECTED DAY</p>
              <div className={styles.leaveTodayHead}>
                <h4>{dateLabel(date)}</h4>
                <span className={todayOnLeave.length ? styles.leaveTodayCount : styles.muted}>
                  {todayOnLeave.length ? `${todayOnLeave.length} 人請假` : "無人請假"}
                </span>
              </div>
              <div className={styles.leaveList}>
                {ranges.map((range) => (
                  <button
                    type="button"
                    className={styles.leaveCard}
                    disabled={disabled}
                    key={`${range.person}-${range.start}`}
                    onClick={() => onSelect({ date, place: place.id, slots: range.slots, person: range.person })}
                  >
                    <strong>{range.person}</strong>
                    <span>{range.start}–{range.end}</span>
                  </button>
                ))}
                {!ranges.length && <p className={styles.muted}>這天沒有請假紀錄</p>}
              </div>
            </div>
            <div className={styles.leaveRoster}>
              <p className={styles.eyebrow}>THIS WEEK</p>
              <h4>本週各員請假</h4>
              <div className={styles.leaveRosterList}>
                {people.map((person) => {
                  const entries = personLeaveEntries(week, place.id, person.name, days);
                  const onSelectedDay = entries.some((entry) => entry.date === date);
                  return (
                    <div key={person.name} className={onSelectedDay ? styles.leaveRosterRowActive : styles.leaveRosterRow}>
                      <div className={styles.leaveRosterName}>
                        <strong>{person.name}</strong>
                        <small>{entries.length ? `${entries.length} 段` : "本週無請假"}</small>
                      </div>
                      <div className={styles.leaveRosterEntries}>
                        {entries.length === 0 ? (
                          <span className={styles.muted}>—</span>
                        ) : (
                          entries.map((entry) => (
                            <button
                              type="button"
                              key={`${person.name}-${entry.date}-${entry.start}`}
                              disabled={disabled}
                              className={entry.date === date ? styles.leaveEntryActive : undefined}
                              onClick={() => {
                                onPickDay(entry.date);
                                onSelect({ date: entry.date, place: place.id, slots: entry.slots, person: person.name });
                              }}
                            >
                              {dateLabel(entry.date)} · {entry.start}–{entry.end}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!weekLeavePeople.length && <p className={styles.leaveRosterEmpty}>本週目前沒有任何人請假。</p>}
            </div>
            {canSchedule && (
              <button
                type="button"
                className={styles.add}
                disabled={disabled}
                onClick={() => onSelect({ date, place: place.id, slots: leaveSlotsFor(place, week), endDate: date })}
              >
                ＋ 登記請假
              </button>
            )}
          </div>
          <footer className={styles.matrixFoot}>
            <span>請假會影響跟錄自動排班與小辦公室值班檢查</span>
            <span>可連請多天；晚間時段不開放請假</span>
          </footer>
        </div>
        <div className={styles.leaveWeek}>
          <div className={styles.matrixHeader}><h3>本週請假日曆</h3><span className={styles.muted}>{dateLabel(week.weekStart)} — {dateLabel(addDays(week.weekStart, 6))}</span></div>
          <div className={styles.leaveWeekGrid}>
            {days.map((day) => {
              const dayRanges = claimRanges(week.claims.filter((claim) => claim.date === day && claim.place === place.id), week.config.slots);
              return (
                <div key={day} className={day === date ? styles.leaveDayActive : styles.leaveDay}>
                  <button type="button" className={styles.leaveDayHead} disabled={disabled} onClick={() => onPickDay(day)}>
                    <strong>{dateLabel(day)}</strong>
                    <small>{dayRanges.length ? `${[...new Set(dayRanges.map((range) => range.person))].length} 人` : "無人"}</small>
                  </button>
                  <div className={styles.leaveDayBody}>
                    {dayRanges.map((range) => (
                      <button
                        type="button"
                        key={`${day}-${range.person}-${range.start}`}
                        disabled={disabled}
                        onClick={() => { onPickDay(day); onSelect({ date: day, place: place.id, slots: range.slots, person: range.person }); }}
                      >
                        {range.person}<span>{range.start}–{range.end}</span>
                      </button>
                    ))}
                    {!dayRanges.length && <span className={styles.muted}>—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <aside className={styles.sidebar} aria-label="請假登記">
        {selection && selection.place === place.id ? (
          <div ref={editorRef} tabIndex={-1} className={styles.editorFocus}>
            <ShiftEditor
              key={`${selection.date}-${selection.place}-${selection.slots.join(",")}-${selection.person ?? ""}`}
              week={week}
              selection={selection}
              canEdit={canSchedule}
              saving={disabled}
              onClose={onClose}
              onSave={onSave}
            />
          </div>
        ) : (
          <div className={styles.panel}>
            <p className={styles.eyebrow}>LEAVE DESK</p>
            <h3>登記請假</h3>
            <p className={styles.muted}>上方可看全員本週請假；也可選連續起迄一次登記多天。</p>
            {todayOnLeave.length > 0 && (
              <p className={styles.leaveAsideNote}>{dateLabel(date)} 請假：{todayOnLeave.join("、")}</p>
            )}
            {canSchedule && (
              <button
                type="button"
                className={styles.fullButton}
                disabled={disabled}
                onClick={() => onSelect({ date, place: place.id, slots: leaveSlotsFor(place, week), endDate: date })}
              >
                ＋ 登記請假（可連請多天）
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
function ShiftEditor({ week, selection, canEdit, saving, onClose, onSave }: {
  week: ScheduleWeekPayload; selection: DispatchSelection; canEdit: boolean; saving: boolean;
  onClose: () => void; onSave: (person: string, selection: DispatchSelection, on: boolean) => Promise<void>;
}) {
  const place = week.config.places.find((item) => item.id === selection.place)!;
  const isLeave = place.kind === "leave";
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(week.weekStart, index));
  const initialSlots = selectionSlots(week, selection);
  const availableSlots = week.config.slots.filter((slot) => place.slots.includes(slot.id) && (!isLeave || slot.period !== "eve"));
  const [person, setPerson] = useState((week.me.canEditAnyone ? selection.person : null) ?? week.me.person ?? (week.me.canEditAnyone ? week.config.people[0]?.name ?? "" : ""));
  const [fromDate, setFromDate] = useState(selection.date);
  const [toDate, setToDate] = useState(selection.endDate ?? selection.date);
  const [start, setStart] = useState(initialSlots[0]?.start ?? "");
  const [end, setEnd] = useState(initialSlots.at(-1)?.end ?? "");
  const chosenSlots = availableSlots.filter((slot) => slot.start >= start && slot.end <= end);
  const days = isLeave ? datesInRange(fromDate, toDate).filter((day) => weekDays.includes(day)) : [selection.date];
  const target: DispatchSelection = {
    ...selection,
    date: days[0] ?? selection.date,
    endDate: isLeave ? (days.at(-1) ?? selection.date) : undefined,
    slots: chosenSlots.map((slot) => slot.id),
  };
  const overlaps = days.flatMap((day) => conflictingClaims(week, { ...target, date: day }, person));
  const claims = week.claims.filter((claim) => days.includes(claim.date) && claim.place === target.place && target.slots.includes(claim.slot));
  const ownManual = claims.filter((claim) => claim.person === person && !claim.auto);
  const allAssigned = target.slots.length > 0 && days.length > 0 && days.every((day) =>
    target.slots.every((slot) => claims.some((claim) => claim.person === person && claim.date === day && claim.slot === slot))
  );
  const editable = canEdit && !!person && (week.me.canEditAnyone || person === week.me.person);
  const ranges = claimRanges(claims.filter((claim) => claim.date === (days[0] ?? selection.date)), chosenSlots);
  const people = week.me.canEditAnyone ? week.config.people : week.config.people.filter((item) => item.name === week.me.person);
  const spanLabel = isLeave && days.length > 1
    ? `${dateLabel(days[0])} — ${dateLabel(days[days.length - 1])} · ${days.length} 天`
    : `${dateLabel(days[0] ?? selection.date)} · ${place.name}`;
  return <div className={styles.panel}><div className={styles.queueHeading}><h3>{isLeave ? "登記請假" : "安排班次"}</h3><button type="button" aria-label="關閉班次編輯" disabled={saving} onClick={onClose}>×</button></div><p className={styles.muted}>{spanLabel}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (editable && chosenSlots.length && days.length && !saving) void onSave(person, target, true); }}>
      <label className={styles.field}>人員<select value={person} disabled={!canEdit || saving} onChange={(event) => setPerson(event.target.value)}>{!person && <option value="">沒有可編輯的人員</option>}{people.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      {isLeave && <div className={styles.timeFields}>
        <label className={styles.field}>開始日期<select value={fromDate} disabled={saving} onChange={(event) => { const next = event.target.value; setFromDate(next); if (toDate < next) setToDate(next); }}>{weekDays.map((day) => <option key={day} value={day}>{dateLabel(day)}</option>)}</select></label>
        <label className={styles.field}>結束日期<select value={toDate} disabled={saving} onChange={(event) => { const next = event.target.value; setToDate(next); if (fromDate > next) setFromDate(next); }}>{weekDays.map((day) => <option key={day} value={day}>{dateLabel(day)}</option>)}</select></label>
      </div>}
      <div className={styles.timeFields}><label className={styles.field}>{isLeave ? "每日開始" : "開始"}<select value={start} disabled={saving} onChange={(event) => { const next = event.target.value; setStart(next); if (end <= next) setEnd(availableSlots.find((slot) => slot.start === next)!.end); }}>{availableSlots.map((slot) => <option key={slot.id} value={slot.start}>{slot.start}</option>)}</select></label>
        <label className={styles.field}>{isLeave ? "每日結束" : "結束"}<select value={end} disabled={saving} onChange={(event) => setEnd(event.target.value)}>{availableSlots.filter((slot) => slot.start >= start).map((slot) => <option key={slot.id} value={slot.end}>{slot.end}</option>)}</select></label></div>
      {isLeave && days.length > 1 && <p className={styles.muted}>將以相同每日時段，一次登記 {days.length} 天（僅限本週）。</p>}
      {overlaps.length > 0 && <p className={styles.editorWarning}>此人同時段已有{[...new Set(overlaps.map((claim) => week.config.places.find((item) => item.id === claim.place)?.name))].join("、")}的安排。新增不會取消原班次，請先確認。</p>}
      {!isLeave && !week.config.offStaff.includes(person) && (!week.dayInfo[selection.date]?.workday || chosenSlots.some((slot) => slot.period === "eve")) && <p className={styles.editorWarning}>假日與晚間原則上由{week.config.offStaff.join("、")}排班。</p>}
      {editable ? <><button type="submit" className={styles.primary} disabled={saving || !chosenSlots.length || !days.length || allAssigned}>{saving ? "儲存中…" : allAssigned ? (isLeave ? "這段日期與時段都已請假" : "此人已排入這段時間") : isLeave ? (days.length > 1 ? `確認連請 ${days.length} 天` : "確認登記請假") : "確認安排"}</button>
        {ownManual.length > 0 && <button type="button" className={styles.remove} disabled={saving} onClick={() => void onSave(person, { ...target, slots: [...new Set(ownManual.map((claim) => claim.slot))] }, false)}>取消{person}這段{isLeave ? (days.length > 1 ? `請假（${days.length} 天）` : "請假") : "手動排班"}</button>}</> : <p className={styles.muted}>目前帳號僅可查看此時段。</p>}
    </form>
    <div className={styles.currentClaims}><h4>{isLeave ? (days.length > 1 ? "範圍內既有請假" : "這段時間的請假") : "這段時間的人員"}</h4>
      {isLeave && days.length > 1 ? (
        days.some((day) => claims.some((claim) => claim.date === day))
          ? days.map((day) => {
              const dayRanges = claimRanges(claims.filter((claim) => claim.date === day), chosenSlots);
              if (!dayRanges.length) return null;
              return <div key={day} className={styles.leaveRangeDay}><strong>{dateLabel(day)}</strong>{dayRanges.map((range) => <span key={`${day}-${range.person}-${range.start}`}>{range.person} {range.start}–{range.end}</span>)}</div>;
            })
          : <p className={styles.muted}>{week.me.canSeeAll ? "尚未安排" : "沒有你的請假"}</p>
      ) : ranges.length === 0 ? <p className={styles.muted}>{week.me.canSeeAll ? "尚未安排" : "沒有你的班次"}</p> : ranges.map((range) => <div key={`${range.person}-${range.start}-${range.auto}`}><strong>{range.person}</strong><span>{range.start}–{range.end}</span><small>{range.auto ? "↻ 自動帶入，請調整來源或登記請假" : "手動排班"}</small></div>)}
    </div>
  </div>;
}
