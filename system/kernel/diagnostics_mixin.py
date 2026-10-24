"""iChen 中控 - 诊断与日志（查看最近日志 / 打开日志目录 / 导出诊断包）。

日志由 system/kernel/logtee.py 在启动时落盘到 data/logs/ichen.log。
"""
import json
import os
import sys
import time
import zipfile
from pathlib import Path

from system.kernel.base import APP_VERSION
from system.kernel.logtee import LOG_DIR, LOG_FILE, LOG_BACKUP


class DiagnosticsMixin:
    def get_recent_logs(self, lines: int = 200) -> dict:
        """读取最近 N 行日志（设置 → 诊断「查看日志」）。"""
        try:
            n = max(1, min(int(lines or 200), 2000))
        except Exception:
            n = 200
        try:
            if not LOG_FILE.exists():
                return {"ok": True, "content": "", "path": str(LOG_FILE)}
            # 只读文件末尾一段，避免大文件全量读取
            with open(LOG_FILE, "rb") as f:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                f.seek(max(0, size - 256 * 1024))
                text = f.read().decode("utf-8", errors="replace")
            tail = text.splitlines()[-n:]
            return {"ok": True, "content": "\n".join(tail), "path": str(LOG_FILE)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def open_log_folder(self) -> dict:
        """在资源管理器里打开日志目录（设置 → 诊断）。"""
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            if sys.platform == "win32":
                os.startfile(str(LOG_DIR))  # noqa: S606 - 本机桌面场景
            else:
                import subprocess
                subprocess.Popen(["xdg-open", str(LOG_DIR)])
            return {"ok": True, "path": str(LOG_DIR)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def export_diagnostics(self, target_path: str = "") -> dict:
        """一键打包诊断信息（版本 / 平台 / 配置 / 最近日志 / App 清单）为 zip。

        target_path 为空时默认写到 data/logs/diagnostics_<时间戳>.zip。
        """
        try:
            if target_path:
                out = Path(target_path)
            else:
                out = LOG_DIR / ("diagnostics_" + time.strftime("%Y%m%d_%H%M%S") + ".zip")
            out.parent.mkdir(parents=True, exist_ok=True)

            info = {
                "version": APP_VERSION,
                "python": sys.version,
                "platform": sys.platform,
                "executable": sys.executable,
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            }

            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr("info.json", json.dumps(info, ensure_ascii=False, indent=2))
                for f in (LOG_FILE, LOG_BACKUP):
                    if f.exists():
                        z.write(f, arcname=f.name)
                # 本地配置（不含敏感信息的本机设置）
                try:
                    from system.kernel.settings_mixin import CONFIG_FILE
                    cfg = Path(CONFIG_FILE)
                    if cfg.exists():
                        z.write(cfg, arcname="local_config.json")
                except Exception:
                    pass
                # App 清单（只放 manifest，不放业务数据）
                try:
                    apps = self.scan_apps()
                    z.writestr("apps.json", json.dumps(apps, ensure_ascii=False, indent=2))
                except Exception:
                    pass

            return {"ok": True, "path": str(out)}
        except Exception as e:
            return {"ok": False, "error": str(e)}
