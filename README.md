# fold-detect-worker

Cloudflare Workers 服务, 通过 GitHub 自动部署运行, 使用 D1 存储数据。

## 项目功能说明

- 定时同步数据: 通过 Cron 定时从 MobileModels-csv 拉取并写入 D1。
- 折叠屏查询: 按关键词筛选折叠屏型号。
- 品牌/型号查询: 支持品牌和型号的精确匹配与模糊匹配。
- 手动同步: 可通过受保护接口手动触发一次数据同步。

## GitHub 运行与配置

1. 在 Cloudflare Dashboard 导入这个 GitHub 仓库并完成首次部署。
2. 手动创建 D1 数据库（如还未创建）。
3. 进入 Worker Settings, 配置以下内容:

- D1 Database Bindings:
  - Binding Name: `DB`
  - Database: 直接按名称选择你创建的 D1 数据库
- Variables and Secrets:
  - `SYNC_TOKEN`（可选，建议配置）
  - `DATASET_URL`（可选）

4. 保存并重新部署一次。

## API 说明

### GET /

返回服务功能和 API 列表说明。

### GET /api/health

返回最近同步计数和时间。

### GET /api/fold-models

按关键词查询折叠屏型号。

- `keywords`: 可选, 逗号分隔关键词。

### GET /api/models

按品牌/型号查询机型数据, 支持精确或模糊匹配。

- `brand`: 可选, 品牌名称, 如 `华为`
- `brand_match`: 可选, `fuzzy` 或 `exact`, 默认 `fuzzy`
- `model`: 可选, 型号名称, 如 `Mate X5`
- `model_match`: 可选, `fuzzy` 或 `exact`, 默认 `fuzzy`
- `limit`: 可选, 返回条数上限, 默认 `100`, 最大 `500`

注意: `brand` 和 `model` 至少传一个, 否则返回 `400`。

示例:

- `GET /api/models?brand=华&brand_match=fuzzy`
- `GET /api/models?model=Mate%20X5&model_match=exact`
- `GET /api/models?brand=荣耀&brand_match=exact&model=Magic%20V3&model_match=exact`

### POST /api/sync

手动触发同步。

- 当配置了 `SYNC_TOKEN` 时, 需在请求头传 `x-sync-token`。

## 说明

- 表结构由代码在首次请求或定时任务触发时自动创建。
- 定时任务配置在 `wrangler.toml` 的 `triggers.crons`。
