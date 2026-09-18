import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import App from '../src/App';

;(async () => {
// 复用 jsdom-setup.cjs（node --require 预加载）创建的 window/document：
// React 的根事件监听注册在首次加载时的 document 上，不能在此另建 JSDOM 替换全局对象。
const container = document.getElementById('root') ?? (() => {
  const div = document.createElement('div');
  div.id = 'root';
  document.body.appendChild(div);
  return div;
})();
const root = createRoot(container);
await act(async () => {
  root.render(React.createElement(App));
});

const byText = (sel: string, text: string): Element | null =>
  [...container.querySelectorAll(sel)].find((el) => el.textContent?.includes(text)) ?? null;

// 1) 空闲窗口页签存在并可切换
const tab = byText('.tabs button', '空闲窗口') as HTMLElement;
if (!tab) throw new Error('空闲窗口页签未渲染');
await act(async () => tab.click());

// 表单元素
if (!container.textContent?.includes('IANA 时区')) throw new Error('应显示 IANA 时区输入');
if (!container.textContent?.includes('工作时段')) throw new Error('应显示工作时段');
const selects = container.querySelectorAll('.free-form select');
if (selects.length !== 1) throw new Error('应有 LOCATION 下拉');
// 默认应计算出空档（示例数据：会议室 A，浏览器本地时区默认）
const summary = container.querySelector('.free-summary')?.textContent ?? '';
if (!/共 \d+ 个空档/.test(summary)) throw new Error(`应显示空档统计，实际：${summary}`);
console.log('✓ 空闲窗口表单渲染，location options =', (selects[0] as HTMLSelectElement).options.length);

// 2) 切到纽约时区，2026-03-05..03-09，工作时段 09-18，>=30 分钟
const tzInput = container.querySelector('.ff-tz input') as HTMLInputElement;
const dateInputs = container.querySelectorAll('.free-form input[type="date"]') as NodeListOf<HTMLInputElement>;
const workInputs = container.querySelectorAll('.free-form input[type="time"]') as NodeListOf<HTMLInputElement>;
const minInput = container.querySelector('.ff-minutes input') as HTMLInputElement;

const setNative = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const setSelectNative = (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

await act(async () => {
  setSelectNative(selects[0] as HTMLSelectElement, '会议室 A');
  setNative(tzInput, 'America/New_York');
  setNative(dateInputs[0], '2026-03-05');
  setNative(dateInputs[1], '2026-03-09');
  setNative(workInputs[0], '09:00');
  setNative(workInputs[1], '18:00');
  setNative(minInput, '30');
});

let rows = container.querySelectorAll('tr.free-row');
console.log(`✓ 纽约/会议室 A 条件下空档 ${rows.length} 行`);
if (rows.length < 3) throw new Error('应至少有 3 个空档行');
if (!container.textContent?.includes('DST')) {
  // 2026-03-08 是 23 小时 DST 日，表格内应有 DST 23h 标记
  throw new Error('DST 切换日应标注 23h');
}
console.log('✓ DST 切换日标注 23h');

// 3) 点击空档中的“后一忙碌事件”链接：切回生效实例页并选中对应行
const neighborLinks = container.querySelectorAll('a.free-neighbor');
if (neighborLinks.length === 0) throw new Error('空档行应有相邻事件链接');
await act(async () => (neighborLinks[0] as HTMLElement).click());
const visibleBtn = byText('.tabs button', '生效实例') as HTMLElement;
if (!visibleBtn.classList.contains('active')) throw new Error('点击相邻事件应切回生效实例页');
if (!container.querySelector('tr.instance-row.selected')) throw new Error('应选中相邻事件行');
console.log('✓ 点击空档相邻事件联动生效表');

// 4) 回到空闲窗口，停用“站会改点”例外：2026-03-09 原本整日空闲（例外把站会挪到会议室 B），
//    停用后站会恢复占用会议室 A 09:00-09:30，空档由 540 分钟缩短为 510
await act(async () => tab.click());
const mar9RowText = () =>
  [...container.querySelectorAll('tr.free-row')]
    .find((r) => r.querySelector('td')?.textContent?.startsWith('2026-03-09'))
    ?.textContent ?? '';
const before9 = mar9RowText();
if (!before9.includes('540 分钟')) throw new Error(`停用前 03-09 应为整日 540 分钟空档，实际：${before9}`);
const checkboxes = [...container.querySelectorAll('.override-item input[type="checkbox"]')] as HTMLInputElement[];
const overrideCb = checkboxes.find((c) => c.checked && !c.disabled);
if (!overrideCb) throw new Error('找不到例外停用勾选框');
await act(async () => overrideCb.click());
const after9 = mar9RowText();
if (!after9.includes('510 分钟')) throw new Error(`停用后 03-09 应缩短为 510 分钟空档，实际：${after9}`);
console.log(`✓ 停用例外后空档实时重算：03-09 540 分钟 -> 510 分钟`);

root.unmount();
console.log('✓ 空闲窗口 DOM 集成验证通过');
process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
