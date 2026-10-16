"""依赖方向守卫（V3.0.0 · P2）。

规则（见 docs/1-开发流程.md「开发习惯」导入约定）：

    system/ → shared/ ← apps/ services/
    system/ → data/   ← apps/ services/

- `apps/` 与 `services/` **不得** `import system.*`（唯一「例外」是文件通道与桥——那是消息，不是 import）；
- `shared/` 与 `data/` 是中立层，**不得**反向依赖 `system/`。

用 AST 静态扫描，不做运行时导入。
"""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SYSTEM_MODULES = ("system",)


def _iter_py(root: Path):
    if not root.is_dir():
        return
    for p in sorted(root.rglob("*.py")):
        if "__pycache__" in p.parts:
            continue
        yield p


def _imports(path: Path):
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError, OSError):
        return set()
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mods.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.level == 0:   # 只看绝对导入
                mods.add(node.module)
    return mods


def _violations(base: str):
    out = []
    for p in _iter_py(ROOT / base):
        for m in _imports(p):
            if any(m == s or m.startswith(s + ".") for s in SYSTEM_MODULES):
                out.append(f"{p.relative_to(ROOT).as_posix()} -> {m}")
    return out


class DependencyDirectionTest(unittest.TestCase):

    def test_apps_do_not_import_system(self):
        self.assertEqual(_violations("apps"), [],
                         "apps/ 不得 import system.*（App 只经桥与文件通道与框架通信）")

    def test_services_do_not_import_system(self):
        self.assertEqual(_violations("services"), [],
                         "services/ 不得 import system.*（服务必须能脱离中枢独立运行）")

    def test_shared_does_not_import_system(self):
        self.assertEqual(_violations("shared"), [],
                         "shared/ 是中立层，不得反向依赖 system/")

    def test_guard_actually_detects_violation(self):
        """守卫自身的自检：构造一个违规源码，确认扫描器能抓到。"""
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "bad.py"
            f.write_text("from system.kernel import api\n", encoding="utf-8")
            mods = _imports(f)
            self.assertIn("system.kernel", mods)


if __name__ == "__main__":
    unittest.main()
