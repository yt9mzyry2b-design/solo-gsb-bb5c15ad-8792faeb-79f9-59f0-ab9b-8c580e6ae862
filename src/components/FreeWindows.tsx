import { useEffect, useMemo, useState } from 'react';
import type { Instance } from '../ical-engine/types';
import { instanceId } from '../ical-engine/conflicts';
import {
  availableLocations,
  findFreeWindows,
  FREE_QUERY_ISSUE_TEXT,
  isSupportedIanaZone,
  localIanaZone,
  validateFreeQuery,
  type FreeSlot,
  type FreeWindowQuery,
} from '../ical-engine/freewindows';
import { formatWall } from '../utils/format';

interface FreeWindowsProps {
  /** 当前生效实例（规则编辑 / 例外停用后实时变化） */
  instances: Instance[];
  /** 默认日期范围（跟随顶部展开范围初始化） */
  defaultStartDate: string;
  defaultEndDate: string;
  /** 实例表中当前选中的实例 key，用于高亮相邻事件对应行 */
  selectedKey: string | null;
  /** 点击空档或其前 / 后相邻事件：切回生效表并定位 */
  onSelectSlot: (slot: FreeSlot, neighbor: Instance | null) => void;
}

/** 常用 IANA 时区（输入框 datalist，仍允许手动填写任意合法时区） */
const COMMON_ZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export function FreeWindows({
  instances,
  defaultStartDate,
  defaultEndDate,
  selectedKey,
  onSelectSlot,
}: FreeWindowsProps) {
  const locations = useMemo(() => availableLocations(instances), [instances]);

  const [location, setLocation] = useState('');
  const [tzid, setTzid] = useState(localIanaZone);
  // 组件在切换页签时挂载：初始日期跟随当前展开范围，之后仅由用户操作 / “同步展开范围”修改
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [workStart, setWorkStart] = useState('09:00');
  const [workEnd, setWorkEnd] = useState('18:00');
  const [slotMinutes, setSlotMinutes] = useState(30);

  // 地点清单随当前生效实例变化：失效后自动落到第一个可用地点（首次挂载同样由此初始化）
  useEffect(() => {
    if (locations.length === 0) {
      setLocation('');
    } else if (!locations.includes(location)) {
      setLocation(locations[0]);
    }
  }, [locations, location]);

  const query: FreeWindowQuery = useMemo(
    () => ({ location, tzid, startDate, endDate, workStart, workEnd, slotMinutes }),
    [location, tzid, startDate, endDate, workStart, workEnd, slotMinutes]
  );

  const issue = useMemo(() => validateFreeQuery(query), [query]);
  const slots = useMemo(
    () => (issue ? [] : findFreeWindows(instances, query)),
    [instances, query, issue]
  );

  const tzOk = isSupportedIanaZone(tzid.trim());

  return (
    <div className="free-panel">
      <div className="free-form">
        <label className="ff-field ff-location">
          <span>LOCATION</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {locations.length === 0 && <option value="">（生效实例中无地点）</option>}
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </label>
        <label className="ff-field ff-tz">
          <span>IANA 时区</span>
          <input
            type="text"
            list="iana-zone-list"
            value={tzid}
            onChange={(e) => setTzid(e.target.value)}
            spellCheck={false}
            placeholder="Asia/Shanghai"
          />
          <datalist id="iana-zone-list">
            {COMMON_ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>
        <label className="ff-field">
          <span>起</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="ff-field">
          <span>止（含）</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="ff-field">
          <span>工作时段</span>
          <span className="ff-work">
            <input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
            <em>至</em>
            <input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} />
          </span>
        </label>
        <label className="ff-field ff-minutes">
          <span>至少（分钟）</span>
          <input
            type="number"
            min={1}
            max={1440}
            step={5}
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(Number(e.target.value))}
          />
        </label>
        <button
          className="ff-sync"
          title="把日期范围同步为顶部展开范围"
          onClick={() => {
            setStartDate(defaultStartDate);
            setEndDate(defaultEndDate);
          }}
        >
          同步展开范围
        </button>
      </div>

      {!tzOk && (
        <div className="free-issue">
          {FREE_QUERY_ISSUE_TEXT['unsupported-timezone']}
        </div>
      )}
      {issue && issue !== 'unsupported-timezone' && (
        <div className="free-issue">{FREE_QUERY_ISSUE_TEXT[issue]}</div>
      )}

      <div className="free-summary">
        {issue
          ? '请补全查询条件'
          : locations.length === 0
            ? '当前生效实例没有任何非空 LOCATION'
            : `共 ${slots.length} 个空档 · ${tzid} · ${workStart}–${workEnd} · ≥${slotMinutes} 分钟`}
      </div>

      {!issue && slots.length > 0 && (
        <table className="instance-table free-table">
          <thead>
            <tr>
              <th style={{ width: 132 }}>日期</th>
              <th style={{ width: 172 }}>空档（本地墙钟）</th>
              <th>前一忙碌事件</th>
              <th>后一忙碌事件</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <FreeRow
                key={`${slot.date}-${slot.startUtc}`}
                slot={slot}
                tzid={tzid.trim()}
                selectedKey={selectedKey}
                onSelectSlot={onSelectSlot}
              />
            ))}
          </tbody>
        </table>
      )}
      {!issue && slots.length === 0 && locations.length > 0 && (
        <div className="empty-hint">所选条件下没有足够长的空档</div>
      )}
    </div>
  );
}

function FreeRow({
  slot,
  tzid,
  selectedKey,
  onSelectSlot,
}: {
  slot: FreeSlot;
  tzid: string;
  selectedKey: string | null;
  onSelectSlot: (slot: FreeSlot, neighbor: Instance | null) => void;
}) {
  const dstDay = Math.abs(slot.dayHours - 24) > 1e-9;
  const dayHoursLabel = Number.isInteger(slot.dayHours) ? String(slot.dayHours) : slot.dayHours.toFixed(1);
  const primary = slot.previous ?? slot.next;
  const prevSelected = slot.previous && instanceId(slot.previous) === selectedKey;
  const nextSelected = slot.next && instanceId(slot.next) === selectedKey;

  return (
    <tr
      className={[
        'instance-row',
        'free-row',
        primary ? 'has-neighbor' : '',
        prevSelected ? 'free-prev-selected' : '',
        nextSelected ? 'free-next-selected' : '',
      ].join(' ')}
      onClick={() => primary && onSelectSlot(slot, primary)}
      title={primary ? '点击在生效实例表中定位相邻事件' : undefined}
    >
      <td className="cell-time">
        {slot.date}
        {dstDay && (
          <span className="dst-note" title={`该本地日长度为 ${dayHoursLabel} 小时（跨 DST 切换）`}>
            DST {dayHoursLabel}h
          </span>
        )}
      </td>
      <td className="cell-time">
        {formatWall(slot.startUtc, tzid, false).slice(11)}–{formatWall(slot.endUtc, tzid, false).slice(11)}
        <br />
        <span className="clock">{slot.durationMin} 分钟</span>
      </td>
      <NeighborCell inst={slot.previous} tzid={tzid} selected={!!prevSelected} onSelectSlot={onSelectSlot} slot={slot} />
      <NeighborCell inst={slot.next} tzid={tzid} selected={!!nextSelected} onSelectSlot={onSelectSlot} slot={slot} />
    </tr>
  );
}

function NeighborCell({
  inst,
  tzid,
  selected,
  slot,
  onSelectSlot,
}: {
  inst: Instance | null;
  tzid: string;
  selected: boolean;
  slot: FreeSlot;
  onSelectSlot: (slot: FreeSlot, neighbor: Instance | null) => void;
}) {
  if (!inst) {
    return (
      <td>
        <em style={{ color: 'var(--excluded)' }}>—</em>
      </td>
    );
  }
  return (
    <td>
      <a
        className={`free-neighbor ${selected ? 'selected' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelectSlot(slot, inst);
        }}
        title={`${formatWall(inst.startUtc, tzid, false)} – ${formatWall(inst.endUtc, tzid, false)}（点击定位）`}
      >
        {inst.summary || '（无标题）'}
      </a>
      <div className="clock">
        {formatWall(inst.startUtc, tzid, false).slice(11)} 起 · {inst.location}
      </div>
    </td>
  );
}
