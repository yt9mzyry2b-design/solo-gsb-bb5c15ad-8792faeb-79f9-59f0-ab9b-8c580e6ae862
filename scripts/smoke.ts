// 引擎端到端冒烟测试（Node 下通过 vite-node 运行 TS 源码）
import assert from 'node:assert';
import { parseCalendar } from '../src/ical-engine/parser';
import { expandAll } from '../src/ical-engine/expansion';
import { detectConflicts, instanceId } from '../src/ical-engine/conflicts';
import { diffInstances, instanceIdentity } from '../src/ical-engine/diff';
import { normalizeCalendar } from '../src/ical-engine/normalizer';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:daily@x
SUMMARY:Daily
LOCATION:Room-A
DTSTART;TZID=America/New_York:20260305T090000
DTEND;TZID=America/New_York:20260305T100000
RRULE:FREQ=DAILY;COUNT=14
EXDATE;TZID=America/New_York:20260306T090000
RDATE;TZID=America/New_York:20260320T090000
END:VEVENT
BEGIN:VEVENT
UID:daily@x
SUMMARY:Daily moved to Room-B and 11:00
LOCATION:Room-B
DTSTART;TZID=America/New_York:20260309T110000
DTEND;TZID=America/New_York:20260309T120000
RECURRENCE-ID;TZID=America/New_York:20260309T090000
END:VEVENT
BEGIN:VEVENT
UID:daily@x
STATUS:CANCELLED
DTSTART;TZID=America/New_York:20260310T090000
DTEND;TZID=America/New_York:20260310T100000
RECURRENCE-ID;TZID=America/New_York:20260310T090000
END:VEVENT
BEGIN:VEVENT
UID:other@x
SUMMARY:Other overlapping
LOCATION:Room-A
DTSTART;TZID=America/New_York:20260305T093000
DTEND;TZID=America/New_York:20260305T103000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:synth@x
SUMMARY:Berlin no vtimezone
LOCATION:Online
DTSTART;TZID=Europe/Berlin:20260325T150000
DTEND;TZID=Europe/Berlin:20260325T160000
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
END:VCALENDAR
`;

function utc(y: number, m0: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m0, d, h, min) / 1000;
}

function rangeFor(start: string, endExclusive: string) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = endExclusive.split('-').map(Number);
  return {
    startUtc: utc(sy, sm - 1, sd) - 5 * 3600,
    endUtc: utc(ey, em - 1, ed) - 4 * 3600,
  };
}

const parsed = parseCalendar(ICS);
assert.ok(!('fatal' in parsed), 'parse ok');
if ('fatal' in parsed) process.exit(1);

const masters = parsed.masters;
assert.strictEqual(masters.length, 3, 'three series');
const daily = masters.find((m) => m.uid === 'daily@x')!;
assert.strictEqual(daily.overrides.length, 2, 'two overrides grouped');

const range = rangeFor('2026-03-05', '2026-04-10');
const expanded = expandAll(masters, range, { disabledOverrides: new Set(), editedRrule: {} });
// 原始日历基线（无编辑、无停用）
const baseline0 = expandAll(masters, range, { disabledOverrides: new Set(), editedRrule: {} });

// 1) EXDATE
assert.ok(
  !expanded.instances.some((i) => i.uid === 'daily@x' && i.startUtc === utc(2026, 2, 6, 14)),
  'EXDATE 2026-03-06 removed'
);
const exRows = expanded.excluded.filter((i) => i.uid === 'daily@x');
assert.strictEqual(exRows.length, 1, 'excluded audit row');
assert.strictEqual(exRows[0].originLine, daily.exdates[0].line, 'exdate origin line tracked');

// 2) CANCELLED（Mar 10 已进入夏令时，09:00 EDT = 13:00Z）
assert.ok(
  !expanded.instances.some((i) => i.uid === 'daily@x' && i.startUtc === utc(2026, 2, 10, 13)),
  'CANCELLED instance absent'
);
const cancelled = expanded.cancelled.filter((i) => i.uid === 'daily@x');
assert.strictEqual(cancelled.length, 1, 'cancelled audit row');

// 3) override replacement
const ov = expanded.instances.find(
  (i) => i.uid === 'daily@x' && i.summary.includes('moved')
)!;
assert.ok(ov, 'override present');
assert.strictEqual(ov.source, 'override');
assert.strictEqual(ov.location, 'Room-B');
assert.strictEqual(ov.startUtc, utc(2026, 2, 9, 15), 'override at 11:00 EDT = 15:00Z');
assert.ok(
  !expanded.instances.some(
    (i) => i.uid === 'daily@x' && i.startUtc === utc(2026, 2, 9, 14)
  ),
  'original at 09:00 replaced'
);

// 4) DST wall clock preserved（2026 年纽约 3/8 切换；Mar 7 EST -05:00，Mar 9 起 EDT -04:00）
const mar7 = expanded.instances.find((i) => i.uid === 'daily@x' && i.startUtc === utc(2026, 2, 7, 14))!;
assert.ok(mar7, 'Mar 7 instance exists');
assert.strictEqual(mar7.utcOffsetSec, -5 * 3600, 'EST -05:00');
assert.strictEqual(mar7.localClock, '09:00', 'wall 09:00 in EST');
const mar9Original = expanded.instances.find(
  (i) => i.uid === 'daily@x' && i.startUtc === utc(2026, 2, 9, 14)
);
assert.strictEqual(mar9Original, undefined, 'Mar 9 09:00 original replaced by override');
// override 自身在 EDT 下保持 11:00 墙钟
assert.strictEqual(ov.utcOffsetSec, -4 * 3600, 'EDT -04:00');
assert.strictEqual(ov.localClock, '11:00', 'override wall 11:00');

// RDATE
assert.ok(
  expanded.instances.some((i) => i.uid === 'daily@x' && i.source === 'rdate'),
  'RDATE present'
);

// 5) conflicts by location
const conflicts = detectConflicts(expanded.instances);
const aGroups = conflicts.groups.filter((g) => g.location === 'Room-A');
assert.ok(aGroups.length >= 1, 'Room-A conflict groups detected');
assert.ok(
  conflicts.byKey.has(instanceId(expanded.instances.find((i) => i.uid === 'other@x')!)),
  'other event flagged conflict'
);
// override moved to Room-B, must not conflict at 11:00 with Room-A events
assert.ok(
  !conflicts.byKey.has(instanceId(ov)),
  'override in Room-B has no conflict'
);

// 6) disable override -> original restored
const disabled = new Set([daily.overrides.find((o) => !o.cancelled)!.id]);
const re = expandAll(masters, range, { disabledOverrides: disabled, editedRrule: {} });
assert.ok(
  re.instances.some((i) => i.uid === 'daily@x' && i.startUtc === utc(2026, 2, 9, 13) && i.overrideDisabled),
  'original restored when override disabled'
);

// 7) disable cancelled override -> original restored
const disabledCancel = new Set([daily.overrides.find((o) => o.cancelled)!.id]);
const re2 = expandAll(masters, range, { disabledOverrides: disabledCancel, editedRrule: {} });
assert.ok(
  re2.instances.some((i) => i.uid === 'daily@x' && i.startUtc === utc(2026, 2, 10, 13)),
  'cancelled override disabled restores instance'
);

// 8) edited rrule live recompute (weekly instead of daily)
const re3 = expandAll(
  masters,
  range,
  { disabledOverrides: new Set(), editedRrule: { 'daily@x': 'FREQ=WEEKLY;COUNT=2' } }
);
const dailyCount = re3.instances.filter((i) => i.uid === 'daily@x' && i.source === 'rrule').length;
assert.strictEqual(dailyCount, 2, 'edited weekly rule yields 2 rrule instances');

// invalid rule -> fallback + error
const re4 = expandAll(
  masters,
  range,
  { disabledOverrides: new Set(), editedRrule: { 'daily@x': 'FREQ=BOGUS' } }
);
assert.ok(re4.rruleErrors['daily@x'], 'invalid rule reported');
assert.ok(re4.instances.some((i) => i.uid === 'daily@x'), 'falls back to original rule');

// 8b) 变更影响：无编辑时与基线完全一致
assert.strictEqual(diffInstances(expanded.instances, expanded.instances).length, 0, 'identical sets yield no changes');
const baseChanges = diffInstances(baseline0.instances, expanded.instances);
assert.strictEqual(baseChanges.length, 0, 'fresh expansion equals baseline (no effective edits)');

// 8c) 停用覆盖例外：同一身份（UID + 原始 recurrence key）标记为移动/字段变化，不是一删一增
{
  const changes = diffInstances(baseline0.instances, re.instances);
  const mar9Key = utc(2026, 2, 9, 13); // RECURRENCE-ID 09:00 EDT（3/8 已入夏令时）
  const same = changes.filter((c) => c.identity === `daily@x#${mar9Key}`);
  assert.strictEqual(same.length, 1, 'override identity matched exactly once');
  const ch = same[0];
  assert.ok(ch.before && ch.after, 'before/after both present -> modified, not add/remove');
  assert.deepStrictEqual(
    ch.kinds.slice().sort(),
    ['end-moved', 'location', 'start-moved', 'summary'],
    'start/end moved + summary/location changed'
  );
  assert.ok(
    !changes.some((c) => c.kinds[0] === 'added' && c.uid === 'daily@x' && c.recurrenceKey === mar9Key),
    'move must not be reported as added'
  );
  assert.ok(
    !changes.some((c) => c.kinds[0] === 'removed' && c.uid === 'daily@x' && c.recurrenceKey === mar9Key),
    'move must not be reported as removed'
  );
}

// 8d) 停用 CANCELLED 例外：原实例恢复，标记为新增
{
  const changes = diffInstances(baseline0.instances, re2.instances);
  const mar10 = utc(2026, 2, 10, 13); // EDT
  const added = changes.filter((c) => c.kinds[0] === 'added' && c.uid === 'daily@x');
  assert.ok(
    added.some((c) => c.recurrenceKey === mar10),
    'restored cancelled instance reported as added'
  );
}

// 8e) 编辑 RRULE 为 WEEKLY：仅基线存在的日实例标记移除，改期过的例外身份保持不变
{
  const changes = diffInstances(baseline0.instances, re3.instances);
  const removedKeys = changes.filter((c) => c.kinds[0] === 'removed').map((c) => c.recurrenceKey);
  assert.ok(removedKeys.includes(utc(2026, 2, 7, 14)), 'Mar 7 daily occurrence removed');
  assert.ok(removedKeys.includes(utc(2026, 2, 8, 13)), 'Mar 8 daily occurrence removed');
  const mar9Key = utc(2026, 2, 9, 13); // 09:00 EDT
  assert.ok(
    !removedKeys.includes(mar9Key),
    'moved override keeps identity under the new rule (orphan at same time)'
  );
  // 身份键确实是 UID + recurrenceKey
  assert.strictEqual(
    instanceIdentity(re.instances.find((i) => i.startUtc === utc(2026, 2, 9, 13))!),
    `daily@x#${mar9Key}`
  );
}

// 9) synthetic timezone (Europe/Berlin no VTIMEZONE) keeps 15:00 wall across DST (Mar 29 2026)
const berlin = re.instances.filter((i) => i.uid === 'synth@x');
assert.strictEqual(berlin.length, 3, 'three berlin instances');
const b0 = berlin[0];
const b2 = berlin[2];
assert.strictEqual(b0.localClock, '15:00');
assert.strictEqual(b2.localClock, '15:00', 'wall stays 15:00 after DST');
assert.strictEqual(b0.utcOffsetSec, 3600, 'CET +01:00 before');
assert.strictEqual(b2.utcOffsetSec, 7200, 'CEST +02:00 after');
assert.strictEqual(b2.startUtc, utc(2026, 3, 8, 13), 'Apr 8 15:00 CEST = 13:00Z');

// 10) normalize export
const norm = normalizeCalendar(parsed, { disabledOverrides: new Set(), editedRrule: {} });
assert.ok(norm.ics.includes('BEGIN:VTIMEZONE'), 'export contains vtimezone');
assert.ok(norm.ics.includes('Europe/Berlin'), 'synthetic tz exported');
assert.ok(norm.ics.includes('VERSION:2.0'));
assert.ok(norm.ics.includes('FREQ=DAILY'));
assert.strictEqual((norm.ics.match(/BEGIN:VEVENT/g) || []).length, 5, 'master + 2 overrides + other + synth');
// disabled override excluded from export
const norm2 = normalizeCalendar(parsed, {
  disabledOverrides: new Set([daily.overrides.find((o) => !o.cancelled)!.id]),
  editedRrule: {},
});
assert.strictEqual((norm2.ics.match(/BEGIN:VEVENT/g) || []).length, 4, 'disabled override omitted');
// edited rule in export
const norm3 = normalizeCalendar(parsed, {
  disabledOverrides: new Set(),
  editedRrule: { 'daily@x': 'FREQ=WEEKLY;COUNT=2' },
});
assert.ok(norm3.ics.includes('FREQ=WEEKLY;COUNT=2'), 'edited rrule exported');

// round-trip parse of normalized output
const reparsed = parseCalendar(norm.ics);
assert.ok(!('fatal' in reparsed), 'normalized output reparses');

console.log('✓ all engine smoke tests passed');
console.log(`  instances=${expanded.instances.length} cancelled=${expanded.cancelled.length} excluded=${expanded.excluded.length} conflictGroups=${conflicts.groups.length}`);
