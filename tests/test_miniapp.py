"""miniapp 导入导出测试 —— 全程用临时 root，不碰真实 apps/ 与 shared/。"""
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from system.apphost import apps, app_edit, miniapp


class MiniappTest(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.root = root
        self.apps_root = root / "apps"
        self.shared_root = root / "shared"
        self.pylibs_root = root / "pylibs"
        self.apps_root.mkdir()
        self.shared_root.mkdir()
        # 注入 root：_node_dir 走 apps.APPS_ROOT；_safe_under_apps 走 app_edit.APPS_ROOT；
        # 导入落位走 miniapp.APPS_ROOT / miniapp.SHARED_ROOT
        self._old = (apps.APPS_ROOT, app_edit.APPS_ROOT, miniapp.APPS_ROOT,
                     miniapp.SHARED_ROOT, miniapp.PYLIBS_DIR)
        apps.APPS_ROOT = self.apps_root
        app_edit.APPS_ROOT = self.apps_root
        miniapp.APPS_ROOT = self.apps_root
        miniapp.SHARED_ROOT = self.shared_root
        miniapp.PYLIBS_DIR = self.pylibs_root

    def tearDown(self):
        (apps.APPS_ROOT, app_edit.APPS_ROOT, miniapp.APPS_ROOT,
         miniapp.SHARED_ROOT, miniapp.PYLIBS_DIR) = self._old
        self._tmp.cleanup()

    def _mk_app(self, rel="work/tapp", app_id="t.mini", requires=None):
        d = self.apps_root / rel
        (d / "ui").mkdir(parents=True)
        meta = {"name": "测试包", "id": app_id, "version": "0.1.0", "type": "logic"}
        if requires is not None:
            meta["requires"] = requires
        (d / "manifest.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        (d / "core.py").write_text('APP_ID = "%s"\n\ndef run(payload):\n    return {"ok": True}\n' % app_id,
                                   encoding="utf-8")
        (d / "ui" / "index.html").write_text("<h1>t</h1>", encoding="utf-8")
        return d

    def _mk_shared(self, mod="Mmod"):
        d = self.shared_root / mod
        d.mkdir(parents=True)
        (d / "__init__.py").write_text("X = 1\n", encoding="utf-8")
        return d

    def test_export_basic(self):
        self._mk_app()
        out = self.root / "out" / "tapp.miniapp"
        r = miniapp.export_miniapp("t.mini", str(out))
        self.assertTrue(r["ok"], r)
        self.assertTrue(out.is_file())
        with zipfile.ZipFile(out) as zf:
            names = set(zf.namelist())
            self.assertIn("tapp/manifest.json", names)
            self.assertIn("tapp/core.py", names)
            self.assertIn("__pkg__/pkg.json", names)
            meta = json.loads(zf.read("__pkg__/pkg.json").decode("utf-8"))
            self.assertEqual(meta["app_dir"], "tapp")

    def test_export_packs_shared_skips_db(self):
        self._mk_app(requires={"shared": ["Mmod"], "py": []})
        self._mk_shared()
        (self.shared_root / "Mmod" / "data").mkdir()
        (self.shared_root / "Mmod" / "data" / "x.db").write_text("x", encoding="utf-8")
        out = self.root / "out" / "t.miniapp"
        r = miniapp.export_miniapp("t.mini", str(out))
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["shared"], ["Mmod"])
        with zipfile.ZipFile(out) as zf:
            names = set(zf.namelist())
            self.assertIn("__pkg__/shared/Mmod/__init__.py", names)
            self.assertFalse(any("x.db" in n for n in names), names)  # 数据库绝不进包

    def test_export_pylib_stdlib_skipped_and_missing_to_pip(self):
        self._mk_app(requires={"shared": [], "py": ["json", "no.such.pkg"]})
        out = self.root / "out" / "t.miniapp"
        r = miniapp.export_miniapp("t.mini", str(out))
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["pip_required"], ["no.such.pkg"])  # 标准库跳过，找不到的进 pip 清单

    def test_import_roundtrip(self):
        self._mk_app()
        out = self.root / "out" / "t.miniapp"
        self.assertTrue(miniapp.export_miniapp("t.mini", str(out))["ok"])
        # 换个目录名导入（模拟另一台机器）
        (self.apps_root / "work" / "tapp").rename(self.root / "moved_away")
        r = miniapp.import_miniapp(str(out), "work")
        self.assertTrue(r["ok"], r)
        self.assertTrue((self.apps_root / "work" / "tapp" / "manifest.json").is_file())

    def test_import_conflict_then_overwrite(self):
        self._mk_app()
        out = self.root / "out" / "t.miniapp"
        self.assertTrue(miniapp.export_miniapp("t.mini", str(out))["ok"])
        r = miniapp.import_miniapp(str(out), "work")
        self.assertFalse(r["ok"])
        self.assertEqual(r.get("conflict"), "app_exists")
        r2 = miniapp.import_miniapp(str(out), "work", "overwrite")
        self.assertTrue(r2["ok"], r2)

    def test_import_rejects_bad_zip(self):
        (self.apps_root / "work").mkdir(exist_ok=True)
        bad = self.root / "bad.miniapp"
        bad.write_text("not a zip", encoding="utf-8")
        r = miniapp.import_miniapp(str(bad), "work")
        self.assertFalse(r["ok"])
        self.assertIn("无法读取", r["error"])

    def test_import_shared_skips_existing(self):
        self._mk_app(requires={"shared": ["Mmod"], "py": []})
        self._mk_shared()
        out = self.root / "out" / "t.miniapp"
        self.assertTrue(miniapp.export_miniapp("t.mini", str(out))["ok"])
        # 模拟换机导入：原 App 移走，本地 shared 保留（内容不同）
        (self.apps_root / "work" / "tapp").rename(self.root / "moved_away")
        (self.shared_root / "Mmod" / "__init__.py").write_text("X = 2\n", encoding="utf-8")
        r = miniapp.import_miniapp(str(out), "work")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["shared_skipped"], ["Mmod"])
        self.assertEqual((self.shared_root / "Mmod" / "__init__.py").read_text(encoding="utf-8"), "X = 2\n")


if __name__ == "__main__":
    unittest.main()
