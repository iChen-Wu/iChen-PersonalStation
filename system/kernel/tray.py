"""系统托盘（pystray）：关窗隐藏、托盘唤醒、真退出。

V3.0.0 · 常驻改造：
- 中枢进程在关窗后**继续运行**（App 后台逻辑、HTTP 端口不中断）
- 托盘图标提供「打开 / 重启 / 退出」三个操作
- 图标文件缺失或 pystray 未安装时静默降级（不崩，只是没托盘）
"""

import threading
from pathlib import Path
from typing import Callable, Optional

try:
    import pystray
    from pystray import Icon, Menu, MenuItem
    from PIL import Image, ImageDraw
    _HAS_TRAY = True
except ImportError:
    _HAS_TRAY = False


def _load_icon_image(ico_path: Optional[Path] = None) -> "Image.Image":
    """加载托盘图标：优先用项目的 iChen.ico，失败则画一个占位圆角方块。"""
    if ico_path and ico_path.is_file():
        try:
            return Image.open(str(ico_path))
        except Exception:
            pass
    # 兜底：64x64 深蓝圆角方块 + 白色 "i"
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([4, 4, size - 4, size - 4], radius=14, fill="#1a3a6b")
    cx = size // 2
    draw.rectangle([cx - 3, 20, cx + 3, 46], fill="#ffffff")
    draw.rectangle([cx - 3, 12, cx + 3, 18], fill="#ffffff")
    return img


class TrayManager:
    """托盘管理器：持图标，供 main / window 调用。"""

    def __init__(self, on_open: Callable, on_quit: Callable,
                 icon_path: Optional[Path] = None,
                 on_restart: Optional[Callable] = None):
        self._on_open = on_open
        self._on_quit = on_quit
        self._on_restart = on_restart
        self._icon_path = icon_path
        self._icon: Optional[Icon] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def available(self) -> bool:
        return _HAS_TRAY

    def start(self) -> bool:
        """启动托盘图标（pystray 循环跑在独立守护线程）。"""
        if not _HAS_TRAY:
            return False
        if self._icon:
            return True  # 已启动
        image = _load_icon_image(self._icon_path)
        items = [MenuItem("打开", lambda: self._on_open())]
        if self._on_restart:
            items.append(MenuItem("重启", lambda: self._on_restart()))
        items.append(MenuItem("退出", lambda: self._on_quit()))
        menu = Menu(*items)
        self._icon = Icon("iChen", image, "iChen", menu)
        self._thread = threading.Thread(target=self._icon.run, daemon=True)
        self._thread.start()
        return True

    def stop(self):
        """停止托盘（图标从托盘区消失）。"""
        if self._icon:
            try:
                self._icon.stop()
            except Exception:
                pass
            self._icon = None
            self._thread = None
