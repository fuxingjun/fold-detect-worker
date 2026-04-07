# fold-detect-worker

一个运行在 Cloudflare Workers 的服务, 定时从 MobileModels-csv 拉取 models.csv, 写入 D1 数据库, 再根据关键词返回折叠屏型号列表。

## 功能

- 通过 Cron Trigger 定时同步数据。
- 数据写入 Cloudflare D1。
- 提供折叠屏查询接口。
- 提供健康检查接口。
- 提供手动触发同步接口。

## 数据源

- 仓库: https://github.com/KHwang9883/MobileModels-csv
- CSV: https://raw.githubusercontent.com/KHwang9883/MobileModels-csv/main/models.csv

## 环境要求

- Node.js >= 18
- Cloudflare 账号
- Wrangler CLI

## 安装依赖

```bash
npm install
```

## 初始化 D1

1. 创建 D1 数据库:

```bash
npx wrangler d1 create fold-detect-db
```

2. 将输出里的 database_id 填到 wrangler.toml 的 d1_databases.database_id。

3. 执行迁移:

```bash
npx wrangler d1 execute fold-detect-db --local --file migrations/0001_init.sql
```

4. 如果要区分预发和生产, 把 wrangler.toml 里下面两个占位符替换成真实值:

- REPLACE_WITH_PREVIEW_D1_DATABASE_ID
- REPLACE_WITH_PRODUCTION_D1_DATABASE_ID

## Cloudflare 直连 GitHub 部署

1. 打开 Cloudflare Dashboard, 进入 Workers and Pages, 点击 Create, 选择 Import a repository。

2. 选择你的 GitHub 仓库, 分支建议 main。

3. Build 设置建议如下:

- Build command: npm install
- Deploy command: npx wrangler deploy --env production

4. 在 Worker Settings 里配置变量和绑定:

- D1 Database Bindings: 添加 binding 名称 DB, 绑定到你的 D1 数据库。
- Variables and Secrets: 添加 SYNC_TOKEN, 用于保护 POST /api/sync。
- Variables and Secrets: 可选添加 DATASET_URL, 覆盖默认 CSV 地址。

5. 保存后触发首次部署, 每次 GitHub push 会自动部署。

## 本地开发

```bash
npm run dev
```

默认地址: http://127.0.0.1:8787

## 部署

```bash
npm run deploy
```

## 定时任务

- 定时表达式在 wrangler.toml 的 triggers.crons。
- 当前默认值: 0 */6 * * *
- Worker 会在 scheduled 事件触发时执行同步。

## 环境变量

在 Cloudflare Worker 或 .dev.vars 中可配置:

- SYNC_TOKEN: 手动触发同步接口的鉴权Token, 可选。
- DATASET_URL: 数据源地址, 可选, 默认使用 models.csv 官方地址。

## API 文档

### GET /api/health

返回最近同步信息。

示例响应:

```json
{
  "ok": true,
  "lastSyncCount": 11651,
  "lastSyncAt": "2026-04-07 10:00:00"
}
```

### GET /api/fold-models

按关键词查询折叠屏型号。

Query 参数:

- keywords: 可选, 逗号分隔, 例如 Mate X,Magic V,Galaxy Z Fold3

不传 keywords 时默认使用:

- Mate X
- Magic V
- Galaxy Z Fold
- Galaxy Z Flip
- Find N
- MIX Fold
- X Fold
- Razr

示例响应:

```json
{
  "keywords": ["Mate X", "Magic V", "Galaxy Z Fold3"],
  "total": 49,
  "data": [
    {
      "model": "NOH-AN00",
      "brandTitle": "华为",
      "modelName": "Mate Xs",
      "versionName": "全网通版"
    }
  ]
}
```

### POST /api/sync

手动触发一次同步。

- 若配置了 SYNC_TOKEN, 需要请求头 x-sync-token。

成功响应:

```json
{
  "ok": true,
  "synced": 11651
}
```

## HTTP 调用示例

见 http/fold-detect.http。

## 测试

```bash
npm test
```

测试覆盖:

- 关键词拆分与匹配。
- CSV 字段解析。
- Worker 路由的核心行为。

## 项目结构

```text
.
├── http/
│   └── fold-detect.http
├── migrations/
│   └── 0001_init.sql
├── src/
│   ├── constants.js
│   ├── db.js
│   ├── schema.js
│   ├── worker.js
│   └── services/
│       ├── csv.js
│       ├── filter.js
│       └── sync.js
├── test/
│   ├── csv.test.js
│   ├── filter.test.js
│   └── worker.test.js
├── wrangler.toml
└── package.json
```
