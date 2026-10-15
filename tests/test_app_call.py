"""App 互调测试（V3.0.0 · P3：按 id 运行时解析，替代写死模块路径的 import 直调）。

用真实 App（demo.hello）验证；不写临时 App，避免污染 apps/。
"""
import unittest

from system.apphost.apps import APPS_ROOT, call_app


class CallAppTest(unittest.TestCase):

    def test_calls_another_app_by_id(self):
        r = call_app("demo.hello", "hello", {})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["app"], "demo.hello")
        self.assertIn("来自 core.run", r.get("message", ""))

    def test_unknown_app_returns_error(self):
        r = call_app("no.such.app", "x", {})
        self.assertFalse(r["ok"])
        self.assertIn("未找到 App", r["error"])

    def test_folder_is_not_callable(self):
        """分类 / 文件夹不是 App，不能调用（按 id 解析只认 App 节点）。"""
        r = call_app("班级管理", "x", {})
        self.assertFalse(r["ok"])
        self.assertIn("未找到 App", r["error"])

    def test_depth_guard(self):
        r = call_app("demo.hello", "x", {}, _depth=99)
        self.assertFalse(r["ok"])
        self.assertIn("层级过深", r["error"])

    def test_resolves_by_id_regardless_of_path(self):
        """搬移 / 改名不改 id 也能找到——这正是「按 id 解析」的含义。"""
        # demo.hello 位于 apps/work/demo_hello，id 与目录名并不相同
        r = call_app("demo.hello", "hello", {})
        self.assertTrue(r["ok"], r)
        self.assertTrue((APPS_ROOT / "work" / "demo_hello").is_dir())


if __name__ == "__main__":
    unittest.main()
