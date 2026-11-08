#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run_all_checks.py —— 脉络 1.0 的门禁入口（A50-1 / A50-3 / A50-4 / G-1 / G-5）。

用法：
  python run_all_checks.py            # 全量：单测 + 类型检查 + 样式一致 + 集成链路 + 只读 + 旧路径 + 构建确定性
  python run_all_checks.py --quick    # 跳过耗时的构建确定性（其余照跑）；SKIP 会写原因
  python run_all_checks.py --self-test# 反向自审：喂已知失败项，必须真的红并点名（不跑真实套件、不写产物）

输出格式（与根 `tools/ready.py` 兼容，只有顶级项行顶格）：
  PASS | <名称> | exit=<码>
  FAIL | <名称> | exit=<码>   （随后缩进打印子进程输出末尾）
  SKIP | <名称> | 原因：<...>
  smoke: PASS n / FAIL n / SKIP n
退出码：0 = 全绿；1 = 有 FAIL（跳过不算通过）。
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
PLUGIN = PROJECT / "plugin"
WS = HERE.parents[2]

TIMEOUT = 900
QUICK = "--quick" in sys.argv
SELF_TEST = "--self-test" in sys.argv


def node_bin() -> str:
    """优先用 DSH 运行时同级的 node，其次 PATH；都没有返回空串（明确失败，不静默降级）。"""
    exe = "node.exe" if os.name == "nt" else "node"
    candidate = Path(sys.executable).parent.parent / "node" / "bin" / exe
    if candidate.is_file():
        return str(candidate)
    return shutil.which("node") or ""


NODE = node_bin()


def pnpm_argv() -> list[str] | None:
    """pnpm 入口：优先用与 python/node 同级的 pnpm.cjs（ready.py 的运行环境），其次 PATH。"""
    candidate = Path(sys.executable).parent.parent / "pnpm" / "bin" / "pnpm.cjs"
    if NODE and candidate.is_file():
        return [NODE, str(candidate)]
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        return None
    if os.name == "nt":
        return [os.environ.get("COMSPEC", "cmd.exe"), "/c", pnpm]
    return [pnpm]


PNPM = pnpm_argv()


def indent(text: str, limit: int = 1200) -> str:
    """子进程输出缩进打印：避免其中的 PASS/FAIL 行被 ready.py 二次计数。"""
    body = (text or "").strip()
    if not body:
        return "    （无输出）"
    lines = body[-limit:].splitlines()
    return "\n".join("    " + line for line in lines)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


class Report:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.failures: list[tuple[str, str]] = []

    def emit(self, status: str, name: str, code: str, detail: str = "") -> None:
        print("%s | %s | exit=%s" % (status, name, code))
        if status == "FAIL":
            self.failed += 1
            self.failures.append((name, detail))
        else:
            self.passed += 1

    def skip(self, name: str, reason: str) -> None:
        # ready.py 从 `SKIP | 名称 | 原因：...` 的第三段读原因；写不出原因 = 不算通过。
        print("SKIP | %s | 原因：%s" % (name, reason))
        self.skipped += 1


def run_item(report: Report, name: str, argv: list[str] | None, cwd: Path = PLUGIN) -> None:
    if argv is None or not argv:
        report.emit("FAIL", name, "1", "缺少可执行入口（node/pnpm 未找到）")
        return
    try:
        result = subprocess.run(
            argv,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TIMEOUT,
        )
    except FileNotFoundError as error:
        report.emit("FAIL", name, "1", "命令不存在：%s" % error)
        return
    except subprocess.TimeoutExpired:
        report.emit("FAIL", name, "1", "超时（>%ds）" % TIMEOUT)
        return
    output = (result.stdout or "") + (result.stderr or "")
    report.emit("PASS" if result.returncode == 0 else "FAIL", name, str(result.returncode), output)


def build_determinism(report: Report, name: str) -> None:
    """构建两次并逐字节比对（A60-1 的简化版；完整版本由 T12 的发布门禁负责）。"""
    if PNPM is None:
        report.emit("FAIL", name, "1", "pnpm 未找到")
        return
    checkout = PLUGIN / "lib"
    pairs = [checkout / "index.js", checkout / "client.js"]
    hashes: list[list[str]] = []
    for _round in range(2):
        result = subprocess.run(
            PNPM + ["run", "build"],
            cwd=str(PLUGIN),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TIMEOUT,
        )
        if result.returncode != 0:
            report.emit("FAIL", name, str(result.returncode), (result.stdout or "") + (result.stderr or ""))
            return
        if not all(path.is_file() for path in pairs):
            report.emit("FAIL", name, "1", "构建成功但缺少产物：" + ", ".join(str(path) for path in pairs))
            return
        hashes.append([sha256(path) for path in pairs])
        print("BUILD | round %d | %s" % (len(hashes), " ".join("%s=%s" % (path.name, sha[:12]) for path, sha in zip(pairs, hashes[-1]))))
    if hashes[0] != hashes[1]:
        report.emit("FAIL", name, "1", "两次构建产物不一致：%s vs %s" % (hashes[0], hashes[1]))
        return
    report.emit("PASS", name, "0", "")


def main() -> int:
    if SELF_TEST:
        return self_test()

    report = Report()
    print("INFO | workspace=%s" % WS.as_posix())
    print("INFO | plugin=%s" % PLUGIN.as_posix())
    print("INFO | node=%s" % (NODE or "(missing)"))
    print("INFO | pnpm=%s" % ("(bundled)" if PNPM is not None else "(missing)"))

    run_item(report, "插件单测（pnpm run test）", (PNPM + ["run", "test"]) if PNPM else None)
    run_item(report, "类型检查（pnpm run typecheck）", (PNPM + ["run", "typecheck"]) if PNPM else None)
    run_item(
        report,
        "样式产物一致（emit-styles --check）",
        [NODE, "tests/harness/emit-styles.mjs", "--check"] if NODE else None,
    )
    run_item(
        report,
        "集成链路（tests/integration）",
        [NODE, "--test", "tests/integration/*.test.ts"] if NODE else None,
    )
    run_item(report, "只读证明（G-1）", [sys.executable, str(HERE / "readonly_check.py")])
    run_item(report, "旧路径归零（G-5）", [sys.executable, str(HERE / "legacy_zero.py")])
    if QUICK:
        report.skip("构建确定性（build ×2 + sha256）", "--quick 跳过耗时项（全量运行会跑）")
    else:
        build_determinism(report, "构建确定性（build ×2 + sha256）")

    print("smoke: PASS %d / FAIL %d / SKIP %d%s" % (report.passed, report.failed, report.skipped, "（quick）" if QUICK else ""))
    for name, detail in report.failures:
        print("-" * 60)
        print("FAIL-DETAIL | " + name)
        print(indent(detail))
    return 1 if report.failed else 0


def self_test() -> int:
    """反向自审：已知失败项必须 FAIL 且汇总退出码为 1；已知通过项必须 PASS。"""
    failures = 0
    report = Report()
    os_ok = [sys.executable, "-c", "raise SystemExit(0)"]
    os_bad = [sys.executable, "-c", "raise SystemExit(3)"]
    missing = [str(HERE / "__definitely_missing__.py")]
    run_item(report, "自审-应当通过", os_ok)
    run_item(report, "自审-应当失败", os_bad)
    run_item(report, "自审-命令不存在", missing)
    report.skip("自审-跳过项", "自审用的显式跳过项")
    print("SELFTEST | 计数 PASS=%d FAIL=%d SKIP=%d" % (report.passed, report.failed, report.skipped))
    if report.passed != 1 or report.failed != 2 or report.skipped != 1:
        print("SELFTEST-FAIL | 计数不对（期望 1/2/1）")
        failures += 1
    if [name for name, _detail in report.failures] != ["自审-应当失败", "自审-命令不存在"]:
        print("SELFTEST-FAIL | 失败项点名不对：%s" % [name for name, _detail in report.failures])
        failures += 1
    exit_code = 1 if report.failed else 0
    if exit_code != 1:
        print("SELFTEST-FAIL | 有失败项时退出码不是 1")
        failures += 1
    print("SELFTEST: " + ("PASS" if failures == 0 else "FAIL (%d 项)" % failures))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
