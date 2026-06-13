"""AegisQA CLI 工具。

命令行操作 AegisQA 平台。

使用方式：
    aegisqa skill list
    aegisqa skill export <skill-id> -o <path>
    aegisqa skill upload <zip-path>
    aegisqa task list
    aegisqa task create --name <name> --dataset <id> --workflow <id>
    aegisqa workflow list
    aegisqa report <task-id>
    aegisqa health
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .client import AegisQA


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。"""
    parser = argparse.ArgumentParser(
        prog="aegisqa",
        description="AegisQA AI 评测治理平台 CLI",
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="API 地址 (默认: http://localhost:8000)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="API Key (可选)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="输出 JSON 格式",
    )

    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # health 命令
    subparsers.add_parser("health", help="检查服务健康状态")

    # dashboard 命令
    subparsers.add_parser("dashboard", help="查看 Dashboard 摘要")

    # skill 命令
    skill_parser = subparsers.add_parser("skill", help="Skill 管理")
    skill_sub = skill_parser.add_subparsers(dest="skill_command")

    # skill list
    skill_sub.add_parser("list", help="列出所有 Skill")

    # skill packages
    skill_sub.add_parser("packages", help="列出 Skill 包")

    # skill export
    skill_export = skill_sub.add_parser("export", help="导出 Skill 包")
    skill_export.add_argument("skill_id", help="Skill ID")
    skill_export.add_argument("-o", "--output", help="输出文件路径")
    skill_export.add_argument("--include-tests", action="store_true", help="包含测试用例")
    skill_export.add_argument("--include-history", action="store_true", help="包含版本历史")

    # skill import
    skill_import = skill_sub.add_parser("import", help="导入 Skill 包")
    skill_import.add_argument("zip_path", help="zip 文件路径")

    # skill test
    skill_test = skill_sub.add_parser("test", help="运行合约测试")
    skill_test.add_argument("skill_id", help="Skill ID")

    # skill approve
    skill_approve = skill_sub.add_parser("approve", help="审批 Skill")
    skill_approve.add_argument("skill_id", help="Skill ID")
    skill_approve.add_argument("--reason", default="", help="审批原因")

    # task 命令
    task_parser = subparsers.add_parser("task", help="任务管理")
    task_sub = task_parser.add_subparsers(dest="task_command")

    # task list
    task_list = task_sub.add_parser("list", help="列出任务")
    task_list.add_argument("--page", type=int, default=1, help="页码")
    task_list.add_argument("--page-size", type=int, default=20, help="每页数量")
    task_list.add_argument("--status", help="状态筛选")

    # task get
    task_get = task_sub.add_parser("get", help="获取任务详情")
    task_get.add_argument("task_id", help="任务 ID")

    # task create
    task_create = task_sub.add_parser("create", help="创建任务")
    task_create.add_argument("--name", required=True, help="任务名称")
    task_create.add_argument("--dataset", required=True, help="数据集 ID")
    task_create.add_argument("--dataset-version", type=int, required=True, help="数据集版本")
    task_create.add_argument("--workflow", required=True, help="Workflow 版本 ID")

    # task diagnostics
    task_diag = task_sub.add_parser("diagnostics", help="获取任务诊断")
    task_diag.add_argument("task_id", help="任务 ID")

    # workflow 命令
    wf_parser = subparsers.add_parser("workflow", help="Workflow 管理")
    wf_sub = wf_parser.add_subparsers(dest="workflow_command")

    # workflow list
    wf_sub.add_parser("list", help="列出 Workflow")

    # workflow templates
    wf_sub.add_parser("templates", help="列出模板")

    # workflow drafts
    wf_sub.add_parser("drafts", help="列出草稿")

    # dataset 命令
    ds_parser = subparsers.add_parser("dataset", help="数据集管理")
    ds_sub = ds_parser.add_subparsers(dest="dataset_command")

    # dataset list
    ds_sub.add_parser("list", help="列出数据集")

    # run 命令
    run_parser = subparsers.add_parser("run", help="执行记录管理")
    run_sub = run_parser.add_subparsers(dest="run_command")

    # run list
    run_list = run_sub.add_parser("list", help="列出执行记录")
    run_list.add_argument("--page", type=int, default=1, help="页码")
    run_list.add_argument("--page-size", type=int, default=20, help="每页数量")

    # run get
    run_get = run_sub.add_parser("get", help="获取执行记录详情")
    run_get.add_argument("run_id", help="执行 ID")

    # report 命令
    report_parser = subparsers.add_parser("report", help="查看报告")
    report_parser.add_argument("task_id", help="任务 ID")

    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 0

    client = AegisQA(
        base_url=args.base_url,
        api_key=args.api_key,
    )

    try:
        return _dispatch(client, args)
    except Exception as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    finally:
        client.close()


def _dispatch(client: AegisQA, args: argparse.Namespace) -> int:
    """分发命令。"""
    command = args.command

    if command == "health":
        result = client.health()
        _output(result, args.json)
        return 0

    if command == "dashboard":
        result = client.dashboard()
        _output(result, args.json)
        return 0

    if command == "skill":
        return _skill_command(client, args)

    if command == "task":
        return _task_command(client, args)

    if command == "workflow":
        return _workflow_command(client, args)

    if command == "dataset":
        return _dataset_command(client, args)

    if command == "run":
        return _run_command(client, args)

    if command == "report":
        result = client.reports.task_report(args.task_id)
        _output(result, args.json)
        return 0

    return 0


def _skill_command(client: AegisQA, args: argparse.Namespace) -> int:
    """Skill 命令处理。"""
    if args.skill_command == "list":
        skills = client.skills.list()
        if args.json:
            _output(skills, True)
        else:
            print(f"共 {len(skills)} 个 Skill：")
            for skill in skills:
                status = "✓" if skill.get("enabled") else "✗"
                print(f"  {status} {skill['skill_id']}: {skill.get('name', '')}")
        return 0

    if args.skill_command == "packages":
        packages = client.skills.packages()
        if args.json:
            _output(packages, True)
        else:
            print(f"共 {len(packages)} 个 Skill 包：")
            for pkg in packages:
                print(f"  {pkg.get('package_id', '')}: {pkg.get('filename', '')} [{pkg.get('status', '')}]")
        return 0

    if args.skill_command == "export":
        output_path = args.output or f"{args.skill_id.replace('@', '_v').replace('.', '_')}.zip"
        result = client.skills.export_to_file(
            args.skill_id,
            output_path,
            include_tests=args.include_tests,
            include_history=args.include_history,
        )
        print(f"已导出到：{result}")
        return 0

    if args.skill_command == "import":
        result = client.skills.import_package(args.zip_path)
        if args.json:
            _output(result, True)
        else:
            print(f"导入成功：{result.get('skill_id', '')}")
            if result.get("warnings"):
                print("警告：")
                for w in result["warnings"]:
                    print(f"  - {w}")
        return 0

    if args.skill_command == "test":
        result = client.skills.contract_test(args.skill_id)
        if args.json:
            _output(result, True)
        else:
            status = "通过" if result.get("ok") else "失败"
            print(f"合约测试：{status}")
            if result.get("errors"):
                for err in result["errors"]:
                    print(f"  - {err}")
        return 0

    if args.skill_command == "approve":
        result = client.skills.approve(args.skill_id, args.reason)
        print(f"已审批：{result.get('skill_id', '')}")
        return 0

    return 0


def _task_command(client: AegisQA, args: argparse.Namespace) -> int:
    """任务命令处理。"""
    if args.task_command == "list":
        result = client.tasks.list(page=args.page, page_size=args.page_size, status=args.status)
        if args.json:
            _output(result, True)
        else:
            items = result.get("items", [])
            pagination = result.get("pagination", {})
            print(f"共 {pagination.get('total_items', 0)} 个任务（第 {pagination.get('page', 1)} 页）：")
            for task in items:
                print(f"  [{task.get('status', '')}] {task.get('task_id', '')}: {task.get('name', '')}")
        return 0

    if args.task_command == "get":
        result = client.tasks.get(args.task_id)
        _output(result, args.json)
        return 0

    if args.task_command == "create":
        result = client.tasks.create(
            name=args.name,
            dataset_id=args.dataset,
            dataset_version=args.dataset_version,
            workflow_version_id=args.workflow,
        )
        if args.json:
            _output(result, True)
        else:
            print(f"任务已创建：{result.get('task_id', '')}")
        return 0

    if args.task_command == "diagnostics":
        result = client.tasks.diagnostics(args.task_id)
        _output(result, args.json)
        return 0

    return 0


def _workflow_command(client: AegisQA, args: argparse.Namespace) -> int:
    """Workflow 命令处理。"""
    if args.workflow_command == "list":
        workflows = client.workflows.list()
        if args.json:
            _output(workflows, True)
        else:
            print(f"共 {len(workflows)} 个 Workflow：")
            for wf in workflows:
                print(f"  {wf.get('version_id', '')}: {wf.get('name', '')} v{wf.get('version', '')}")
        return 0

    if args.workflow_command == "templates":
        templates = client.workflows.templates()
        if args.json:
            _output(templates, True)
        else:
            print(f"共 {len(templates)} 个模板：")
            for tpl in templates:
                print(f"  {tpl.get('template_id', '')}: {tpl.get('name', '')}")
        return 0

    if args.workflow_command == "drafts":
        drafts = client.workflows.drafts()
        if args.json:
            _output(drafts, True)
        else:
            print(f"共 {len(drafts)} 个草稿：")
            for draft in drafts:
                print(f"  {draft.get('draft_id', '')}: {draft.get('name', '')}")
        return 0

    return 0


def _dataset_command(client: AegisQA, args: argparse.Namespace) -> int:
    """数据集命令处理。"""
    if args.dataset_command == "list":
        datasets = client.datasets.list()
        if args.json:
            _output(datasets, True)
        else:
            print(f"共 {len(datasets)} 个数据集：")
            for ds in datasets:
                print(f"  {ds.get('dataset_id', '')}: {ds.get('name', '')}")
        return 0

    return 0


def _run_command(client: AegisQA, args: argparse.Namespace) -> int:
    """执行记录命令处理。"""
    if args.run_command == "list":
        result = client.runs.list(page=args.page, page_size=args.page_size)
        if args.json:
            _output(result, True)
        else:
            items = result.get("items", [])
            pagination = result.get("pagination", {})
            print(f"共 {pagination.get('total_items', 0)} 条执行记录（第 {pagination.get('page', 1)} 页）：")
            for run in items:
                print(f"  [{run.get('status', '')}] {run.get('run_id', '')}")
        return 0

    if args.run_command == "get":
        result = client.runs.get(args.run_id)
        _output(result, args.json)
        return 0

    return 0


def _output(data: Any, as_json: bool = False) -> None:
    """输出结果。"""
    if as_json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, (dict, list)):
                    print(f"{key}: {json.dumps(value, ensure_ascii=False)}")
                else:
                    print(f"{key}: {value}")
        else:
            print(data)


if __name__ == "__main__":
    sys.exit(main())
