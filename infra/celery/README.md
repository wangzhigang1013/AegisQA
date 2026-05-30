# Celery / Redis 生产适配说明

AegisQA 本地 MVP 使用内存队列数组保存轻量消息，消息体只包含 `item_id`。
生产部署时使用 Redis 作为 broker，Celery Worker 消费同样的轻量消息契约。

## 消息契约

```json
{"item_id": "item-xxxx"}
```

禁止在 broker 消息中携带完整 `row_json`、大体积 Context、原始日志或大字段。
Worker 必须通过 `item_id` 查询 `run_items`，再按 `row_id` 懒加载单条样本。

## 限速策略

- Skill Adapter 层做外部 API QPS 控制。
- Celery task 可配置 `rate_limit`。
- Redis 信号量可限制同一外部服务的全局并发。
- 429 或限流错误优先等待/退避/降派发，不做无意义高频重试。

