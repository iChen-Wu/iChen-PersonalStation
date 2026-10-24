"""iChen 中控 - 运行日志落盘（stdout/stderr → data/logs/ichen.log）。

在 main() 最早处调用 install_log_tee()：
- 控制台输出保持原样；
- 同时追加写入 data/logs/ichen.log；
- 启动时若日志超过 2MB，则把旧日志滚动为 ichen.1.log（只保留一份备份）。

这样「控制台 → 设置 → 诊断」里的查看 / 导出才有数据可给。
"""
import sys
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parents[2] / "data" / "logs"
LOG_FILE = LOG_DIR / "ichen.log"
LOG_BACKUP = LOG_DIR / "ichen.1.log"
_MAX_BYTES = 2 * 1024 * 1024  # 2MB


class _Tee:
    """把写入同时转发到原 stream 与日志文件。任何一方失败都不影响另一方。"""

    def __init__(self, stream, fh):
        self._stream = stream
        self._fh = fh

    def write(self, s):
        try:
            self._stream.write(s)
        except Exception:
            pass
        try:
            self._fh.write(s)
            self._fh.flush()
        except Exception:
            pass

    def flush(self):
        try:
            self._stream.flush()
        except Exception:
            pass
        try:
            self._fh.flush()
        except Exception:
            pass

    def __getattr__(self, name):  # fileno / encoding 等透传给原 stream
        return getattr(self._stream, name)


def install_log_tee() -> Path:
    """安装 stdout/stderr 双写，返回日志文件路径。失败时静默返回路径（不影响启动）。"""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > _MAX_BYTES:
            try:
                if LOG_BACKUP.exists():
                    LOG_BACKUP.unlink()
                LOG_FILE.rename(LOG_BACKUP)
            except Exception:
                pass
        fh = open(LOG_FILE, "a", encoding="utf-8", errors="replace")
        fh.write("\n===== 启动 =====\n")
        fh.flush()
        sys.stdout = _Tee(sys.stdout, fh)
        sys.stderr = _Tee(sys.stderr, fh)
    except Exception:
        pass
    return LOG_FILE
