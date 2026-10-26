"""前后端接口一致性：Python Api 的公开方法必须在 bridge.js 的 iChen.PyAPI 里有映射。

历史事故：v3.3.0 新增 notify / get_recent_logs / open_log_folder / export_diagnostics /
check_update_package / apply_update_package / update_app 后忘了在 bridge.js 注册，
前端调用 iChen.PyAPI.openLogFolder() 直接抛 TypeError，设置页按钮「没有任何反应」。

规则：Api 类（含全部 mixin）里不以 _ 开头的方法，其 snake_case 名字必须出现在
bridge.js 源码里（映射里会写 api.xxx_yyy 调用）。内部方法（如 _push_js）不在此列。
"""
import inspect
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "system" / "desktop" / "js" / "bridge.js"


def _public_api_methods():
    from system.kernel.api import Api
    names = set()
    for name, member in inspect.getmembers(Api, predicate=inspect.isfunction):
        if name.startswith("_"):
            continue
        names.add(name)
    return names


# 故意不在前端暴露的 Python 方法（main.py 内部接线：托盘回调 / 窗口事件 / 启动流程）
EXEMPT = {
    "startup_update_check",  # main.py 启动自检
    "set_window",            # main.py 注入 window 引用
    "get_app_version",       # 旧接口，前端用 get_system_info().version
    "hide_to_tray",          # 托盘菜单回调（main.py 调）
    "restore_from_tray",     # 托盘菜单回调（main.py 调）
    "on_native_maximized",   # pywebview 窗口事件回调
    "on_native_restored",    # pywebview 窗口事件回调
}


class TestBridgeMapping(unittest.TestCase):
    def test_all_public_api_methods_mapped(self):
        src = BRIDGE.read_text(encoding="utf-8")
        missing = []
        for name in sorted(_public_api_methods()):
            if name in EXEMPT:
                continue
            # 映射形态：api.xxx_yyy(  —— 允许中间有空白
            if not re.search(r"api\." + re.escape(name) + r"\s*\(", src):
                missing.append(name)
        self.assertEqual(
            missing, [],
            "以下 Python Api 方法未在 bridge.js 注册映射（前端会拿到 TypeError 而不是功能）：\n  - "
            + "\n  - ".join(missing),
        )


if __name__ == "__main__":
    unittest.main()
