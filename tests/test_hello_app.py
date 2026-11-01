"""Hello 服务 App 测试（按 id 定位，当前在 apps/work/系统/hello）：契约与行为。

验证「App 运行即在后台开端口」的模式：
- 元数据符合 App 规范（manifest.json 字段）
- core.run() 在进程内启动 HTTP 服务线程
- 端口可访问、健康检查返回正常
"""
import json
import time
import unittest
import urllib.request
from pathlib import Path

APPS_ROOT = Path(__file__).resolve().parents[1] / "apps"


def _find_by_id(root: Path, app_id: str, fallback: str) -> Path:
    """按 manifest 的 id 定位 App 目录（App 会被搬进分类，不要写死路径）。"""
    for mf in root.glob("**/manifest.json"):
        try:
            if json.loads(mf.read_text(encoding="utf-8")).get("id") == app_id:
                return mf.parent
        except (OSError, ValueError):
            continue
    return root / fallback


HELLO_DIR = _find_by_id(APPS_ROOT, "hello.service", "work/hello")
BASE = "http://127.0.0.1:8787"


class HelloAppContractTest(unittest.TestCase):
    """契约：目录形态与元数据。"""

    def test_files_exist(self):
        self.assertTrue((HELLO_DIR / "manifest.json").is_file())
        self.assertTrue((HELLO_DIR / "core.py").is_file())
        self.assertTrue((HELLO_DIR / "icon.svg").is_file())
        self.assertTrue((HELLO_DIR / "ui" / "index.html").is_file())

    def test_manifest_fields(self):
        meta = json.loads((HELLO_DIR / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["name"], "Hello")
        self.assertEqual(meta["entry"], "core.py")
        self.assertTrue(meta["description"])

    def test_no_stop_button_in_ui(self):
        """App 界面不应包含停止按钮——生命周期由中枢后台管理。"""
        html = (HELLO_DIR / "ui" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("停止", html)
        self.assertNotIn("/stop", html)


class HelloAppRuntimeTest(unittest.TestCase):
    """行为：core.run() 启动 HTTP 服务，端口可访问。"""

    def setUp(self):
        import importlib.util
        import sys
        spec = importlib.util.spec_from_file_location(
            "hello_core", HELLO_DIR / "core.py")
        self.core = importlib.util.module_from_spec(spec)
        sys.modules["hello_core"] = self.core
        spec.loader.exec_module(self.core)

    def tearDown(self):
        self.core.stop_server()

    def test_run_starts_server(self):
        r = self.core.run({})
        self.assertTrue(r["ok"], r.get("error", ""))
        self.assertTrue(r["running"])
        self.assertEqual(r["port"], 8787)

    def test_health_endpoint(self):
        self.core.run({})
        with urllib.request.urlopen(BASE + "/health", timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        self.assertTrue(data["ok"])
        self.assertEqual(data["service"], "Hello")

    def test_index_page(self):
        self.core.run({})
        with urllib.request.urlopen(BASE + "/", timeout=3) as resp:
            page = resp.read().decode("utf-8")
        self.assertIn("Hello", page)

    def test_idempotent_run(self):
        """重复 run() 不应报错（已运行则直接返回状态）。"""
        self.core.run({})
        r = self.core.run({})
        self.assertTrue(r["ok"])


def _health_ok() -> bool:
    try:
        with urllib.request.urlopen(BASE + "/health", timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


class HelloAppFrameworkTeardownTest(unittest.TestCase):
    """框架级生命周期：实例终止 → teardown() → 端口必须释放。"""

    APP_ID = "hello.service"

    def setUp(self):
        from system.apphost.apps import _MODULE_CACHE, teardown_app
        teardown_app(self.APP_ID)
        _MODULE_CACHE.pop(self.APP_ID, None)

    def tearDown(self):
        from system.apphost.apps import teardown_app
        teardown_app(self.APP_ID)

    def test_terminate_releases_http_port(self):
        from system.apphost.apps import call_app, teardown_app

        r = call_app(self.APP_ID)
        self.assertTrue(r.get("ok"), r.get("error", ""))
        self.assertTrue(_health_ok(), "run 后端口应可访问")

        t = teardown_app(self.APP_ID)
        self.assertTrue(t["ok"])
        self.assertTrue(t["teardown"], "Hello 应提供 teardown 钩子")

        # 等服务循环真正退出
        for _ in range(25):
            if not _health_ok():
                break
            time.sleep(0.2)
        self.assertFalse(_health_ok(), "终止实例后 8787 必须不再可访问")

    def test_reopen_after_teardown_restarts(self):
        from system.apphost.apps import call_app, teardown_app

        call_app(self.APP_ID)
        self.assertTrue(_health_ok())
        teardown_app(self.APP_ID)
        for _ in range(25):
            if not _health_ok():
                break
            time.sleep(0.2)
        self.assertFalse(_health_ok())

        # 重新打开 = 全新模块实例，端口应能再次起来
        r = call_app(self.APP_ID)
        self.assertTrue(r.get("ok"), r.get("error", ""))
        self.assertTrue(_health_ok())


if __name__ == "__main__":
    unittest.main()
