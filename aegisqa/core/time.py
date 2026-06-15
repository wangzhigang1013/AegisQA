"""时间工具模块。

统一使用北京时间 (UTC+8)，确保所有时间戳一致。
时间格式：2026-06-16 00:15:38
"""

from datetime import datetime, timezone, timedelta

# 北京时区 (UTC+8)
BEIJING_TZ = timezone(timedelta(hours=8))

# 友好时间格式：2026-06-16 00:15:38
FRIENDLY_FORMAT = "%Y-%m-%d %H:%M:%S"


def now_beijing() -> datetime:
    """获取当前北京时间。"""
    return datetime.now(BEIJING_TZ)


def now_beijing_str() -> str:
    """获取当前北京时间的友好格式字符串。

    返回格式：2026-06-16 00:15:38
    """
    return now_beijing().strftime(FRIENDLY_FORMAT)


def now_beijing_iso() -> str:
    """获取当前北京时间的 ISO 格式字符串（用于 API 响应）。

    返回格式：2026-06-16T00:15:38+08:00
    """
    return now_beijing().isoformat()


def format_datetime(dt: datetime, friendly: bool = True) -> str:
    """格式化日期时间。

    Args:
        dt: 日期时间对象
        friendly: 是否使用友好格式，默认 True

    Returns:
        格式化的时间字符串
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BEIJING_TZ)
    elif dt.tzinfo != BEIJING_TZ:
        dt = dt.astimezone(BEIJING_TZ)

    if friendly:
        return dt.strftime(FRIENDLY_FORMAT)
    return dt.isoformat()


def parse_datetime(dt_str: str) -> datetime:
    """解析日期时间字符串。

    支持格式：
    - 2026-06-16 00:15:38
    - 2026-06-16T00:15:38+08:00
    - 2026-06-16T00:15:38Z
    """
    # 尝试友好格式
    try:
        return datetime.strptime(dt_str, FRIENDLY_FORMAT).replace(tzinfo=BEIJING_TZ)
    except ValueError:
        pass

    # 尝试 ISO 格式
    try:
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=BEIJING_TZ)
        return dt
    except ValueError:
        pass

    raise ValueError(f"无法解析时间字符串: {dt_str}")


def utc_to_beijing(utc_dt: datetime) -> datetime:
    """将 UTC 时间转换为北京时间。"""
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=timezone.utc)
    return utc_dt.astimezone(BEIJING_TZ)


def beijing_to_utc(beijing_dt: datetime) -> datetime:
    """将北京时间转换为 UTC 时间。"""
    if beijing_dt.tzinfo is None:
        beijing_dt = beijing_dt.replace(tzinfo=BEIJING_TZ)
    return beijing_dt.astimezone(timezone.utc)
