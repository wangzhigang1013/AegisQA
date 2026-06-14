"""AegisQA 性能基准测试脚本。

简单性能测试，无需额外依赖。

使用方法：
    python tests/performance/benchmark.py
"""

import json
import statistics
import time
from urllib.request import Request, urlopen


BASE_URL = "http://localhost:8000"
ENDPOINTS = [
    ("GET", "/dashboard/summary"),
    ("GET", "/tasks?page=1&page_size=10"),
    ("GET", "/runs?page=1&page_size=10"),
    ("GET", "/datasets"),
    ("GET", "/skills"),
    ("GET", "/workflows"),
    ("GET", "/experiments"),
    ("GET", "/healthz"),
    ("GET", "/metrics/summary"),
    ("GET", "/audit-events"),
    ("GET", "/ci-gates"),
    ("GET", "/workflow-templates"),
    ("GET", "/governance/runtime-status"),
    ("GET", "/model-gateway/status"),
    ("GET", "/skills/packages"),
]


def make_request(method: str, path: str) -> tuple[int, float]:
    """发送 HTTP 请求并返回状态码和延迟。"""
    url = f"{BASE_URL}{path}"
    req = Request(url, method=method)
    req.add_header("Content-Type", "application/json")

    start = time.time()
    try:
        with urlopen(req, timeout=30) as response:
            response.read()
            status = response.status
    except Exception as e:
        status = 0
        print(f"Error: {e}")
    elapsed = (time.time() - start) * 1000  # 毫秒

    return status, elapsed


def run_benchmark(iterations: int = 10):
    """运行性能基准测试。"""
    print(f"AegisQA 性能基准测试")
    print(f"目标: {BASE_URL}")
    print(f"迭代次数: {iterations}")
    print("=" * 60)

    results = {}

    for method, path in ENDPOINTS:
        latencies = []
        status_codes = []

        for _ in range(iterations):
            status, elapsed = make_request(method, path)
            latencies.append(elapsed)
            status_codes.append(status)

        # 统计
        success_count = sum(1 for s in status_codes if 200 <= s < 300)
        success_rate = success_count / len(status_codes) * 100
        avg_latency = statistics.mean(latencies)
        p50_latency = statistics.median(latencies)
        p95_latency = latencies[int(len(latencies) * 0.95)]
        p99_latency = latencies[int(len(latencies) * 0.99)]

        results[path] = {
            "success_rate": success_rate,
            "avg_latency_ms": round(avg_latency, 2),
            "p50_latency_ms": round(p50_latency, 2),
            "p95_latency_ms": round(p95_latency, 2),
            "p99_latency_ms": round(p99_latency, 2),
        }

        # 输出
        status_icon = "✓" if success_rate == 100 else "✗"
        print(f"{status_icon} {method:4} {path:40} "
              f"成功: {success_rate:5.1f}% "
              f"延迟: avg={avg_latency:6.1f}ms p50={p50_latency:6.1f}ms p95={p95_latency:6.1f}ms")

    print("=" * 60)
    print("\n详细结果:")
    print(json.dumps(results, indent=2, ensure_ascii=False))

    # 汇总
    all_latencies = [r["avg_latency_ms"] for r in results.values()]
    print(f"\n汇总:")
    print(f"  平均延迟: {statistics.mean(all_latencies):.1f}ms")
    print(f"  最慢端点: {max(results.items(), key=lambda x: x[1]['avg_latency_ms'])[0]}")
    print(f"  最快端点: {min(results.items(), key=lambda x: x[1]['avg_latency_ms'])[0]}")


if __name__ == "__main__":
    run_benchmark(iterations=10)
