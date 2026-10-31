"""图标预设测试（system/apphost/icon_presets.py）。

与 test_app_edit 一致：把 APPS_ROOT 与 PRESETS_DIR 都指到临时目录，不碰真实 apps/ 与 data/。
"""
import json
import tempfile
import unittest
from pathlib import Path

from system.apphost import app_edit, apps, icon_presets

_SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        '<rect x="4" y="4" width="56" height="56" rx="14" fill="#123456"/></svg>')


class _Api(icon_presets.IconPresetMixin, app_edit.AppEditMixin):
    """测试用的最小组合：图标预设 + App 编辑（apply 需要 set_app_meta / set_folder_meta）。"""
    pass


def _mk_app(root: Path, rel: str, app_id: str, name: str) -> Path:
    d = root / rel
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(
        json.dumps({"name": name, "id": app_id}, ensure_ascii=False), encoding="utf-8")
    return d


class IconPresetTest(unittest.TestCase):

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        base = Path(tmp.name)
        self.root = base / "apps"
        self.root.mkdir()
        self._old_apps_root = app_edit.APPS_ROOT
        self._old_apps = apps.APPS_ROOT
        self._old_presets = icon_presets.PRESETS_DIR
        app_edit.APPS_ROOT = self.root
        apps.APPS_ROOT = self.root
        icon_presets.PRESETS_DIR = base / "icon_presets"
        _mk_app(self.root, "work/alpha", "a.alpha", "甲")
        zd = self.root / "work" / "分类"
        zd.mkdir()

    def tearDown(self):
        app_edit.APPS_ROOT = self._old_apps_root
        apps.APPS_ROOT = self._old_apps
        icon_presets.PRESETS_DIR = self._old_presets

    def test_builtin_presets_are_svg_data_uris(self):
        r = _Api().list_icon_presets()
        self.assertTrue(r["ok"], r)
        self.assertGreaterEqual(len(r["presets"]), 6)
        for p in r["presets"]:
            self.assertTrue(p["builtin"])
            self.assertTrue(p["data_uri"].startswith("data:image/svg+xml;base64,"))

    def test_save_and_delete_user_preset(self):
        m = _Api()
        r = m.save_icon_preset("我的图标", _SVG)
        self.assertTrue(r["ok"], r)
        pid = r["preset"]["id"]
        self.assertIn(pid, [p["id"] for p in m.list_icon_presets()["presets"]])
        self.assertTrue(m.delete_icon_preset(pid)["ok"])
        self.assertNotIn(pid, [p["id"] for p in m.list_icon_presets()["presets"]])

    def test_builtin_preset_cannot_be_deleted(self):
        r = _Api().delete_icon_preset("builtin.grid")
        self.assertFalse(r["ok"])

    def test_save_rejects_non_svg(self):
        r = _Api().save_icon_preset("坏的", "not an svg")
        self.assertFalse(r["ok"])

    def test_apply_preset_to_app(self):
        m = _Api()
        r = m.apply_icon_preset("app", "a.alpha", "builtin.grid")
        self.assertTrue(r["ok"], r)
        d = self.root / "work" / "alpha"
        self.assertTrue((d / "icon.svg").is_file())
        meta = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["icon"], "icon.svg")

    def test_apply_preset_to_folder(self):
        m = _Api()
        r = m.apply_icon_preset("folder", "work/分类", "builtin.folder")
        self.assertTrue(r["ok"], r)
        d = self.root / "work" / "分类"
        self.assertTrue((d / "icon.svg").is_file())
        info = json.loads((d / "folder.json").read_text(encoding="utf-8"))
        self.assertEqual(info["icon"], "icon.svg")

    def test_apply_unknown_preset_or_kind_rejected(self):
        m = _Api()
        self.assertFalse(m.apply_icon_preset("app", "a.alpha", "nope")["ok"])
        self.assertFalse(m.apply_icon_preset("bad", "a.alpha", "builtin.grid")["ok"])


if __name__ == "__main__":
    unittest.main()

