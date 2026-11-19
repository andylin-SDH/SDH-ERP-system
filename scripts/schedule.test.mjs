import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEDULE_CONFIG as cfg } from '../src/lib/schedule/config.server.ts';
import { expandStoredClaims, planStoredClaimChange, mondayOf, bookingSlots } from '../src/lib/schedule/logic.ts';
import { claimRanges, conflictTargets, bookingOverlaps, conflictingClaims } from '../src/lib/schedule/dispatch.ts';

const date = '2026-11-18';
const week = '2026-11-16';
const claim = (slot, place = 'smallOffice', person = '克萊', auto = false) => ({ date, slot, place, person, auto });
const item = (slot, place = 'smallOffice') => ({ date, slot, place });
const apply = (stored, plan) => {
  const key = row => `${row.person}|${row.date}|${row.slot}|${row.place}`;
  const removed = new Set(plan.remove.map(key));
  return expandStoredClaims([...stored.filter(row => !removed.has(key(row))), ...plan.add], cfg);
};

test('range grouping retains gaps, exact half-hours, people, and automatic sources', () => {
  const result = claimRanges([claim('m0900'), claim('m0930'), claim('m1030'), claim('m1100', 'smallOffice', '克萊', true), claim('m0900', 'smallOffice', 'IVY')], cfg.SLOTS);
  assert.deepEqual(result.map(r => [r.person, r.start, r.end, r.auto]), [
    ['克萊','09:00','10:00',false], ['克萊','10:30','11:00',false], ['克萊','11:00','11:30',true], ['IVY','09:00','09:30',false],
  ]);
});
test('issue actions do not combine disjoint times or different dates/places', () => {
  const result = conflictTargets({ type:'DOUBLE_BOOKED', severity:'error', message:'test', cells:[item('m0900'),item('m1000'),item('m0900','bigStudio'),{...item('m0900'),date:'2026-11-19'}]},date,cfg.SLOTS);
  assert.deepEqual(result.map(r => [r.place,r.slots]), [['smallOffice',['m0900']],['smallOffice',['m1000']],['bigStudio',['m0900']]]);
});
test('calendar periods use Taipei overlap and exclude touching boundaries', () => {
  assert.equal(bookingOverlaps('2026-11-18T05:30:00Z','2026-11-18T06:00:00Z',date,'09:00','13:30'),false);
  assert.equal(bookingOverlaps('2026-11-18T05:30:00Z','2026-11-18T06:00:00Z',date,'13:30','18:00'),true);
  assert.equal(bookingOverlaps('2026-11-17T23:00:00Z','2026-11-18T02:00:00Z',date,'09:00','13:30'),true);
});
test('half-hour legacy cancellation keeps the unselected half and other people', () => {
  const stored = [claim('h09'),claim('h09','smallOffice','IVY')];
  const plan = planStoredClaimChange(week,'克萊',[item('m0900')],false,stored,cfg);
  assert.equal(plan.error,undefined);
  assert.deepEqual(apply(stored,plan).filter(r=>r.person==='克萊').map(r=>r.slot),['m0930']);
  assert.equal(apply(stored,plan).filter(r=>r.person==='IVY').length,2);
});
test('adding an already-present half of a legacy hour preserves both halves', () => {
  const stored = [claim('h09')];
  const plan = planStoredClaimChange(week,'克萊',[item('m0900')],true,stored,cfg);
  assert.deepEqual(apply(stored,plan).map(r=>r.slot),['m0900','m0930']);
});
test('moving follower to studio converts the legacy backup without leaving double booking', () => {
  const stored = [claim('h09','smallOffice','五吉郎')];
  const plan = planStoredClaimChange(week,'五吉郎',[item('m0900','bigStudio')],true,stored,cfg);
  const result = apply(stored,plan);
  assert.deepEqual(result.map(r=>[r.slot,r.place]).sort(),[['m0900','bigStudio'],['m0930','smallOffice']]);
});
test('single backup assignment is rejected while follower is in big studio', () => {
  const plan = planStoredClaimChange(week,'五吉郎',[item('m0900')],true,[claim('m0900','bigStudio','五吉郎')],cfg);
  assert.match(plan.error,/大錄音室/);
});
test('small studio and small office count as the same site for the follower', () => {
  const plan = planStoredClaimChange(week,'五吉郎',[item('m0900')],true,[claim('m0900','smallStudio','五吉郎')],cfg);
  assert.equal(plan.error, undefined);
  assert.equal(plan.add.some((row) => row.place === 'smallOffice' && row.slot === 'm0900'), true);
});
test('empty small office is fine when follower is not pulled to the big studio', async () => {
  const { findConflicts, buildDayInfo } = await import('../src/lib/schedule/logic.ts');
  const dayInfo = buildDayInfo(week, {}, cfg);
  const conflicts = findConflicts(week, [], [], dayInfo, cfg);
  assert.equal(conflicts.some((item) => item.type === 'UNDERSTAFFED' && item.message.includes('小辦公室')), false);
});
test('big-studio follow without cover staff still needs backup', async () => {
  const { findConflicts, buildDayInfo, effectiveClaims } = await import('../src/lib/schedule/logic.ts');
  const dayInfo = buildDayInfo(week, {}, cfg);
  const bookings = [{
    calendar: '大錄音室', placeId: 'bigStudio', color: '#000', title: '灃食', start: `${date}T09:00:00+08:00`, end: `${date}T10:00:00+08:00`,
    kind: 'follow', show: '灃食 食光餐桌', owner: '', companions: ['維尼'], andyRecording: false,
    slots: [{ date, slot: 'm0900' }, { date, slot: 'm0930' }],
  }];
  const claims = effectiveClaims(week, [], bookings, dayInfo, cfg).claims;
  const conflicts = findConflicts(week, [], bookings, dayInfo, cfg);
  assert.equal(claims.some((row) => row.person === '五吉郎' && row.place === 'bigStudio'), true);
  assert.equal(conflicts.some((item) => item.type === 'BACKUP_MISSING'), true);
});
test('small-studio follow also needs another person at the office', async () => {
  const { findConflicts, buildDayInfo, effectiveClaims } = await import('../src/lib/schedule/logic.ts');
  const dayInfo = buildDayInfo(week, {}, cfg);
  const bookings = [{
    calendar: '小錄音室', placeId: 'smallStudio', color: '#000', title: '慢慢長出來', start: `${date}T14:00:00+08:00`, end: `${date}T15:00:00+08:00`,
    kind: 'follow', show: '慢慢長出來', owner: '', companions: [], andyRecording: false,
    slots: [{ date, slot: 'm1400' }, { date, slot: 'm1430' }],
  }];
  const claims = effectiveClaims(week, [], bookings, dayInfo, cfg).claims;
  const conflicts = findConflicts(week, [], bookings, dayInfo, cfg);
  assert.equal(claims.some((row) => row.person === '五吉郎' && row.place === 'smallStudio'), true);
  assert.equal(conflicts.some((item) => item.type === 'BACKUP_MISSING' && item.message.includes('跟錄')), true);
});
test('small-studio follow is fine when another person covers the office', async () => {
  const { findConflicts, buildDayInfo } = await import('../src/lib/schedule/logic.ts');
  const dayInfo = buildDayInfo(week, {}, cfg);
  const bookings = [{
    calendar: '小錄音室', placeId: 'smallStudio', color: '#000', title: '慢慢長出來', start: `${date}T14:00:00+08:00`, end: `${date}T15:00:00+08:00`,
    kind: 'follow', show: '慢慢長出來', owner: '', companions: [], andyRecording: false,
    slots: [{ date, slot: 'm1400' }, { date, slot: 'm1430' }],
  }];
  const stored = [claim('m1400', 'smallOffice', '克萊'), claim('m1430', 'smallOffice', '克萊')];
  const conflicts = findConflicts(week, stored, bookings, dayInfo, cfg);
  assert.equal(conflicts.some((item) => item.type === 'BACKUP_MISSING'), false);
});
test('rejects dates outside the requested week and invalid place slots', () => {
  assert.match(planStoredClaimChange(week,'克萊',[{...item('m0900'),date:'2026-11-23'}],true,[],cfg).error,/不在/);
  assert.match(planStoredClaimChange(week,'克萊',[item('m2000')],true,[],cfg).error,/時段/);
});
test('overlap warning includes leave and automatic meetings but excludes same-place assignments', () => {
  const data={claims:[claim('m0900','leave'),claim('m0900','bigOffice','克萊',true),claim('m0900')]};
  assert.equal(conflictingClaims(data,{date,place:'smallOffice',slots:['m0900']},'克萊').length,2);
});
test('Sunday belongs to the same Monday week and bookings retain half-hour accuracy', () => {
  assert.equal(mondayOf('2026-11-22'),week);
  assert.deepEqual(bookingSlots(week,{start:'2026-11-18T09:30:00+08:00',end:'2026-11-18T10:00:00+08:00'},cfg),[{date,slot:'m0930'}]);
});
test('studio-only am+pm days count toward attendance without office places', async () => {
  const { weekStats, findConflicts, buildDayInfo } = await import('../src/lib/schedule/logic.ts');
  const dayInfo = buildDayInfo(week, {}, cfg);
  // 避開週一：全員會議會自動佔新辦公室上午 0.5 天
  const days = ['2026-11-17', '2026-11-18', '2026-11-19'];
  const amPm = cfg.SLOTS.filter((slot) => slot.period === 'am' || slot.period === 'pm').map((slot) => slot.id);
  for (const place of ['bigStudio', 'smallStudio']) {
    const claims = days.flatMap((day) => amPm.map((slot) => ({ date: day, slot, place, person: '克萊', auto: false })));
    const claire = weekStats(week, claims, dayInfo, cfg, []).find((row) => row.name === '克萊');
    // 3 天錄音室 + 週一會議 0.5
    assert.equal(claire.officeDays, 3.5, `${place} should count studio days plus Monday meeting`);
    assert.equal(claire.byPlace.bigOffice, 0.5);
    assert.equal(claire.byPlace.smallOffice, 0);
    assert.equal(
      findConflicts(week, claims, [], dayInfo, cfg).some((item) => item.type === 'OFFICE_DAYS' && item.message.includes('克萊')),
      false,
      `${place}-only schedule must not warn about missing office days`
    );
  }
});
test('studio morning alone counts as 0.5 day each', async () => {
  const { weekStats, findConflicts, buildDayInfo, formatAttendanceDays } = await import('../src/lib/schedule/logic.ts');
  const dayInfo = buildDayInfo(week, {}, cfg);
  const days = ['2026-11-17', '2026-11-18', '2026-11-19'];
  const am = cfg.SLOTS.filter((slot) => slot.period === 'am').map((slot) => slot.id);
  const claims = days.flatMap((day) => am.map((slot) => ({ date: day, slot, place: 'bigStudio', person: 'IVY', auto: false })));
  const ivy = weekStats(week, claims, dayInfo, cfg, []).find((row) => row.name === 'IVY');
  // 3×0.5 錄音室上午 + 週一會議 0.5
  assert.equal(ivy.officeDays, 2);
  assert.equal(formatAttendanceDays(ivy.officeDays), '2');
  assert.equal(
    findConflicts(week, claims, [], dayInfo, cfg).some((item) => item.type === 'OFFICE_DAYS' && item.message.includes('IVY')),
    true,
    '2 < 3 should still warn'
  );
});
test('six studio mornings meet the 3-day attendance need', async () => {
  const { weekStats, findConflicts, buildDayInfo } = await import('../src/lib/schedule/logic.ts');
  const dayInfo = buildDayInfo(week, {}, cfg);
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
  const am = cfg.SLOTS.filter((slot) => slot.period === 'am').map((slot) => slot.id);
  const claims = days.flatMap((day) => am.map((slot) => ({ date: day, slot, place: 'smallStudio', person: '克萊', auto: false })));
  assert.equal(weekStats(week, claims, dayInfo, cfg, []).find((row) => row.name === '克萊').officeDays, 3);
  assert.equal(
    findConflicts(week, claims, [], dayInfo, cfg).some((item) => item.type === 'OFFICE_DAYS' && item.message.includes('克萊')),
    false
  );
});
test('half-day units: one morning is exactly 0.5 without Monday meeting noise', async () => {
  const { weekStats, buildDayInfo } = await import('../src/lib/schedule/logic.ts');
  // 用週二單日上午，避開週一會議
  const dayInfo = buildDayInfo(week, {}, cfg);
  const am = cfg.SLOTS.filter((slot) => slot.period === 'am').map((slot) => slot.id);
  const claims = am.map((slot) => ({ date: '2026-11-17', slot, place: 'bigStudio', person: 'IVY', auto: false }));
  const ivy = weekStats(week, claims, dayInfo, cfg, []).find((row) => row.name === 'IVY');
  // 週一會議 0.5 + 週二上午 0.5
  assert.equal(ivy.officeDays, 1);
});
