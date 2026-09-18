// 空闲窗口（free slot）计算
//
// 输入：当前生效实例 + 用户选择的 LOCATION / IANA 时区 / 日期范围 / 每日工作时段 / 最短时长。
// 计算流程：
//   1. 每一天都按所选 IANA 时区的“真实本地日界”换算成 UTC 半开区间 [dayStart, dayEnd)。
//      跨 DST 的日子长度为 23 或 25 小时（极端时区可能更长），绝不固定按 24 小时。
//   2. 忙碌区间裁剪：
//      - 跨日（在所选时区视角下跨本地日界）的定时事件先与每天的 [dayStart, dayEnd) 求交，
//        拆成“每天一段”；半开区间 [s, e) 相切不算忙碌。
//      - 全天事件（VALUE=DATE，无固定时区）按其撰写的本地日期整天占用，
//        与查询落在同一日历时即覆盖该日工作时段。
//   3. 合并当天相交或首尾相接（end === next.start）的忙碌半开区间，
//      再与工作时段求交，得到剩余空档；只保留时长 >= 最短时长的空档。
//   4. 列表按日期、开始时间排序，并给出空档前后相邻的忙碌事件，供 UI 联动定位。

import type { Instance } from './types';

export interface FreeWindowQuery {
  /** 精确匹配的 LOCATION（trim 后相等） */
  location: string;
  /** IANA 时区 id，如 America/New_York */
  tzid: string;
  /** 起始日期 YYYY-MM-DD（含），按 tzid 的本地日界 */
  startDate: string;
  /** 结束日期 YYYY-MM-DD（含） */
  endDate: string;
  /** 每日工作时段起，HH:MM（本地墙钟，必须晚于 00:00） */
  workStart: string;
  /** 每日工作时段止，HH:MM（必须严格晚于 workStart；不支持跨午夜班次） */
  workEnd: string;
  /** 空档最短可容纳分钟数（> 0） */
  slotMinutes: number;
}

export interface FreeSlot {
  /** 本地日期 YYYY-MM-DD（按所选时区） */
  date: string;
  /** 空档起点 unix 秒 */
  startUtc: number;
  /** 空档终点 unix 秒（不含） */
  endUtc: number;
  /** 空档时长（分钟） */
  durationMin: number;
  /** 该日本地日长度（小时），非 24 即说明跨 DST 切换 */
  dayHours: number;
  /** 空档之前最后一个忙碌事件（按当天裁剪后的忙碌段） */
  previous: Instance | null;
  /** 空档之后第一个忙碌事件 */
  next: Instance | null;
}

interface HalfInterval {
  start: number;
  end: number;
}

// ---------- Intl 辅助 ----------

interface DateParts {
  y: string;
  m: string;
  d: string;
}

function makeDatePartsFormatter(tzid: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tzid,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function dateParts(dtf: Intl.DateTimeFormat, utcSec: number): DateParts {
  const parts = dtf.formatToParts(new Date(utcSec * 1000));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day') };
}

function dateYmd(p: DateParts): string {
  return `${p.y}-${p.m}-${p.d}`;
}

/** 浏览器是否支持该 IANA 时区 */
export function isSupportedIanaZone(tzid: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

/** 浏览器本地 IANA 时区 id（取不到时回退 UTC） */
export function localIanaZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ---------- 本地日界换算（真实处理 DST） ----------

const DAY_SEC = 86400;

function parseYmd(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function addUtcDaysSec(noonUtcSec: number, days: number): number {
  return noonUtcSec + days * DAY_SEC;
}

/**
 * 二分查找本地日期 `ymd` 开始瞬间（该时区第一次显示该日期的 00:00）的 unix 秒。
 *
 * 谓词“该瞬间在本地显示的日期 >= ymd”对 UTC 时间单调，所以二分可靠；
 * 春令时跳变日没有 00:00->23:59 之外的问题（跳变一般发生在凌晨，日界仍存在），
 * 长度为 23h 的日子由 dayEnd - dayStart 自然体现。
 */
function localDayStartSec(dtf: Intl.DateTimeFormat, ymdStr: string): number {
  const [y, mo, d] = parseYmd(ymdStr)!;
  const noonUtc = Date.UTC(y, mo - 1, d, 12, 0, 0) / 1000;
  // 任何民用时区偏移都在 [-12h, +14h]：本地这一天的日界必落在 (UTC 前一日 02:00, UTC 次日 02:00) 内
  let lo = noonUtc - 34 * 3600;
  let hi = noonUtc + 38 * 3600;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cur = dateYmd(dateParts(dtf, mid));
    if (cur < ymdStr) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface ZoneClock {
  /** 该瞬间在本地的分钟数（0..1439，秋令时重叠小时仍按显示墙钟） */
  minuteOfDay: number;
}

function makeClockReader(tzid: string): (utcSec: number) => ZoneClock {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tzid,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return (utcSec: number): ZoneClock => {
    const parts = dtf.formatToParts(new Date(utcSec * 1000));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
    let hour = get('hour');
    if (hour === 24) hour = 0;
    return { minuteOfDay: hour * 60 + get('minute') };
  };
}

/**
 * 求本地日期内第一个“显示墙钟分钟数 >= targetMinute”的瞬间（unix 秒）。
 *
 * 以日界瞬间的偏移做朴素平移得到 t0，再按实际显示墙钟修正：
 * - 普通日子：t0 即目标墙钟；
 * - 春令时跳变（某段墙钟不存在）：t0 显示偏晚，回退修正；目标墙钟落在空档内时
 *   回退结果对不上，退化为分钟级扫描，取跳变后第一个有效瞬间（工作时段被空档压缩）；
 * - 秋令时回退（01:00-02:00 重复）：t0 落在第一次出现的墙钟上，直接返回第一次；
 *   目标晚于重复段时显示偏早，前进一个重复长度即可对齐。
 */
function firstWallAtOrAfter(
  readClock: (u: number) => ZoneClock,
  dayStart: number,
  dayEnd: number,
  targetMinute: number
): number {
  const t0 = dayStart + targetMinute * 60;
  if (t0 < dayEnd && readClock(t0).minuteOfDay === targetMinute) return t0;
  if (t0 < dayEnd) {
    const m0 = readClock(t0).minuteOfDay;
    if (m0 > targetMinute) {
      // 日界后发生春令时跳变：回退到目标墙钟（目标晚于空档时成立）
      const t1 = t0 - (m0 - targetMinute) * 60;
      if (t1 >= dayStart && readClock(t1).minuteOfDay === targetMinute) return t1;
    } else {
      // 秋令时回退：前进到重复段之后的目标墙钟
      const t1 = t0 + (targetMinute - m0) * 60;
      if (t1 < dayEnd && readClock(t1).minuteOfDay === targetMinute) return t1;
    }
  }
  // 兜底：目标墙钟落在不存在的空档（或极端时区当日多段切换），分钟级扫描取第一个 >= target 的瞬间
  for (let t = dayStart; t < dayEnd; t += 60) {
    if (readClock(t).minuteOfDay >= targetMinute) return t;
  }
  return dayEnd;
}

// ---------- 忙碌区间 ----------

function intersect(a: HalfInterval, b: HalfInterval): HalfInterval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

/** 全天事件撰写的日期集合（VALUE=DATE 按 UTC 还原墙钟） */
function allDayDates(inst: Instance): string[] {
  const dates: string[] = [];
  for (let t = inst.startUtc; t < inst.endUtc; t += DAY_SEC) {
    dates.push(formatUtcDate(t));
  }
  if (dates.length === 0) dates.push(formatUtcDate(inst.startUtc));
  return dates;
}

function formatUtcDate(utcSec: number): string {
  const d = new Date(utcSec * 1000);
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

interface BusyPiece extends HalfInterval {
  inst: Instance;
}

/**
 * 把一批忙碌区间合并为相交或首尾相接的并集，保留每段的来源事件候选，
 * 用于确定空档前（最晚结束）/ 后（最早开始）的相邻事件。
 */
interface MergedBusy extends HalfInterval {
  contributors: Instance[];
}

function mergeBusy(pieces: BusyPiece[]): MergedBusy[] {
  const sorted = [...pieces].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: MergedBusy[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    // 半开区间：首尾相接（end === start）也合并
    if (last && p.start <= last.end) {
      last.end = Math.max(last.end, p.end);
      if (!last.contributors.includes(p.inst)) last.contributors.push(p.inst);
    } else {
      out.push({ start: p.start, end: p.end, contributors: [p.inst] });
    }
  }
  return out;
}

function pickPrevious(dayWindow: HalfInterval, merged: MergedBusy[], gapStart: number): Instance | null {
  let best: { inst: Instance; end: number; start: number } | null = null;
  for (const seg of merged) {
    if (seg.end > gapStart || seg.start >= gapStart) continue;
    for (const inst of seg.contributors) {
      // 相邻性按裁剪到当天后的忙碌段判断
      const clipped = intersect({ start: inst.startUtc, end: inst.endUtc }, dayWindow);
      if (!clipped || clipped.end > gapStart) continue;
      if (
        !best ||
        clipped.end > best.end ||
        (clipped.end === best.end && clipped.start > best.start)
      ) {
        best = { inst, end: clipped.end, start: clipped.start };
      }
    }
  }
  return best?.inst ?? null;
}

function pickNext(dayWindow: HalfInterval, merged: MergedBusy[], gapEnd: number): Instance | null {
  let best: { inst: Instance; start: number; end: number } | null = null;
  for (const seg of merged) {
    if (seg.start < gapEnd || seg.end <= gapEnd) continue;
    for (const inst of seg.contributors) {
      const clipped = intersect({ start: inst.startUtc, end: inst.endUtc }, dayWindow);
      if (!clipped || clipped.start < gapEnd) continue;
      if (
        !best ||
        clipped.start < best.start ||
        (clipped.start === best.start && clipped.end < best.end)
      ) {
        best = { inst, start: clipped.start, end: clipped.end };
      }
    }
  }
  return best?.inst ?? null;
}

// ---------- 查询校验 ----------

export type FreeQueryIssue =
  | 'unsupported-timezone'
  | 'invalid-date-range'
  | 'invalid-work-hours'
  | 'invalid-slot-minutes'
  | 'location-empty'
  | 'too-many-days';

export const FREE_QUERY_ISSUE_TEXT: Record<FreeQueryIssue, string> = {
  'unsupported-timezone': '当前浏览器不支持该 IANA 时区，请检查拼写（如 Asia/Shanghai）。',
  'invalid-date-range': '日期范围无效：请按 YYYY-MM-DD 填写，且起止顺序正确。',
  'invalid-work-hours': '每日工作时段无效：格式 HH:MM，且结束必须严格晚于开始（暂不支持跨午夜班次）。',
  'invalid-slot-minutes': '空档分钟数必须是 1 ~ 1440 之间的整数。',
  'location-empty': '请选择或填写 LOCATION。',
  'too-many-days': '日期跨度最大 366 天，请收窄范围。',
};

const MAX_DAYS = 366;

export function validateFreeQuery(q: FreeWindowQuery): FreeQueryIssue | null {
  if (!q.location.trim()) return 'location-empty';
  if (!isSupportedIanaZone(q.tzid.trim())) return 'unsupported-timezone';
  const s = parseYmd(q.startDate);
  const e = parseYmd(q.endDate);
  if (!s || !e || q.startDate > q.endDate) return 'invalid-date-range';
  const ws = parseHm(q.workStart);
  const we = parseHm(q.workEnd);
  if (ws === null || we === null || we <= ws) return 'invalid-work-hours';
  if (!Number.isInteger(q.slotMinutes) || q.slotMinutes <= 0 || q.slotMinutes > 1440) {
    return 'invalid-slot-minutes';
  }
  const spanDays = Math.round((Date.UTC(e[0], e[1] - 1, e[2]) - Date.UTC(s[0], s[1] - 1, s[2])) / 86400000) + 1;
  if (spanDays > MAX_DAYS) return 'too-many-days';
  return null;
}

/** 从生效实例中提取去重排序后的非空 LOCATION 清单 */
export function availableLocations(instances: Instance[]): string[] {
  const set = new Set<string>();
  for (const inst of instances) {
    const loc = inst.location.trim();
    if (loc) set.add(loc);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---------- 主入口 ----------

/**
 * 基于当前生效实例计算可容纳 slotMinutes 分钟的空闲空档。
 * 调用方应先用 validateFreeQuery 校验；校验未过时返回空数组。
 */
export function findFreeWindows(instances: Instance[], q: FreeWindowQuery): FreeSlot[] {
  if (validateFreeQuery(q)) return [];

  const tzid = q.tzid.trim();
  const location = q.location.trim();
  const workStartMin = parseHm(q.workStart)!;
  const workEndMin = parseHm(q.workEnd)!;
  const minSec = q.slotMinutes * 60;

  const dtf = makeDatePartsFormatter(tzid);
  const readClock = makeClockReader(tzid);

  // 该 LOCATION 下的生效实例
  const locInstances = instances.filter((i) => i.location.trim() === location);

  // 全天实例按撰写日期建索引（日期 -> 全天占用该日的实例）
  const allDayByDate = new Map<string, Instance[]>();
  const timed: Instance[] = [];
  for (const inst of locInstances) {
    if (inst.isAllDay) {
      for (const d of allDayDates(inst)) {
        const arr = allDayByDate.get(d);
        if (arr) arr.push(inst);
        else allDayByDate.set(d, [inst]);
      }
    } else if (inst.endUtc > inst.startUtc) {
      timed.push(inst);
    }
  }

  const slots: FreeSlot[] = [];
  const [sy, sm, sd] = parseYmd(q.startDate)!;
  let dayNoonUtc = Date.UTC(sy, sm - 1, sd, 12, 0, 0) / 1000;
  const [ey, em, ed] = parseYmd(q.endDate)!;
  const endNoonUtc = Date.UTC(ey, em - 1, ed, 12, 0, 0) / 1000;

  while (dayNoonUtc <= endNoonUtc) {
    // 用一个保证落在该本地日期内的锚点取日期串，再按真实本地日界求 [dayStart, dayEnd)
    const ymdStr = dateYmd(dateParts(dtf, dayNoonUtc));
    const dayStart = localDayStartSec(dtf, ymdStr);
    // 下一个本地日期的日界即今日结束——DST 日自然为 23/25 小时，不固定 24h
    const nextYmd = dateYmd(dateParts(dtf, addUtcDaysSec(dayNoonUtc, 1)));
    const dayEnd = localDayStartSec(dtf, nextYmd);
    const dayHours = (dayEnd - dayStart) / 3600;

    // 工作时段按本地墙钟映射到真实 UTC 瞬间
    const workStartUtc = firstWallAtOrAfter(readClock, dayStart, dayEnd, workStartMin);
    const workEndUtc = firstWallAtOrAfter(readClock, dayStart, dayEnd, workEndMin);
    const workWindow: HalfInterval = { start: workStartUtc, end: workEndUtc };

    // 1) 定时忙碌事件裁剪到当天
    const pieces: BusyPiece[] = [];
    for (const inst of timed) {
      const hit = intersect({ start: inst.startUtc, end: inst.endUtc }, { start: dayStart, end: dayEnd });
      if (hit) pieces.push({ ...hit, inst });
    }

    // 2) 全天事件覆盖整日工作时段（以工作时段段参与合并）
    const allDayHits = allDayByDate.get(ymdStr) ?? [];
    for (const inst of allDayHits) {
      pieces.push({ start: workWindow.start, end: workWindow.end, inst });
    }

    const merged = mergeBusy(pieces);

    // 3) 在工作时段内顺序扫描空档（相邻事件按整日窗口判断，支持工作时段外的事件）
    let cursor = workWindow.start;
    for (const seg of merged) {
      if (seg.end <= cursor) continue;
      if (seg.start >= workWindow.end) break;
      if (seg.start > cursor) {
        emitGap(
          slots,
          ymdStr,
          dayHours,
          cursor,
          Math.min(seg.start, workWindow.end),
          minSec,
          { start: dayStart, end: dayEnd },
          merged
        );
      }
      cursor = Math.max(cursor, Math.min(seg.end, workWindow.end));
    }
    emitGap(
      slots,
      ymdStr,
      dayHours,
      cursor,
      workWindow.end,
      minSec,
      { start: dayStart, end: dayEnd },
      merged
    );

    dayNoonUtc = addUtcDaysSec(dayNoonUtc, 1);
  }

  // 按日期、开始时间排序
  slots.sort((a, b) => a.startUtc - b.startUtc || a.date.localeCompare(b.date));
  return slots;
}

function emitGap(
  out: FreeSlot[],
  date: string,
  dayHours: number,
  start: number,
  end: number,
  minSec: number,
  workWindow: HalfInterval,
  merged: MergedBusy[]
): void {
  if (end <= start) return;
  if (end - start < minSec) return;
  out.push({
    date,
    startUtc: start,
    endUtc: end,
    durationMin: Math.round((end - start) / 60),
    dayHours,
    previous: pickPrevious(workWindow, merged, start),
    next: pickNext(workWindow, merged, end),
  });
}
