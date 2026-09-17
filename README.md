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
npm run smoke      # 引擎语义冒烟测试（RRULE/RDATE/EXDATE/覆盖/取消/DST/冲突/导出）
```

## 使用指引

1. 左侧粘贴 ICS，或点「导入 .ics」选择文件；首次打开自带覆盖各类语义的示例。
2. 顶部「解析并展开」，在范围条设置起止日期（半开区间，按浏览器本地时区的日界）。
3. 三栏布局：
   - **左栏**：ICS 输入、解析告警、**原文行高亮**（蓝色=主事件块，紫色=例外块，
     红框=冲突方事件块，高亮行=RRULE/RDATE/EXDATE/RECURRENCE-ID 原始行）。
   - **中栏**：每个 UID 一张规则卡，可编辑 RRULE、勾选停用具条例外，并显示
     RDATE/EXDATE 清单与行号。
   - **右栏**：实例表四个页签——生效 / 已取消 / 已排除 / **变更影响**；生效表支持地点关键字过滤与
     「仅看冲突」。「变更影响」比较原始日历与当前编辑（RRULE 修改、例外停用）后的差异，可按
     新增 / 移除 / 移动 / 字段变化筛选，重解析或调整日期范围后立即重算。DST 标记表示该实例相对
     序列首个实例的 UTC 偏移已变化。
4. 点击任一实例或差异项：右表选中、左栏原文同步定位；有冲突时冲突方事件块同步红框高亮。
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
│   ├── diff.ts         # 变更影响：UID+原始 recurrence key 身份比对（新增/移除/移动/字段）
│   ├── normalizer.ts   # 规范化 ICS 输出（排序、时区内聚、规则/停用生效）
│   ├── types.ts        # 领域模型
│   └── samples.ts      # 内置示例
├── components/         # SourceView / InstanceTable / SeriesPanel / ChangeImpact
├── utils/format.ts
├── App.tsx
└── main.tsx
scripts/smoke.ts        # 引擎端到端冒烟测试
```
