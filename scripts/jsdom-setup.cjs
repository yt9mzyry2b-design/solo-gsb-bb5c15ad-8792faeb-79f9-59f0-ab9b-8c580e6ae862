// DOM 集成测试预加载：必须在 react / react-dom 模块初始化之前提供 DOM 全局对象，
// 否则 react-dom 顶层的能力探测（'input' 事件是否支持等）在无 document 环境下被永久缓存为 false，
// 会让受控输入走错兼容路径。通过 `node --require` 在加载打包产物前执行本文件。
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
