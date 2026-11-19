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
