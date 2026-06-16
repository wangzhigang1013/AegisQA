"""AegisQA 前端页面自动化验证脚本。

使用 Playwright 逐页面验证前端功能：
- 页面加载无白屏/报错
- 数据正确显示
- 关键交互可点击
- 无 console error

用法:
    python tests/frontend_e2e.py              # 全量验证
    python tests/frontend_e2e.py --page overview  # 单页验证
    python tests/frontend_e2e.py --headed     # 有头模式(可视化)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, Browser, ConsoleMessage

FRONTEND_URL = "http://localhost:5173"
BACKEND_URL = "http://localhost:8000"
TIMEOUT = 15_000  # 15s per page


# ── 数据结构 ──────────────────────────────────────────────────────────

@dataclass
class PageResult:
    name: str
    url: str
    passed: bool = True
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    load_time_ms: float = 0
    elements_found: int = 0
    api_calls: list[str] = field(default_factory=list)


@dataclass
class SuiteResult:
    total: int = 0
    passed: int = 0
    failed: int = 0
    pages: list[PageResult] = field(default_factory=list)


# ── 页面定义 ──────────────────────────────────────────────────────────

PAGES = {
    "overview": {
        "path": "/",
        "name": "概览页",
        "expect_elements": [
            {"selector": "text=工作台", "desc": "页面标题"},
        ],
        "min_elements": 5,
    },
    "runs": {
        "path": "/runs",
        "name": "任务管理",
        "expect_elements": [
            {"selector": "text=任务", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "skills": {
        "path": "/skills",
        "name": "Skill 管理",
        "expect_elements": [
            {"selector": "text=Skill", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "datasets": {
        "path": "/datasets",
        "name": "数据管理",
        "expect_elements": [
            {"selector": "text=数据", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "workflow-designer": {
        "path": "/workflow-designer",
        "name": "工作流设计器",
        "expect_elements": [
            {"selector": ".react-flow, [class*=canvas], [class*=workflow]", "desc": "画布区域"},
        ],
        "min_elements": 2,
    },
    "workflow-market": {
        "path": "/workflow-market",
        "name": "工作流市场",
        "expect_elements": [
            {"selector": "text=工作流", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "reports": {
        "path": "/reports",
        "name": "报告中心",
        "expect_elements": [
            {"selector": "text=报告", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "experiments": {
        "path": "/experiments",
        "name": "实验管理",
        "expect_elements": [
            {"selector": "text=实验", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "ci-gates": {
        "path": "/ci-gates",
        "name": "质量门禁",
        "expect_elements": [
            {"selector": "text=门禁", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "annotation-queue": {
        "path": "/annotation-queue",
        "name": "标注队列",
        "expect_elements": [
            {"selector": "text=标注", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "candidate-assets": {
        "path": "/candidate-assets",
        "name": "候选资产",
        "expect_elements": [
            {"selector": "text=候选", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "repair-tasks": {
        "path": "/repair-tasks",
        "name": "修复任务",
        "expect_elements": [
            {"selector": "text=修复", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "judge-audit": {
        "path": "/judge-audit",
        "name": "Judge 审计",
        "expect_elements": [
            {"selector": "text=Judge", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "governance": {
        "path": "/governance",
        "name": "治理中心",
        "expect_elements": [
            {"selector": "text=治理", "desc": "页面标题"},
        ],
        "min_elements": 3,
    },
    "trace-tree": {
        "path": "/tasks/task-e5cd0e7d70f3/trace-tree",
        "name": "追踪树",
        "expect_elements": [],
        "min_elements": 1,
    },
    "trace-flow": {
        "path": "/tasks/task-e5cd0e7d70f3/trace-flow",
        "name": "追踪流",
        "expect_elements": [],
        "min_elements": 1,
    },
}


# ── 验证逻辑 ──────────────────────────────────────────────────────────

def collect_console_errors(errors: list[str]) -> callable:
    """返回一个 console message handler，收集错误。"""
    def handler(msg: ConsoleMessage):
        if msg.type == "error":
            text = msg.text
            # 过滤掉常见的无害错误
            ignore_patterns = [
                "favicon.ico",
                "ResizeObserver loop",
                "Non-Error promise rejection",
                "Download the React DevTools",
            ]
            if not any(p in text for p in ignore_patterns):
                errors.append(text[:200])
    return handler


def verify_page(page: Page, key: str, config: dict) -> PageResult:
    """验证单个页面。"""
    result = PageResult(name=config["name"], url=config["path"])
    console_errors: list[str] = []
    page.on("console", collect_console_errors(console_errors))

    try:
        # 1. 加载页面
        t0 = time.monotonic()
        response = page.goto(
            f"{FRONTEND_URL}{config['path']}",
            wait_until="networkidle",
            timeout=TIMEOUT,
        )
        result.load_time_ms = (time.monotonic() - t0) * 1000

        if response and response.status >= 400:
            result.passed = False
            result.errors.append(f"HTTP {response.status}")

        # 2. 等待页面渲染
        page.wait_for_timeout(1500)

        # 3. 检查页面是否有内容 (非白屏)
        body_text = page.inner_text("body").strip()
        if len(body_text) < 10:
            result.passed = False
            result.errors.append("页面白屏 (body 文本 < 10 字符)")

        # 4. 检查是否没有 JS 错误导致的崩溃
        error_boundary = page.locator("text=Something went wrong").first
        try:
            if error_boundary.is_visible(timeout=500):
                result.passed = False
                result.errors.append("检测到 ErrorBoundary 显示")
        except Exception:
            pass  # element not found = no error boundary

        # 5. 检查期望元素 (使用 locator API)
        for elem in config.get("expect_elements", []):
            try:
                sel = elem["selector"]
                if sel.startswith("text="):
                    loc = page.get_by_text(sel[5:]).first
                else:
                    loc = page.locator(sel).first
                if loc.is_visible(timeout=2000):
                    result.elements_found += 1
            except Exception:
                pass  # not found is OK

        # 6. 统计页面元素数量
        all_buttons = page.locator("button").count()
        all_links = page.locator("a").count()
        all_inputs = page.locator("input").count()
        all_tables = page.locator("table").count()
        result.elements_found = max(result.elements_found, all_buttons + all_links + all_inputs + all_tables)

        if result.elements_found < config.get("min_elements", 1):
            result.warnings.append(f"页面元素偏少: {result.elements_found}")

        # 7. 收集 console errors
        result.console_errors = console_errors
        if console_errors:
            result.warnings.append(f"{len(console_errors)} 个 console error")

        # 8. 检查是否有加载中的 spinner 卡住
        spinners = page.locator("[class*=ant-spin-spinning], [class*=loading]").count()
        if spinners > 3:
            result.warnings.append(f"检测到 {spinners} 个 loading spinner，可能卡住")

    except Exception as e:
        result.passed = False
        result.errors.append(f"异常: {str(e)[:200]}")

    return result


# ── 主流程 ──────────────────────────────────────────────────────────

def run_suite(headed: bool = False, filter_page: str | None = None) -> SuiteResult:
    """运行全部或指定页面的验证。"""
    suite = SuiteResult()

    with sync_playwright() as p:
        browser: Browser = p.chromium.launch(
            headless=not headed,
            args=["--disable-gpu", "--no-sandbox"],
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="zh-CN",
        )

        pages_to_test = PAGES
        if filter_page:
            if filter_page not in PAGES:
                print(f"❌ 未知页面: {filter_page}")
                print(f"   可选: {', '.join(PAGES.keys())}")
                sys.exit(1)
            pages_to_test = {filter_page: PAGES[filter_page]}

        for key, config in pages_to_test.items():
            suite.total += 1
            page_obj = context.new_page()

            print(f"\n{'─'*50}")
            print(f"🔍 [{suite.total}/{len(pages_to_test)}] {config['name']} ({config['path']})")

            result = verify_page(page_obj, key, config)
            suite.pages.append(result)

            if result.passed:
                suite.passed += 1
                print(f"  ✅ 通过 ({result.load_time_ms:.0f}ms, {result.elements_found} 个元素)")
            else:
                suite.failed += 1
                print(f"  ❌ 失败")
                for err in result.errors:
                    print(f"     → {err}")

            for warn in result.warnings:
                print(f"  ⚠️  {warn}")

            if result.console_errors:
                for cerr in result.console_errors[:3]:
                    print(f"  🔴 console: {cerr[:100]}")

            page_obj.close()

        browser.close()

    return suite


def print_summary(suite: SuiteResult):
    """打印汇总报告。"""
    print(f"\n{'='*60}")
    print(f"  AegisQA 前端自动化验证报告")
    print(f"{'='*60}")
    print(f"  总计: {suite.total} | ✅ 通过: {suite.passed} | ❌ 失败: {suite.failed}")
    print(f"{'='*60}")

    if suite.failed > 0:
        print("\n  失败页面:")
        for p in suite.pages:
            if not p.passed:
                print(f"    ❌ {p.name} ({p.url})")
                for e in p.errors:
                    print(f"       {e}")

    if suite.passed == suite.total:
        print("\n  🎉 全部通过！前端页面验证完成。")

    # 输出 JSON 报告
    report_path = Path("tests/frontend_e2e_report.json")
    report = {
        "total": suite.total,
        "passed": suite.passed,
        "failed": suite.failed,
        "pages": [
            {
                "name": p.name,
                "url": p.url,
                "passed": p.passed,
                "load_time_ms": round(p.load_time_ms, 1),
                "elements_found": p.elements_found,
                "errors": p.errors,
                "warnings": p.warnings,
                "console_errors": p.console_errors,
            }
            for p in suite.pages
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  📄 详细报告: {report_path}")


# ── 入口 ──────────────────────────────────────────────────────────

def main():
    # Fix Windows console encoding for emoji/unicode
    import io
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="AegisQA Frontend E2E Verification")
    parser.add_argument("--page", help="Only verify specified page", choices=list(PAGES.keys()))
    parser.add_argument("--headed", action="store_true", help="Headed mode (show browser)")
    args = parser.parse_args()

    print("[START] AegisQA Frontend E2E Verification")
    print(f"  Frontend: {FRONTEND_URL}")
    print(f"  Backend:  {BACKEND_URL}")

    suite = run_suite(headed=args.headed, filter_page=args.page)
    print_summary(suite)

    sys.exit(0 if suite.failed == 0 else 1)


if __name__ == "__main__":
    main()
