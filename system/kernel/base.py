"""iChen 中控 - 桥基座（事件循环 / 窗口 / 状态）。

pywebview.js_api 暴露给前端的接口由各功能 Mixin 提供（见 `system/kernel/api.py`）。

演进（V3.0.0）：
- P3：中枢不再持有任何与会话服务的长连接（WYuan / Qxia 的连接与业务会话逻辑已移出）。
- P4 起：「服务」这一类别**已废除**，原服务改为 App（`manifest.json` 的 `type: "service"`），
  生命周期由控制台的「后台」面板统一管理；`services/` 目录与 servicehost 已不存在。

因此中枢原生只保留：桌面、「后台」（App 实例）、以及设置/自动化等基础能力。
"""
import asyncio
import threading

APP_VERSION = "v3.1.2"


class BaseApi:
    def __init__(self):
        self._lock = threading.RLock()
        self._window = None  # pywebview 窗口引用（反向推流）
        self._frameless = False  # 由 system/main.py 按启动参数设置（决定自绘标题栏）

        # ---------- 后台事件循环（供 Mixin 复用） ----------
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    # ==================== 基础 ====================
    def set_window(self, window):
        """供 main.py 调用，传入 pywebview 窗口以实现反向推流"""
        self._window = window

    # ==================== 设置（版本 / 状态 / 退出） ====================
    def get_app_version(self) -> str:
        return APP_VERSION

    def get_system_status(self) -> dict:
        """系统状态：版本号（供设置页展示）。

        中枢不持有任何服务连接，因此这里只有版本；
        「哪些 App 正在后台跑」请看控制台的「后台」面板（App 实例表）。
        """
        return {"version": APP_VERSION}

    def quit_app(self) -> dict:
        """退出应用（真正终止进程，不是收进托盘）。

        直接 destroy() 会触发 main.py 的 closing 拦截（有托盘时转为隐藏），
        所以优先走 main.py 注册的 _quit_hook（置 force 标志 + 停托盘 + 销毁窗口）。
        """
        hook = getattr(self, "_quit_hook", None)
        if callable(hook):
            try:
                hook()
                return {"status": "ok"}
            except Exception as e:
                print(f"[iChen] 退出钩子失败: {e}")
        if self._window:
            try:
                self._window.destroy()
            except Exception as e:
                print(f"[iChen] 退出应用失败: {e}")
        return {"status": "ok"}

    def restart_app(self) -> dict:
        """重启应用（设置页切换「无边框窗口」等需重启生效的场景）。

        实际拉起新实例 + 退出当前进程的逻辑在 main.py 注册的 _restart_hook 里
        （要拿到 sys.executable / 启动参数 / 托盘），内核只负责调用。
        """
        hook = getattr(self, "_restart_hook", None)
        if not callable(hook):
            return {"status": "error", "message": "当前环境不支持重启"}
        try:
            hook()
            return {"status": "ok"}
        except Exception as e:
            print(f"[iChen] 重启失败: {e}")
            return {"status": "error", "message": str(e)}

    def read_text_file(self, path: str) -> dict:
        """读取本地文本文件（UTF-8），供前端「导入 HTML 文件」等场景使用。"""
        from pathlib import Path
        try:
            content = Path(path).read_text(encoding="utf-8")
            return {"ok": True, "content": content}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_external_url(self, url: str) -> dict:
        """用系统默认浏览器打开外部 URL（用于禁止嵌入 iframe 的站点，如带 X-Frame-Options 的设备页）。
        只允许 http/https，避免任意协议注入。"""
        import re
        import webbrowser
        u = str(url or "").strip()
        if not re.match(r"^https?://", u, re.I):
            return {"ok": False, "error": "只允许 http:// 或 https:// 地址"}
        try:
            webbrowser.open(u, new=2)
            return {"ok": True, "url": u}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==================== 内部工具 ====================
    def _run_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def _run_async(self, coro, timeout=30):
        future = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return future.result(timeout=timeout)

    def _push_js(self, code: str):
        """安全地反向调用前端 JS（窗口未就绪时静默忽略）"""
        if self._window:
            try:
                self._window.evaluate_js(code)
            except Exception as e:
                print(f"[iChen] evaluate_js 失败: {e}")
