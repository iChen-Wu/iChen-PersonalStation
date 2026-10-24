"""设置模块：系统信息 / 本地配置持久化（控制台 → 设置）

- get_system_info    系统信息（版本 / 运行环境 / 数据目录 / App 统计）
- get_local_config   读取本地配置（data/local_config.json）
- save_local_config  保存本地配置（与原配置合并，不覆盖其它键）
"""
import json
import sys
from pathlib import Path

from system.kernel.base import APP_VERSION

try:
    from common.paths import DATA_DIR
except Exception:  # 极端情况下退回相对定位
    DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

CONFIG_FILE = DATA_DIR / "local_config.json"


def _dir_size_bytes(p: Path) -> int:
    """目录占用（递归求和；异常的文件跳过）。"""
    total = 0
    try:
        for f in p.rglob("*"):
            try:
                if f.is_file():
                    total += f.stat().st_size
            except Exception:
                pass
    except Exception:
        pass
    return total


def _fmt_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return (str(round(n, 1)) + " " + unit) if unit != "B" else (str(n) + " B")
        n = n / 1024
    return str(n)


class SettingsMixin:
    def get_system_info(self) -> dict:
        """系统信息：版本 / Python / 平台 / 数据目录 / App 统计（设置页展示用）。"""
        import platform
        info = {
            "version": APP_VERSION,
            "python": ".".join(str(x) for x in sys.version_info[:3]),
            "platform": platform.system() + " " + platform.release(),
            "executable": sys.executable,
            "data_dir": str(DATA_DIR),
            "data_size": _fmt_size(_dir_size_bytes(DATA_DIR)) if DATA_DIR.exists() else "-",
            "app_count": 0,
            "running_count": 0,
        }
        try:
            apps = self.scan_apps() or {}
            info["app_count"] = int(apps.get("app_count") or 0)
        except Exception:
            pass
        try:
            from system.apphost.apps import _MODULE_CACHE
            info["running_count"] = len(_MODULE_CACHE)
        except Exception:
            pass
        return info

    def get_local_config(self) -> dict:
        """读取本地配置（data/local_config.json），不存在/损坏时返回空对象"""
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def save_local_config(self, config: dict) -> dict:
        """保存本地配置：与现有配置合并（不覆盖其它键）"""
        try:
            merged = self.get_local_config()
            if isinstance(config, dict):
                merged.update(config)
            CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(merged, f, ensure_ascii=False, indent=2)
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
