# 📅 iCalendar 重复日程校验台（Recur Inspector）

一款**完全本地运行**的 iCalendar（ICS）重复日程展开与校验工具。粘贴或导入包含
`DTSTART`、`RRULE`、`RDATE`、`EXDATE`、`RECURRENCE-ID` 的日历文本，在指定日期范围内
展开全部实例，验证例外覆盖、取消、跨夏令时（DST）本地时刻与 `LOCATION` 冲突，
并可交互式停用例外、修改规则后实时重算，最终导出规范化 ICS。

- **技术栈**：React 18 + TypeScript + Vite 5 + [ical.js](https://github.com/kewisch/ical.js) 2.x
- **隐私**：纯前端静态应用，ICS 内容不出本机，无任何后端请求。

## 功能

| 能力 | 说明 |
| --- | --- |
| 重复展开 | RRULE（FREQ/INTERVAL/COUNT/UNTIL/BYxxx）、RDATE（含 PERIOD）、EXDATE、单次事件 |
| 例外覆盖 | `RECURRENCE-ID` 子事件**替换**对应原实例；改时间/地点/时长均以例外为准 |
| 取消隐藏 | `STATUS:CANCELLED` 的实例不进入生效列表，只在「已取消」审计页留痕 |
| 跨 DST | 在事件**声明的 TZID 墙钟空间**迭代，墙钟时刻恒定，UTC 随偏移自动平移并标注 DST |
| 缺失时区兜底 | ICS 未携带 VTIMEZONE 时，用浏览器 `Intl` 时区数据库自动合成（含 DST 切换点） |
| 地点冲突 | 按相同非空 `LOCATION` 检测半开区间重叠，相切不算冲突 |
| 空闲窗口 | 选定 `LOCATION` + IANA 时区 + 日期范围 + 每日工作时段 + 最短分钟数，按所选时区把跨日事件裁剪到每天，合并相交/首尾相接的忙碌半开区间后列出可容纳的空档；跨 DST 日按真实本地日界（23/25 小时）换算。点击空档联动定位生效实例表中其前 / 后相邻事件，编辑规则或停用例外后实时重算 |
| 联动定位 | 点击实例/冲突/告警，右侧原始 ICS 高亮所属主事件块、RECURRENCE-ID 块与原始行号 |
| 例外停用 | 勾选框即时停用任意一条例外（含 CANCELLED），原实例立即恢复并重算冲突 |
| 规则编辑 | 就地修改 RRULE 文本，合法即实时重算；非法时显示解析错误并回退到上一条有效规则 |
| 变更影响 | 以 **UID + 原始 recurrence key** 为实例身份，比对原始日历与编辑后的生效实例：新增 / 移除 / 开始·结束移动 / 标题·地点·状态变化逐项列出前后值；移动不会误报成一删一增。支持按变更类型筛选，点击差异项联动实例表与 ICS 源码定位，无改动时显示空状态 |
| 规范化导出 | 输出 CRLF、RFC 5545 折行、按 UID 排序、内聚所需 VTIMEZONE（含合成时区），可下载/复制 |

## 一条命令启动（Docker）

需要已安装 Docker 20.10+ 与 Docker Compose v2：

```bash
docker compose up -d --build
```

启动后访问：

> **http://localhost:8080**

停止：

```bash
docker compose down
```

修改宿主机端口（如 9090）：编辑 `docker-compose.yml` 中 `"9090:80"` 后重新 `up -d`。

镜像为纯静态 nginx 托管，构建时即完成 `tsc` 类型检查与 Vite 打包；重新构建可验证全部改动：

```bash
docker compose up -d --build
```

### 开发模式（Vite 热更新）

```bash
docker compose -f docker-compose.dev.yml up
```

访问 **http://localhost:5173**。

## 本地开发（无 Docker）

要求 Node.js 18+（推荐 20）：

```bash
npm install
npm run dev        # http://localhost:5173
```

其他命令：

```bash
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 本地预览生产构建 http://localhost:4173
npm run smoke      # 引擎语义冒烟测试（RRULE/RDATE/EXDATE/覆盖/取消/DST/冲突/空闲窗口/导出）
npm run dom:check  # DOM 集成验证：变更影响页签 / 例外停用 / 点击联动
npm run dom:free   # DOM 集成验证：空闲窗口表单 / DST 23h 标注 / 相邻事件联动 / 停用后重算
npm test           # 依次运行以上三个校验
```

## 使用指引

1. 左侧粘贴 ICS，或点「导入 .ics」选择文件；首次打开自带覆盖各类语义的示例。
2. 顶部「解析并展开」，在范围条设置起止日期（半开区间，按浏览器本地时区的日界）。
3. 三栏布局：
   - **左栏**：ICS 输入、解析告警、**原文行高亮**（蓝色=主事件块，紫色=例外块，
     红框=冲突方事件块，高亮行=RRULE/RDATE/EXDATE/RECURRENCE-ID 原始行）。
   - **中栏**：每个 UID 一张规则卡，可编辑 RRULE、勾选停用具条例外，并显示
     RDATE/EXDATE 清单与行号。
   - **右栏**：实例表五个页签——生效 / 已取消 / 已排除 / **变更影响** / **空闲窗口**；生效表支持地点关键字过滤与
     「仅看冲突」。「变更影响」比较原始日历与当前编辑（RRULE 修改、例外停用）后的差异，可按
     新增 / 移除 / 移动 / 字段变化筛选，重解析或调整日期范围后立即重算。DST 标记表示该实例相对
     序列首个实例的 UTC 偏移已变化。
   - **空闲窗口**：在右栏第 5 个页签。先选择一个 `LOCATION`，填写 IANA 时区（支持自动补全常见时区）、
     日期范围（含首尾日）、每日工作时段（本地墙钟 `HH:MM`）与空档至少要容纳的分钟数，列表即按日期、
     开始时间展示所有足够长的空档；跨 DST 的日期会标注当日真实长度（如 `DST 23h` / `DST 25h`）。
     点击某条空档（或其中的前 / 后相邻事件链接）会切回「生效实例」页签并选中、滚动到对应事件行。
     编辑 RRULE 或停用例外后无需重新查询，空档立即重算。
4. 点击任一实例、差异项或空档相邻事件：右表选中、左栏原文同步定位；有冲突时冲突方事件块同步红框高亮。
   被移除的实例在生效表中以「已移除」幽灵行展示，仍可定位其原始块与行号。
5. 点右上「导出规范化 ICS」下载 `normalized.ics`，或「复制 ICS」到剪贴板。

## 语义约定

- **变更影响身份**：实例身份为 `UID#原始 recurrence key`（覆盖实例取 RECURRENCE-ID 对应时刻，
  普通 RRULE/RDATE/单次实例取原始起点）。覆盖改期后两侧身份仍相同，只标记开始/结束移动；
  仅候选侧存在标为新增，仅原始侧存在标为移除。比对只纳入当前查询范围内的生效实例，
  已取消 / 已排除的审计行不参与。
- **时间匹配**：EXDATE/RECURRENCE-ID 按绝对时刻匹配（DATE 型按当天 00:00）。
  请保证它们与 DTSTART 的时区形式一致（同为 `TZID=` 或同为 UTC `Z`）。
- **RDATE-PERIOD**：使用 PERIOD 自带的结束时间反推该实例时长。
- **无 DTEND/DURATION**：非全天事件时长按 0 处理，全天事件按 1 天处理（并告警提示）。
- **冲突**：只比较当前生效实例；全天事件参与检测；无 LOCATION 的事件不参与。
- **空闲窗口**：
  - 忙碌来源是当前「生效」实例（已取消 / 已排除的实例不参与；例外停用后恢复的原实例立即参与），
    且只取与所选 `LOCATION`（trim 后精确相等）相同的实例；无 LOCATION 的实例一律忽略。
  - 每一天都是所选 IANA 时区内的半开本地日 `[00:00, 次日 00:00)`，由浏览器 `Intl` 时区库按真实
    UTC 瞬间换算；春令时切换日为 23 小时、秋令时为 25 小时，绝不固定按 24 小时推进。工作时段
    两端按当天墙钟映射，落在不存在墙钟（春令时空档）内时取跳变后的第一个有效瞬间。
  - 跨本地日界的定时事件先与当天求交再参与忙碌合并；全天事件（`VALUE=DATE`）按其撰写日期整天
    占用工作时段，不随查询时区平移。忙碌段为半开区间 `[start, end)`，相交或首尾相接
    （`end === next.start`）都会合并，因此相切不会留下 0 分钟空档。
  - 空档同样为半开区间，按当天墙钟时长（分钟）过滤；前 / 后相邻事件指当天裁剪后紧邻该空档的
    忙碌实例，工作时段之外但在同一本地日内的事件也会被选为相邻事件。
  - 暂不支持跨午夜的工作时段（如 22:00–次日 06:00），日期跨度上限 366 天。
- **合成 VTIMEZONE**：基于展开时间窗（DTSTART/UNTIL 年份前后取余量）探测 DST 切换点，
  仅保证窗内精确；导出的 ICS 建议在目标日历客户端复验。
- 暂不支持 `RECURRENCE-ID;RANGE=THISANDFUTURE`（按单实例覆盖处理并给出告警）。

## 目录结构

```
src/
├── ical-engine/
│   ├── parser.ts       # 折行还原、行号索引、两遍解析（先注册时区再取值）、主子归组
│   ├── timezones.ts    # Intl 探测 DST 切换点，合成 VTIMEZONE
│   ├── expansion.ts    # RRULE 迭代 + RDATE/EXDATE/覆盖/取消 + 范围与上限
│   ├── conflicts.ts    # LOCATION 维度半开区间重叠检测
│   ├── freewindows.ts  # 空闲窗口：真实本地日界(DST)/跨日裁剪/忙碌合并/相邻事件
│   ├── diff.ts         # 变更影响：UID+原始 recurrence key 身份比对（新增/移除/移动/字段）
│   ├── normalizer.ts   # 规范化 ICS 输出（排序、时区内聚、规则/停用生效）
│   ├── types.ts        # 领域模型
│   └── samples.ts      # 内置示例
├── components/         # SourceView / InstanceTable / SeriesPanel / ChangeImpact / FreeWindows
├── utils/format.ts
├── App.tsx
└── main.tsx
scripts/
├── smoke.ts            # 引擎端到端冒烟测试
├── dom-check.ts        # 变更影响 DOM 集成验证
├── free-dom-check.ts   # 空闲窗口 DOM 集成验证
└── jsdom-setup.cjs     # DOM 测试预加载（react-dom 初始化前注入 jsdom 全局对象）
```
