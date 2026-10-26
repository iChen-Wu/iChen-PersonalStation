"""设置页「无边框窗口」开关的启动门禁与重启参数检查。

真实缺陷防线：
- v3.3.3 起自绘标题栏**默认开启**：只有显式 false 才退回原生标题栏，
  缺项 / 损坏文件一律按开启处理（用户显式关闭必须被尊重）。
- 重启命令必须剥掉 --frameless：否则「设置里关掉 + 重启」会被旧命令行
  再次强制打开；其它参数（--debug）要原样透传。
"""
import json
import tempfile
import unittest
from pathlib import Path

import system.main as m
from system.kernel import settings_mixin


class PersistedFramelessTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old = settings_mixin.CONFIG_FILE
        settings_mixin.CONFIG_FILE = Path(self._tmp.name) / "local_config.json"

    def tearDown(self):
        settings_mixin.CONFIG_FILE = self._old
        self._tmp.cleanup()

    def _write(self, data):
        settings_mixin.CONFIG_FILE.write_text(json.dumps(data), encoding="utf-8")

    def test_missing_file_defaults_on(self):
        self.assertTrue(m.read_persisted_frameless())

    def test_explicit_true_is_on(self):
        self._write({"frameless": True, "theme": "light"})
        self.assertTrue(m.read_persisted_frameless())

    def test_explicit_false_is_off(self):
        self._write({"frameless": False})
        self.assertFalse(m.read_persisted_frameless())

    def test_corrupt_file_defaults_on(self):
        settings_mixin.CONFIG_FILE.write_text("{broken", encoding="utf-8")
        self.assertTrue(m.read_persisted_frameless())

    def test_unrelated_keys_defaults_on(self):
        self._write({"theme": "dark", "tabbar_position": "left"})
        self.assertTrue(m.read_persisted_frameless())


class BuildRestartArgvTest(unittest.TestCase):
    def test_strips_frameless_keeps_others(self):
        argv = m.build_restart_argv(["main.py", "--frameless", "--debug"])
        self.assertTrue(argv[1].replace("\\", "/").endswith("system/main.py"))
        self.assertNotIn("--frameless", argv)
        self.assertIn("--debug", argv)

    def test_strips_tray_on_restart(self):
        # 重启应正常显示界面：--tray 与 --frameless 一样属于单次启动参数，必须剥掉
        argv = m.build_restart_argv(["main.py", "--tray", "--debug"])
        self.assertNotIn("--tray", argv)
        self.assertIn("--debug", argv)

    def test_no_extra_args(self):
        argv = m.build_restart_argv(["main.py"])
        self.assertEqual(len(argv), 2)


class ParseFlagsTest(unittest.TestCase):
    def test_tray_flag(self):
        self.assertTrue(m.parse_flags(["main.py", "--tray"])["tray"])
        self.assertFalse(m.parse_flags(["main.py"])["tray"])

    def test_flags_are_independent(self):
        flags = m.parse_flags(["main.py", "--tray"])
        self.assertFalse(flags["frameless"])
        self.assertFalse(flags["debug"])


if __name__ == "__main__":
    unittest.main()
