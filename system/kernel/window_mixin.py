"""窗口控制（供 frameless 自绘标题栏调用）。

V3.0.0 · P4：
- **默认仍用 pywebview 原生标题栏**；只有 `python -m system.main --frameless` 才启用自绘，
  届时这些方法由前端标题栏（`system/desktop/js/titlebar.js`）调用。
- 拖动走 pywebview 注入的 `.pywebview-drag-region` 机制（create_window 时 easy_drag=False），
  只有显式标记的标题栏区域可拖，窗口其余位置不响应拖动。

最大化（Windows + frameless 的关键处理）：
- pywebview 的 `window.maximized` 只是「初始状态」静态属性，窗口创建后永不更新，
  不能拿它做 toggle 依据（否则每次都只会 maximize、按钮永远变不成「还原」）。
- frameless 下 WinForms 的 WindowState=Maximized 会铺满**整块屏幕（盖住任务栏）**。
  这里改为直接操作底层窗体：把 Bounds 设为当前显示器的 **WorkingArea（工作区，避开任务栏）**，
  并记住还原矩形；还原时原样恢复。取不到底层窗体时退回 pywebview 公开 API。
"""
from typing import Any, Dict


class WindowMixin:
    """窗口最小化 / 最大化切换 / 关闭（frameless 模式下由自绘标题栏驱动）。"""

    # ---------- 内部状态（懒初始化，避免动 BaseApi.__init__） ----------
    @property
    def _is_maximized(self) -> bool:
        return bool(getattr(self, "_maximized", False))

    @_is_maximized.setter
    def _is_maximized(self, value: bool) -> None:
        self._maximized = bool(value)

    @property
    def _is_fullscreen(self) -> bool:
        return bool(getattr(self, "_fullscreen", False))

    @_is_fullscreen.setter
    def _is_fullscreen(self, value: bool) -> None:
        self._fullscreen = bool(value)

    # ==================== 全屏切换（覆盖任务栏） ====================
    def window_toggle_fullscreen(self) -> Dict[str, Any]:
        """真全屏切换：铺满整块屏幕（盖住任务栏），供标题栏中间按钮调用。

        与「最大化」（工作区、保留任务栏）是两档不同状态；退出全屏后
        pywebview 会恢复进入前的矩形（通常仍是工作区最大化）。
        """
        if not self._window:
            return {"ok": False, "error": "窗口未就绪"}
        try:
            self._window.toggle_fullscreen()
            self._is_fullscreen = not self._is_fullscreen
            self._push_fullscreen_state()
            return {"ok": True, "fullscreen": self._is_fullscreen}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _push_fullscreen_state(self) -> None:
        """把全屏状态推给标题栏（切换 全屏/退出全屏 图标）。"""
        try:
            push = getattr(self, "_push_js", None)
            if not callable(push):
                return
            flag = "true" if self._is_fullscreen else "false"
            push(f"if(window.iChen&&iChen.Titlebar)iChen.Titlebar.setFullscreen({flag});")
        except Exception as e:
            print(f"[iChen] 推送全屏状态失败: {e}")

    def get_window_mode(self) -> Dict[str, Any]:
        """窗口模式：frameless 与否。

        **前端要主动查这个**，不要依赖启动时注入的标志——注入发生在页面加载之后，
        而标题栏的初始化在 DOMContentLoaded 就跑了（这正是第一版标题栏不显示的原因）。
        """
        return {"frameless": bool(getattr(self, "_frameless", False))}

    def window_minimize(self) -> Dict[str, Any]:
        if not self._window:
            return {"ok": False, "error": "窗口未就绪"}
        try:
            self._window.minimize()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ==================== 最大化 / 还原 ====================
    def window_toggle_maximize(self) -> Dict[str, Any]:
        """在「工作区最大化」与「还原」之间切换（供标题栏按钮 / 双击标题栏调用）。"""
        if not self._window:
            return {"ok": False, "error": "窗口未就绪"}
        try:
            if self._is_maximized:
                return self._unmaximize()
            return self._maximize_to_workarea()
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _native_form(self):
        """获取 pywebview 底层 WinForms 窗体（仅 Windows 后端可用；失败返回 None）。"""
        try:
            from webview.platforms.winforms import BrowserView
            return BrowserView.instances.get(self._window.uid)
        except Exception:
            return None

    def _maximize_to_workarea(self) -> Dict[str, Any]:
        """最大化到当前显示器工作区（保留任务栏），并记住还原矩形。"""
        form = self._native_form()
        if form is not None:
            try:
                import clr  # noqa: F401：保证 System.Windows.Forms 已加载
                import System
                import System.Windows.Forms as WinForms
                from System.Drawing import Rectangle

                captured: Dict[str, Any] = {}

                def _do():
                    normal = WinForms.FormWindowState.Normal
                    if form.WindowState != normal:
                        form.WindowState = normal  # OS 最大化态先还原，取到的 Bounds 才是真实矩形
                    captured["rect"] = (int(form.Left), int(form.Top),
                                        int(form.Width), int(form.Height))
                    wa = WinForms.Screen.FromControl(form).WorkingArea
                    form.Bounds = Rectangle(int(wa.X), int(wa.Y),
                                            int(wa.Width), int(wa.Height))

                if form.InvokeRequired:
                    form.Invoke(System.Action(_do))
                else:
                    _do()
                self._restore_rect = captured.get("rect")
                self._is_maximized = True
                self._push_window_state()
                return {"ok": True, "maximized": True, "mode": "workarea"}
            except Exception as e:
                print(f"[iChen] 工作区最大化失败，退回系统最大化: {e}")

        # 跨平台 / 取不到底层窗体：退回 pywebview 公开 API
        self._window.maximize()
        self._is_maximized = True
        self._push_window_state()
        return {"ok": True, "maximized": True, "mode": "system"}

    def _unmaximize(self) -> Dict[str, Any]:
        """从最大化还原（优先恢复记住的矩形）。"""
        form = self._native_form()
        rect = getattr(self, "_restore_rect", None)
        if form is not None:
            try:
                import System
                import System.Windows.Forms as WinForms
                from System.Drawing import Rectangle

                def _do():
                    normal = WinForms.FormWindowState.Normal
                    if form.WindowState != normal:
                        form.WindowState = normal
                    if rect and len(rect) == 4:
                        x, y, w, h = rect
                        form.Bounds = Rectangle(int(x), int(y), int(w), int(h))

                if form.InvokeRequired:
                    form.Invoke(System.Action(_do))
                else:
                    _do()
                self._is_maximized = False
                self._restore_rect = None
                self._push_window_state()
                return {"ok": True, "maximized": False}
            except Exception as e:
                print(f"[iChen] 还原失败，退回系统还原: {e}")

        self._window.restore()
        self._is_maximized = False
        self._restore_rect = None
        self._push_window_state()
        return {"ok": True, "maximized": False}

    # ---------- 系统级最大化状态变化（Win+方向键 / 任务栏等）由 main.py 订阅 ----------
    def on_native_maximized(self) -> None:
        # 系统级最大化时，从 RestoreBounds 取回最大化前的矩形（供之后精确还原）
        form = self._native_form()
        if form is not None:
            try:
                rb = form.RestoreBounds
                if int(rb.Width) > 0 and int(rb.Height) > 0:
                    self._restore_rect = (int(rb.X), int(rb.Y),
                                          int(rb.Width), int(rb.Height))
            except Exception:
                pass
        self._is_maximized = True
        self._push_window_state()

    def on_native_restored(self) -> None:
        # 任务栏恢复等场景：窗口可能仍保持工作区尺寸，应继续视为最大化，
        # 否则按钮状态与实际窗口不一致（再点会重复「最大化」）。
        form = self._native_form()
        if form is not None:
            try:
                import System.Windows.Forms as WinForms
                b, wa = form.Bounds, WinForms.Screen.FromControl(form).WorkingArea
                if (int(b.X), int(b.Y), int(b.Width), int(b.Height)) == \
                   (int(wa.X), int(wa.Y), int(wa.Width), int(wa.Height)):
                    self._is_maximized = True
                    self._push_window_state()
                    return
            except Exception:
                pass
        self._is_maximized = False
        self._restore_rect = None
        self._push_window_state()

    def _push_window_state(self) -> None:
        """把最大化状态推给标题栏（切换 最大化/恢复 图标）。推送失败不影响窗口操作。"""
        try:
            push = getattr(self, "_push_js", None)
            if not callable(push):
                return
            flag = "true" if self._is_maximized else "false"
            push(f"if(window.iChen&&iChen.Titlebar)iChen.Titlebar.setMaximized({flag});")
        except Exception as e:
            print(f"[iChen] 推送窗口状态失败: {e}")

    def window_close(self) -> Dict[str, Any]:
        """关闭窗口 = 收进系统托盘（常驻模式）；真正退出走 quit_app。"""
        return self.hide_to_tray()

    def hide_to_tray(self) -> Dict[str, Any]:
        """隐藏主窗口，进程继续在后台运行（App / 端口服务不中断）。"""
        if not self._window:
            return {"ok": False, "error": "窗口未就绪"}
        try:
            self._window.hide()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def restore_from_tray(self) -> Dict[str, Any]:
        """从托盘恢复主窗口（托盘菜单「打开」调用）。

        注意：window.show() 对最小化态无效，必须先 restore 再 show。
        """
        if not self._window:
            return {"ok": False, "error": "窗口未就绪"}
        try:
            self._window.restore()
        except Exception:
            pass
        try:
            self._window.show()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def window_state(self) -> Dict[str, Any]:
        """窗口状态（供标题栏初始化 最大化/还原、全屏/退出全屏 图标）。"""
        if not self._window:
            return {"ok": False, "error": "窗口未就绪"}
        return {
            "ok": True,
            "maximized": self._is_maximized,
            "fullscreen": self._is_fullscreen,
        }
