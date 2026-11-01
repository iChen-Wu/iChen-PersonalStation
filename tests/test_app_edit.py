"""App 编辑测试（system/apphost/app_edit.py，V3.0.0 · P4 基础批）。

**不碰真实 apps/**：把 APPS_ROOT 指向临时目录后再调编辑方法。
"""
import json
import tempfile
import unittest
from pathlib import Path

from system.apphost import app_edit, apps


def _mk_app(root: Path, rel: str, app_id: str, name: str, order=None) -> Path:
    d = root / rel
    d.mkdir(parents=True, exist_ok=True)
    meta = {"name": name, "id": app_id}
    if order is not None:
        meta["order"] = order
    (d / "manifest.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return d


class AppEditTest(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self._old = app_edit.APPS_ROOT
        self._old_apps = apps.APPS_ROOT
        # 两处都要改：app_edit 用于路径校验，apps 用于 find_app_node 的默认 top
        app_edit.APPS_ROOT = self.root
        apps.APPS_ROOT = self.root
        (self.root / "work").mkdir()
        _mk_app(self.root, "work/alpha", "a.alpha", "甲")
        _mk_app(self.root, "work/beta", "b.beta", "乙")

    def tearDown(self):
        app_edit.APPS_ROOT = self._old
        apps.APPS_ROOT = self._old_apps
        self._tmp.cleanup()

    # ---------- 改名 ----------

    def test_rename_app_updates_manifest_and_folder(self):
        r = app_edit.AppEditMixin().rename_app("a.alpha", "新名字")
        self.assertTrue(r["ok"], r)
        self.assertTrue(r["folder_renamed"])
        self.assertTrue((self.root / "work" / "新名字" / "manifest.json").is_file())
        meta = json.loads((self.root / "work" / "新名字" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["name"], "新名字")

    def test_rename_refuses_when_folder_name_taken(self):
        r = app_edit.AppEditMixin().rename_app("a.alpha", "beta")
        self.assertTrue(r["ok"])            # 显示名改了
        self.assertFalse(r["folder_renamed"])  # 但目录没改（同名已存在）
        self.assertIn("warning", r)

    # ---------- 元数据 ----------

    def test_set_meta_only_allowed_fields_and_numeric_order(self):
        m = app_edit.AppEditMixin()
        r = m.set_app_meta("a.alpha", {"order": "3", "description": "d", "id": "hacked"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["meta"]["order"], 3.0)
        self.assertEqual(r["meta"]["description"], "d")
        self.assertEqual(r["meta"]["id"], "a.alpha")   # id 受保护

    def test_set_meta_rejects_non_numeric_order(self):
        r = app_edit.AppEditMixin().set_app_meta("a.alpha", {"order": "abc"})
        self.assertFalse(r["ok"])

    # ---------- 移动 ----------

    def test_move_app(self):
        (self.root / "space").mkdir()
        r = app_edit.AppEditMixin().move_app("a.alpha", "space")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["path"], "space/alpha")

    def test_move_refuses_into_own_subdir(self):
        r = app_edit.AppEditMixin().move_app("a.alpha", "work/alpha")
        self.assertFalse(r["ok"])

    # ---------- 删除 ----------

    def test_delete_requires_confirm(self):
        m = app_edit.AppEditMixin()
        self.assertFalse(m.delete_app("a.alpha")["ok"])
        self.assertTrue((self.root / "work" / "alpha").is_dir())   # 未被删
        self.assertTrue(m.delete_app("a.alpha", confirm=True)["ok"])
        self.assertFalse((self.root / "work" / "alpha").exists())

    # ---------- 分区 / 分类 ----------

    def test_create_folder_refuses_duplicate(self):
        m = app_edit.AppEditMixin()
        r1 = m.create_folder("work", "分类")
        self.assertTrue(r1["ok"], r1)
        self.assertTrue((self.root / "work" / "分类" / "folder.json").is_file())
        r2 = m.create_folder("work", "分类")
        self.assertFalse(r2["ok"])
        self.assertIn("命名冲突", r2["error"])

    def test_create_folder_rejects_illegal_name(self):
        r = app_edit.AppEditMixin().create_folder("work", "a/b")
        self.assertFalse(r["ok"])
        r2 = app_edit.AppEditMixin().create_folder("work", "CON")
        self.assertFalse(r2["ok"])

    def test_rename_and_delete_folder(self):
        m = app_edit.AppEditMixin()
        m.create_folder("work", "旧名")
        r = m.rename_folder("work/旧名", "新名")
        self.assertTrue(r["ok"], r)
        info = json.loads((self.root / "work" / "新名" / "folder.json").read_text(encoding="utf-8"))
        self.assertEqual(info["name"], "新名")
        self.assertTrue(m.delete_folder("work/新名", confirm=True)["ok"])

    def test_delete_zone_allowed_with_confirm(self):
        """分区（apps/ 一级目录）允许删除（=删除整个 Tab），但需 confirm=True。"""
        r = app_edit.AppEditMixin().delete_folder("work", confirm=True)
        self.assertTrue(r["ok"], r)
        self.assertFalse((self.root / "work").exists())

    def test_delete_zone_keep_apps_rejected(self):
        """分区不能「保留删除」——App 不能放在 apps/ 根目录。"""
        r = app_edit.AppEditMixin().delete_folder_keep_apps("work", confirm=True)
        self.assertFalse(r["ok"], r)
        self.assertTrue((self.root / "work").is_dir())

    def test_cannot_rename_zone_directory(self):
        """分区目录名不能改（key=目录名，且可能被运行中 App 占用）；应改显示名。"""
        r = app_edit.AppEditMixin().rename_folder("work", "工作区2")
        self.assertFalse(r["ok"], r)
        self.assertTrue((self.root / "work").is_dir())
        self.assertFalse((self.root / "工作区2").exists())

    # ---------- 文件夹元数据 / 图标（V3.0.0 · P4 控制台 App 管理） ----------

    def test_set_folder_meta_creates_folder_json_for_plain_dir(self):
        """普通文件夹（无 folder.json）首次编辑元数据时补建。"""
        m = app_edit.AppEditMixin()
        m.create_folder("work", "分类甲")
        r = m.set_folder_meta("work/分类甲", {"description": "测试描述", "order": 3})
        self.assertTrue(r["ok"], r)
        info = json.loads((self.root / "work" / "分类甲" / "folder.json").read_text(encoding="utf-8"))
        self.assertEqual(info["description"], "测试描述")
        self.assertEqual(info["order"], 3.0)

    def test_set_folder_meta_on_zone(self):
        """分区（一级目录）也能改显示名 / 描述（只动 folder.json，不改目录名）。"""
        r = app_edit.AppEditMixin().set_folder_meta("work", {"name": "工作区", "description": "d"})
        self.assertTrue(r["ok"], r)
        info = json.loads((self.root / "work" / "folder.json").read_text(encoding="utf-8"))
        self.assertEqual(info["name"], "工作区")
        self.assertTrue((self.root / "work").is_dir())  # 目录名没变

    def test_set_folder_meta_rejects_empty_name_and_bad_order(self):
        m = app_edit.AppEditMixin()
        self.assertFalse(m.set_folder_meta("work", {"name": "  "})["ok"])
        self.assertFalse(m.set_folder_meta("work", {"order": "abc"})["ok"])

    def test_set_folder_icon_copies_file(self):
        svg = self.root / "src.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>', encoding="utf-8")
        r = app_edit.AppEditMixin().set_folder_icon("work", str(svg))
        self.assertTrue(r["ok"], r)
        self.assertTrue((self.root / "work" / "icon.svg").is_file())
        info = json.loads((self.root / "work" / "folder.json").read_text(encoding="utf-8"))
        self.assertEqual(info["icon"], "icon.svg")

    def test_set_app_icon_copies_file(self):
        svg = self.root / "a.svg"
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>', encoding="utf-8")
        r = app_edit.AppEditMixin().set_app_icon("a.alpha", str(svg))
        self.assertTrue(r["ok"], r)
        self.assertTrue((self.root / "work" / "alpha" / "icon.svg").is_file())

    def test_set_folder_icon_rejects_bad_ext(self):
        f = self.root / "x.txt"
        f.write_text("x", encoding="utf-8")
        r = app_edit.AppEditMixin().set_folder_icon("work", str(f))
        self.assertFalse(r["ok"])

    # ---------- 同层排序（App 与文件夹混合） ----------

    def test_reorder_nodes_writes_order_for_apps_and_folders(self):
        m = app_edit.AppEditMixin()
        m.create_folder("work", "分类乙")
        r = m.reorder_nodes("work", ["work/分类乙", "work/beta", "work/alpha"])
        self.assertTrue(r["ok"], r)
        expect = [("分类乙", "folder.json"), ("beta", "manifest.json"), ("alpha", "manifest.json")]
        for i, (dir_name, meta_name) in enumerate(expect):
            info = json.loads((self.root / "work" / dir_name / meta_name).read_text(encoding="utf-8"))
            self.assertEqual(info["order"], i + 1)

    def test_reorder_nodes_rejects_incomplete_list(self):
        r = app_edit.AppEditMixin().reorder_nodes("work", ["work/alpha"])
        self.assertFalse(r["ok"])
        self.assertIn("不一致", r["error"])

    def test_reorder_nodes_rejects_foreign_node(self):
        (self.root / "space").mkdir()
        _mk_app(self.root, "space/gamma", "g.gamma", "丙")
        r = app_edit.AppEditMixin().reorder_nodes("work", ["space/gamma"])
        self.assertFalse(r["ok"])
        self.assertIn("不在该目录下", r["error"])

    # ---------- 跨级移动（拖出文件夹，move_node） ----------

    def test_move_node_drag_out_with_before_anchor(self):
        """拖出文件夹并落位：移到上一级、插到 before_path 之前；两边目录 order 重写。"""
        m = app_edit.AppEditMixin()
        m.create_folder("work", "分类")
        _mk_app(self.root, "work/分类/inner", "i.inner", "内")
        _mk_app(self.root, "work/分类/inner2", "i.inner2", "内二")
        r = m.move_node("work/分类/inner", "work", "work/beta")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["path"], "work/inner")
        self.assertTrue((self.root / "work" / "inner" / "manifest.json").is_file())
        self.assertFalse((self.root / "work" / "分类" / "inner").exists())
        # 目标目录：插到 beta 之前 → alpha=1 inner=2 beta=3，分类（folder.json）排 4
        expect = [("alpha", "manifest.json", 1), ("inner", "manifest.json", 2),
                  ("beta", "manifest.json", 3), ("分类", "folder.json", 4)]
        for dir_name, meta_name, order in expect:
            info = json.loads((self.root / "work" / dir_name / meta_name).read_text(encoding="utf-8"))
            self.assertEqual(info["order"], order)
        # 源目录剩余成员的 order 也重写为 1
        info = json.loads((self.root / "work" / "分类" / "inner2" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(info["order"], 1)

    def test_move_node_append_to_end_when_no_before(self):
        """before_path=None → 排到目标目录末尾。"""
        m = app_edit.AppEditMixin()
        m.create_folder("work", "分类")
        _mk_app(self.root, "work/分类/inner", "i.inner", "内")
        r = m.move_node("work/分类/inner", "work")
        self.assertTrue(r["ok"], r)
        info = json.loads((self.root / "work" / "inner" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(info["order"], 4)   # alpha beta 分类 之后

    def test_move_node_any_depth(self):
        """任意层级进出：深层拖到一级、一级拖进另一分支深层。"""
        m = app_edit.AppEditMixin()
        m.create_folder("work", "甲类")
        m.create_folder("work/甲类", "乙类")
        _mk_app(self.root, "work/甲类/乙类/inner", "i.inner", "内")
        r = m.move_node("work/甲类/乙类/inner", "work")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["path"], "work/inner")
        m.create_folder("work", "丙类")
        m.create_folder("work/丙类", "丁类")
        r2 = m.move_node("work/inner", "work/丙类/丁类")
        self.assertTrue(r2["ok"], r2)
        self.assertEqual(r2["path"], "work/丙类/丁类/inner")
        self.assertTrue((self.root / "work" / "丙类" / "丁类" / "inner" / "manifest.json").is_file())

    def test_move_node_rejects_same_dir_and_own_subdir(self):
        m = app_edit.AppEditMixin()
        self.assertFalse(m.move_node("work/alpha", "work")["ok"])          # 目标=当前目录
        self.assertFalse(m.move_node("work", "work/alpha")["ok"])          # 移到自己的子目录
        self.assertFalse(m.move_node("work/alpha", "work/alpha")["ok"])

    def test_move_node_rejects_duplicate_name(self):
        m = app_edit.AppEditMixin()
        m.create_folder("work", "分类")
        _mk_app(self.root, "work/分类/alpha", "x.alpha2", "甲二")
        r = m.move_node("work/分类/alpha", "work")                          # 目标已有同名 alpha
        self.assertFalse(r["ok"])
        self.assertIn("同名", r["error"])
        self.assertTrue((self.root / "work" / "分类" / "alpha").is_dir())  # 未动

    def test_move_node_rejects_traversal(self):
        m = app_edit.AppEditMixin()
        self.assertFalse(m.move_node("work/alpha", "../outside")["ok"])
        self.assertFalse(m.move_node("../x", "work")["ok"])

    def test_move_node_rejects_bad_before_anchor(self):
        """before_path 必须在目标目录下。"""
        m = app_edit.AppEditMixin()
        m.create_folder("work", "分类")
        _mk_app(self.root, "work/分类/inner", "i.inner", "内")
        r = m.move_node("work/分类/inner", "work", "work/分类/inner2")
        self.assertFalse(r["ok"])
        self.assertIn("落位参照", r["error"])

    # ---------- 源码读写（HTML 导入型 App 改界面） ----------

    def test_source_read_write_defaults_to_ui_html(self):
        m = app_edit.AppEditMixin()
        r = m.create_app_from_html("work", "小工具", "<html><body>旧</body></html>", app_id="ui.tool")
        self.assertTrue(r["ok"], r)
        got = m.get_app_source("ui.tool")
        self.assertTrue(got["ok"], got)
        self.assertEqual(got["file"], "ui/index.html")
        self.assertIn("旧", got["content"])
        saved = m.save_app_source("ui.tool", got["file"], "<html><body>新</body></html>")
        self.assertTrue(saved["ok"], saved)
        text = (self.root / "work" / "小工具" / "ui" / "index.html").read_text(encoding="utf-8")
        self.assertIn("新", text)

    def test_source_rejects_escape_and_binary(self):
        m = app_edit.AppEditMixin()
        self.assertFalse(m.get_app_source("a.alpha", "../beta/manifest.json")["ok"])
        self.assertFalse(m.get_app_source("a.alpha", "ui/../../beta/manifest.json")["ok"])
        self.assertFalse(m.get_app_source("a.alpha", "C:/Windows/win.ini")["ok"])
        self.assertFalse(m.save_app_source("a.alpha", "ui/run.exe", "x")["ok"])
        self.assertFalse(m.save_app_source("a.alpha", "../beta/manifest.json", "{}")["ok"])

    def test_source_missing_file_reports_error(self):
        r = app_edit.AppEditMixin().get_app_source("a.alpha")
        self.assertFalse(r["ok"])
        self.assertIn("不存在", r["error"])

    # ---------- 越界防护 ----------

    def test_path_traversal_is_rejected(self):
        m = app_edit.AppEditMixin()
        self.assertFalse(m.create_folder("..", "x")["ok"])
        self.assertFalse(m.move_app("a.alpha", "../outside")["ok"])
        self.assertFalse(m.rename_folder("../../etc", "x")["ok"])

    # ---------- 进阶批：新建 / 导入 / 复制 / 导出 ----------

    def test_create_app_from_html(self):
        r = app_edit.AppEditMixin().create_app_from_html("work", "小工具", "<!DOCTYPE html><html><body>hi</body></html>")
        self.assertTrue(r["ok"], r)
        d = self.root / "work" / "小工具"
        self.assertTrue((d / "manifest.json").is_file())
        self.assertTrue((d / "ui" / "index.html").is_file())
        self.assertIn("hi", (d / "ui" / "index.html").read_text(encoding="utf-8"))
        meta = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["type"], "ui")

    def test_create_app_from_html_rejects_empty(self):
        self.assertFalse(app_edit.AppEditMixin().create_app_from_html("work", "空", "   ")["ok"])

    def test_create_url_app_requires_http(self):
        m = app_edit.AppEditMixin()
        self.assertFalse(m.create_url_app("work", "站点", "ftp://x")["ok"])
        r = m.create_url_app("work", "站点", "https://example.com")
        self.assertTrue(r["ok"], r)
        meta = json.loads((self.root / "work" / "站点" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["type"], "url")
        self.assertEqual(meta["url"], "https://example.com")
        self.assertEqual(meta["container"], "iframe")

    def test_create_url_app_accepts_bare_ip_and_host(self):
        """裸地址（IP / 域名）自动补 http://。"""
        m = app_edit.AppEditMixin()
        r = m.create_url_app("work", "路由", "192.168.3.78")
        self.assertTrue(r["ok"], r)
        meta = json.loads((self.root / "work" / "路由" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["url"], "http://192.168.3.78")
        r2 = m.create_url_app("work", "站点2", "example.com/path")
        self.assertTrue(r2["ok"], r2)
        meta2 = json.loads((self.root / "work" / "站点2" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta2["url"], "http://example.com/path")

    def test_import_and_export_app(self):
        # 用独立临时目录，避免与上一次运行残留冲突
        outer = tempfile.TemporaryDirectory()
        self.addCleanup(outer.cleanup)
        outer_root = Path(outer.name)

        src = outer_root / "external_app"
        src.mkdir()
        (src / "manifest.json").write_text(json.dumps({"name": "外来", "id": "ext.x"}, ensure_ascii=False), encoding="utf-8")
        m = app_edit.AppEditMixin()
        r = m.import_app_folder("work", str(src))
        self.assertTrue(r["ok"], r)
        self.assertTrue((self.root / "work" / "external_app" / "manifest.json").is_file())

        dest = outer_root / "exported"
        dest.mkdir()
        r2 = m.export_app("ext.x", str(dest))
        self.assertTrue(r2["ok"], r2)
        self.assertTrue((dest / "external_app" / "manifest.json").is_file())

    def test_import_rejects_folder_without_manifest(self):
        outer = tempfile.TemporaryDirectory()
        self.addCleanup(outer.cleanup)
        bad = Path(outer.name) / "no_manifest_dir"
        bad.mkdir()
        self.assertFalse(app_edit.AppEditMixin().import_app_folder("work", str(bad))["ok"])

    def test_duplicate_app_gets_distinct_id(self):
        r = app_edit.AppEditMixin().duplicate_app("a.alpha", "甲副本")
        self.assertTrue(r["ok"], r)
        meta = json.loads((self.root / "work" / "甲副本" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["name"], "甲副本")
        self.assertNotEqual(meta["id"], "a.alpha")


if __name__ == "__main__":
    unittest.main()
