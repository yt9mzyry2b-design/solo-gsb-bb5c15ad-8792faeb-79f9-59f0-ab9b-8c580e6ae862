import { useMemo, useState } from 'react';
import type { Instance } from '../ical-engine/types';
import { detectConflicts, instanceId } from '../ical-engine/conflicts';
import type { InstanceChange } from '../ical-engine/diff';
import { formatWall, formatOffset } from '../utils/format';
import { ChangeImpact } from './ChangeImpact';

export type AuditTab = 'visible' | 'cancelled' | 'excluded' | 'impact';

interface InstanceTableProps {
  instances: Instance[];
  cancelled: Instance[];
  excluded: Instance[];
  /** 受控页签（供“变更影响”点击后联动切回生效表） */
  tab: AuditTab;
  onTabChange: (tab: AuditTab) => void;
  /** 变更影响比对结果（impact 页签） */
  changes: InstanceChange[];
  onSelectChange: (change: InstanceChange) => void;
  /** 当前选中实例身份（uid#recurrenceKey），变更影响行高亮用 */
  selectedIdentity: string | null;
  /** 从“变更影响”联动过来的已移除实例：在生效表中以幽灵行展示，仍可定位源码 */
  ghostInstance: Instance | null;
  selectedKey: string | null;
  onSelect: (inst: Instance) => void;
}

const SOURCE_LABEL: Record<Instance['source'], string> = {
  rrule: 'RRULE',
  rdate: 'RDATE',
  override: '例外',
  single: '单次',
};

export function InstanceTable({
  instances,
  cancelled,
  excluded,
  tab,
  onTabChange,
  changes,
  onSelectChange,
  selectedIdentity,
  ghostInstance,
  selectedKey,
  onSelect,
}: InstanceTableProps) {
  const [locFilter, setLocFilter] = useState('');
  const [onlyConflicts, setOnlyConflicts] = useState(false);

  const conflicts = useMemo(() => detectConflicts(instances), [instances]);

  const rows = useMemo(() => {
    if (tab === 'visible') return instances;
    if (tab === 'cancelled') return cancelled;
    if (tab === 'excluded') return excluded;
    return [];
  }, [tab, instances, cancelled, excluded]);

  const filteredRows = useMemo(() => {
    if (tab === 'impact') return [];
    const q = locFilter.trim().toLowerCase();
    return rows.filter((i) => {
      if (q && !i.location.toLowerCase().includes(q) && !i.summary.toLowerCase().includes(q)) {
        return false;
      }
      if (tab === 'visible' && onlyConflicts && !conflicts.byKey.has(instanceId(i))) return false;
      return true;
    });
  }, [tab, rows, locFilter, onlyConflicts, conflicts]);

  // 幽灵行（已移除实例）按时间插入生效表，且不参与冲突检测/过滤之外的统计
  const visibleRows = useMemo(() => {
    if (tab !== 'visible' || !ghostInstance) return filteredRows;
    if (instances.some((i) => instanceId(i) === instanceId(ghostInstance))) return filteredRows;
    const q = locFilter.trim().toLowerCase();
    const matchesFilter =
      !q ||
      ghostInstance.location.toLowerCase().includes(q) ||
      ghostInstance.summary.toLowerCase().includes(q);
    if (!matchesFilter || onlyConflicts) return filteredRows;
    const merged = [...filteredRows, ghostInstance];
    merged.sort((a, b) => a.startUtc - b.startUtc || a.uid.localeCompare(b.uid));
    return merged;
  }, [tab, filteredRows, instances, ghostInstance, locFilter, onlyConflicts]);

  // 每条时间序列在其声明时区上的首实例偏移，用于判断 DST 是否切换
  const baselineOffset = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const inst of instances) {
      if (!map.has(inst.seriesId)) map.set(inst.seriesId, inst.utcOffsetSec);
    }
    return map;
  }, [instances]);

  return (
    <>
      <div className="tabs">
        <button className={tab === 'visible' ? 'active' : ''} onClick={() => onTabChange('visible')}>
          生效实例（{instances.length}）
        </button>
        <button className={tab === 'cancelled' ? 'active' : ''} onClick={() => onTabChange('cancelled')}>
          已取消（{cancelled.length}）
        </button>
        <button className={tab === 'excluded' ? 'active' : ''} onClick={() => onTabChange('excluded')}>
          已排除（{excluded.length}）
        </button>
        <button className={tab === 'impact' ? 'active' : ''} onClick={() => onTabChange('impact')}>
          变更影响{changes.length > 0 ? `（${changes.length}）` : ''}
        </button>
      </div>

      {tab === 'impact' ? (
        <ChangeImpact
          changes={changes}
          selectedIdentity={selectedIdentity}
          onSelectChange={onSelectChange}
        />
      ) : (
        <>
          <div className="filter-bar">
            <input
              type="text"
              placeholder="筛选地点 / 标题"
              value={locFilter}
              onChange={(e) => setLocFilter(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={onlyConflicts}
                onChange={(e) => setOnlyConflicts(e.target.checked)}
                disabled={tab !== 'visible'}
              />
              仅看冲突
            </label>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>冲突组：{conflicts.groups.length}</span>
          </div>
          <table className="instance-table">
            <thead>
              <tr>
                <th style={{ width: 168 }}>开始（声明时区墙钟）</th>
                <th style={{ width: 130 }}>地点 / 偏移</th>
                <th>事件</th>
                <th style={{ width: 92 }}>来源</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-hint">
                    该视图下没有实例
                  </td>
                </tr>
              )}
              {visibleRows.map((inst) => {
                const peers = conflicts.byKey.get(instanceId(inst));
                const id = instanceId(inst);
                const base = baselineOffset.get(inst.seriesId);
                const dstChanged =
                  inst.utcOffsetSec !== null &&
                  base !== undefined &&
                  base !== null &&
                  inst.utcOffsetSec !== base;
                const isGhost = !!ghostInstance && id === instanceId(ghostInstance);
                return (
                  <tr
                    key={`${tab}-${id}`}
                    className={[
                      'instance-row',
                      tab === 'visible' ? '' : `audit-row ${tab}`,
                      peers ? 'conflict' : '',
                      selectedKey === id ? 'selected' : '',
                      isGhost ? 'ghost-removed' : '',
                    ].join(' ')}
                    onClick={() => onSelect(inst)}
                    title={isGhost ? '该实例在当前生效列表中已被移除（来自变更影响联动）' : undefined}
                  >
                    <td className="cell-time">
                      {formatWall(inst.startUtc, inst.tzid, inst.isAllDay)}
                      {!inst.isAllDay && (
                        <>
                          <br />
                          <span className="clock">至 {formatWall(inst.endUtc, inst.tzid, false)}</span>
                          {dstChanged && (
                            <span
                              className="dst-note"
                              title="相对首个实例，UTC 偏移已变化（跨 DST）"
                            >
                              DST
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="loc-cell">
                      {inst.location.trim() ? (
                        inst.location
                      ) : (
                        <em style={{ color: 'var(--excluded)' }}>无地点</em>
                      )}
                      <br />
                      <span className="clock">
                        {inst.isAllDay ? '日期型（无时区）' : formatOffset(inst.utcOffsetSec)}
                      </span>
                    </td>
                    <td>
                      {inst.summary || <em style={{ color: 'var(--excluded)' }}>（无标题）</em>}
                      {isGhost && (
                        <span
                          className="tag"
                          style={{ marginLeft: 6 }}
                          title="变更影响：该实例在生效列表中已不存在"
                        >
                          已移除
                        </span>
                      )}
                      {inst.overrideDisabled && !isGhost && (
                        <span
                          className="tag"
                          style={{ marginLeft: 6 }}
                          title="该实例原本被例外覆盖，例外已被停用"
                        >
                          例外已停用
                        </span>
                      )}
                      {inst.orphan && (
                        <span className="tag" style={{ marginLeft: 6 }}>
                          孤立覆盖
                        </span>
                      )}
                      {peers && (
                        <span className="conflict-chip" onClick={(e) => e.stopPropagation()}>
                          ⚠ 与 {peers.length} 个实例冲突：
                          {peers.map((p, i) => (
                            <span key={instanceId(p)}>
                              {i > 0 ? '、' : ''}
                              <a
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelect(p);
                                }}
                                style={{ color: 'var(--conflict)', cursor: 'pointer' }}
                              >
                                {p.summary || '未命名'}
                              </a>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`src-badge ${inst.source}`}>{SOURCE_LABEL[inst.source]}</span>
                      <div className="clock" style={{ marginTop: 2 }}>
                        行 {inst.originLine || '—'}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
