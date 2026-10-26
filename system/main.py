"""iChen 中控启动脚本（pywebview 桌面窗口 + 系统托盘常驻）

运行方式（任意目录均可，不依赖 cwd）：
    python -m system.main
    python /path/to/iChen/system/main.py

启动参数：
    --debug       本次开启调试（F12 / 右键检查；默认关闭）
    --frameless   本次强制无边框（自绘标题栏；平时用设置页开关）
    --tray        启动时不显示窗口，仅驻留系统托盘（托盘菜单「打开」调出界面）

依赖：pywebview（未安装或 WebView2 运行时缺失时会给出明确提示）
    pip install pywebview          # Windows 还需 Microsoft Edge WebView2 Runtime
    pip install pystray Pillow     # 系统托盘（可选，缺失时降级为关窗即退出）
"""
import sys
from pathlib import Path

# ========== 路径定位（兼容任意目录 / 快捷方式启动） ==========
SYSTEM_DIR = Path(__file__).resolve().parent          # system/
PROJECT_ROOT = SYSTEM_DIR.parent                      # 项目根
DESKTOP_DIR = SYSTEM_DIR / "desktop"                  # 界面资源（index.html / css / js / ico）

for _p in (str(PROJECT_ROOT), str(SYSTEM_DIR),
           str(PROJECT_ROOT / "shared")):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _ensure_pywebview():
    try:
        import webview  # noqa: F401
        return True
    except ImportError:
        return False


def parse_flags(argv) -> dict:
    """解析启动参数（纯函数，便于单测；不涉及窗口与内核）。

    - `--debug` 本次开启 pywebview 调试（默认关闭；WebView2 开了才允许 F12 / 右键检查）
    - `--frameless` 本次启动强制启用自绘标题栏（默认用 pywebview 原生；
      设置页的「无边框窗口」开关持久化在 data/local_config.json，重启后生效）
    - `--tray` 启动时不显示主窗口，只驻留系统托盘（托盘菜单「打开」再调出界面）
    """
    return {
        "debug": "--debug" in argv,
        "frameless": "--frameless" in argv,
        "tray": "--tray" in argv,
    }


def read_persisted_frameless() -> bool:
    """读取设置页持久化的「无边框窗口」开关（data/local_config.json）。

    v3.3.3 起**默认开启**（自绘标题栏）：只有用户显式写 false 才退回
    pywebview 原生标题栏；缺项 / 文件损坏一律按开启处理。
    """
    try:
        import json
        from system.kernel.settings_mixin import CONFIG_FILE
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return not (isinstance(data, dict) and data.get("frameless") is False)
    except Exception:
        return True


def build_restart_argv(argv) -> list:
    """构造重启命令行：重走 main.py 入口。

    剥掉 `--frameless` / `--tray`：重启后窗口样式只由持久化设置决定，且重启
    应当正常显示界面（否则「设置里关掉 + 重启」会被旧参数再次强制为隐藏/无边框）；
    其余参数（如 --debug）原样透传。
    """
    _ONE_SHOT_FLAGS = {"--frameless", "--tray"}
    return [sys.executable, str(SYSTEM_DIR / "main.py")] + \
        [a for a in (argv or [])[1:] if a not in _ONE_SHOT_FLAGS]


def main():
    flags = parse_flags(sys.argv)
    # 日志落盘（最早安装：之后的所有 print / 异常都进 data/logs/ichen.log）
    try:
        from system.kernel.logtee import install_log_tee
        install_log_tee()
    except Exception:
        pass
    # 无边框窗口的唯一门禁：命令行 --frameless（单次强制）或设置页持久化开关
    frameless = bool(flags["frameless"]) or read_persisted_frameless()
    # 首次启动：把默认配置基线补到 data/config/（只补缺失项，不覆盖用户改过的值）
    try:
        from system.kernel.settings.bootstrap import ensure_config
        created = ensure_config()
        print("[iChen] 配置基线检查完成" + ("，补齐: " + ", ".join(created) if created else "（无缺失）"))
    except Exception as e:
        print("[iChen] 配置基线检查跳过:", e)

    index_file = DESKTOP_DIR / "index.html"
    icon_file = DESKTOP_DIR / "iChen.ico"

    # ---- 启动诊断（开不了窗口时先看这里） ----
    print("[iChen] 界面目录:", DESKTOP_DIR)
    print("[iChen] index.html 存在:", index_file.exists())
    print("[iChen] iChen.ico 存在:", icon_file.exists())
    if not index_file.exists():
        print("[错误] 找不到 index.html，请检查 system/desktop 是否完整")
        sys.exit(1)
    if not _ensure_pywebview():
        print("[错误] 缺少 pywebview，请先安装：pip install pywebview")
        sys.exit(1)

    import webview
    from system.kernel.api import Api
    from system.kernel.tray import TrayManager

    # 把外部链接关在中枢里：URL 型 App 里的链接不应弹到系统默认浏览器。
    # 配合 URL 型 iframe 的 sandbox（不给 allow-popups），站内跳转留在 iframe 内。
    try:
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
    except Exception as e:
        print("[iChen] 未能关闭“外部链接交给浏览器”:", e)

    # 用 index.html 的绝对 file URI 打开：无论从哪个目录启动都能加载页面，
    # 页面内相对路径（css/、js/）均以该文件所在目录解析
    page_url = index_file.as_uri()
    print("[iChen] 打开页面:", page_url)

    api = Api()
    api._frameless = frameless   # 供前端 get_window_mode() 查询

    # 更新善后：上次离线更新若正常完成，启动时通知用户新版本号
    try:
        upd = api.startup_update_check()
        if upd.get("updated"):
            print("[iChen] 上次更新已完成：", upd.get("updated_to", ""))
            def _notify_updated():
                import time as _t
                _t.sleep(3)  # 等前端就绪
                api.notify("更新完成", "已更新到 v" + str(upd.get("updated_to", "")), "info")
            import threading as _th
            _th.Thread(target=_notify_updated, daemon=True).start()
    except Exception as e:
        print("[iChen] 更新善后检查失败:", e)

    # ---- 系统托盘：关窗 = 隐藏，进程常驻 ----
    _force_quit = False

    def _relaunch():
        """拉起新实例（配置此时已落盘，新进程会读回 frameless 开关）。"""
        import subprocess
        args = build_restart_argv(sys.argv)
        popen_kwargs = {"cwd": str(PROJECT_ROOT)}
        if sys.platform == "win32":
            # 独立进程组 + 脱离控制台：父进程退出后新实例照常存活
            popen_kwargs["creationflags"] = (
                getattr(subprocess, "DETACHED_PROCESS", 0)
                | subprocess.CREATE_NEW_PROCESS_GROUP
            )
        subprocess.Popen(args, **popen_kwargs)

    def tray_open():
        """托盘「打开」：恢复主窗口。"""
        api.restore_from_tray()

    def tray_quit():
        """托盘「退出」：真正终止进程。"""
        nonlocal _force_quit
        _force_quit = True
        tray.stop()
        try:
            window.destroy()
        except Exception:
            pass

    def tray_restart():
        """设置页「立即重启」：先成功拉起新实例，再终止当前进程。"""
        nonlocal _force_quit
        _relaunch()  # 拉起失败会抛异常，当前实例保持运行
        _force_quit = True
        tray.stop()
        try:
            window.destroy()
        except Exception:
            pass

    tray = TrayManager(tray_open, tray_quit, icon_path=icon_file)
    # 设置页「退出应用」= 真正终止进程（同托盘「退出」）；直接 destroy 会被 closing 拦截成隐藏
    api._quit_hook = tray_quit
    # 设置页「立即重启」（切换无边框窗口等需重启生效的设置）
    api._restart_hook = tray_restart

    # --tray：启动即驻留托盘、不显示主窗口。托盘不可用时无法再调出界面，
    # 此时降级为正常显示窗口并给出提示。
    start_hidden = bool(flags["tray"])
    if start_hidden and not tray.available:
        print("[iChen] 指定了 --tray 但系统托盘不可用（缺少 pystray/Pillow），改为正常显示窗口")
        start_hidden = False

    def on_closing():
        """拦截窗口关闭：有托盘 → 隐藏到托盘；无托盘 → 正常退出。"""
        if _force_quit:
            return True   # 托盘"退出"或 quit_app 触发的关闭，放行
        if tray.available:
            api.hide_to_tray()
            return False  # 取消关闭，窗口已隐藏
        return True       # 没托盘就正常退出

    def on_loaded():
        api.set_window(window)
        window.evaluate_js(
            "if (typeof window.pywebview !== 'undefined') "
            "window.dispatchEvent(new Event('pywebviewready'));"
        )
        # 告知前端当前窗口是否 frameless（决定自绘标题栏是否显示）
        window.evaluate_js(
            "window.__ICHEN_FRAMELESS__ = " + ("true;" if frameless else "false;")
        )
        # 默认大窗口：启动即最大化到工作区（避开任务栏，frameless 下不能用
        # 系统最大化——那会盖住任务栏）。--tray 启动时窗口隐藏，跳过。
        if not start_hidden:
            try:
                api.window_toggle_maximize()
            except Exception as e:
                print(f"[iChen] 启动最大化失败（忽略）: {e}")

    # 调试：默认关闭；需要时用命令行 --debug 打开（WebView2 开了才允许 F12 / 右键检查）。
    # 窗口控制栏：默认用 pywebview 原生；frameless（命令行或设置开关）才启用自绘标题栏
    # （拖动走 pywebview 的 .pywebview-drag-region，easy_drag=False 时只有标题栏可拖）。
    debug = flags["debug"]
    print("[iChen] 调试模式:", "开启（F12 或右键“检查”）" if debug else "关闭")
    print("[iChen] 窗口控制栏:", "自绘（frameless）" if frameless else "pywebview 原生")
    print("[iChen] 系统托盘:", "启用" if tray.available else "不可用（缺少 pystray/Pillow）")
    print("[iChen] 启动窗口:", "否（--tray：仅驻留托盘，托盘菜单「打开」调出界面）" if start_hidden else "正常显示")
    try:
        window = webview.create_window(
            "iChen",
            url=page_url,
            js_api=api,
            width=1280,
            height=800,
            min_size=(900, 600),
            resizable=True,
            frameless=frameless,
            # --tray：创建窗口但不显示（pywebview 原生支持 hidden，托盘「打开」时再 show）
            hidden=start_hidden,
            # 关闭 pywebview 的「整窗可拖」：frameless 下只有自绘标题栏
            # （.pywebview-drag-region）能拖动，窗口其它区域不响应拖动。
            easy_drag=False,
        )
        # 拦截原生标题栏的关闭按钮 → 隐藏到托盘
        window.events.closing += on_closing
        # 同步系统级最大化/还原（Win+方向键、任务栏操作）到自绘标题栏按钮图标
        window.events.maximized += api.on_native_maximized
        window.events.restored += api.on_native_restored
        # 启动托盘图标（独立守护线程）
        if tray.start():
            print("[iChen] 托盘图标已启动")
        webview.start(on_loaded, icon=str(icon_file) if icon_file.exists() else None, debug=debug)
    except Exception as e:
        tray.stop()
        print("[错误] 启动窗口失败:", e)
        print("       Windows 常见原因：缺少 Microsoft Edge WebView2 Runtime")
        print("       或当前解释器未安装 pywebview（含 WebView2 后端）。")
        sys.exit(1)


if __name__ == "__main__":
    main()
