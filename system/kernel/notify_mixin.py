"""iChen 中控 - 通知能力（notify）。

两条通道：
1. 中枢内通知：推到前端 iChen.Notify（状态栏 toast + 控制台历史），始终可用。
2. Windows 系统气球通知：best-effort，经 PowerShell + NotifyIcon（无需额外依赖、
   无需注册 AppUserModelID）。失败不影响第一条通道。

App 侧用法（iframe 内）：
    window.parent.postMessage({ type: "ichen:notify", app: "<app_id>",
        title: "标题", body: "正文", level: "info|warn|error" }, "*")
"""
import json
import subprocess
import sys


class NotifyMixin:
    def notify(self, title: str, body: str = "", level: str = "info", source: str = "") -> dict:
        title = str(title or "").strip()
        body = str(body or "").strip()
        level = level if level in ("info", "warn", "error") else "info"
        if not title and not body:
            return {"ok": False, "error": "title 与 body 不能都为空"}
        text = title if not body else (title + "：" + body)
        prefix = ("[" + source + "] ") if source else ""

        # 通道 1：中枢内通知中心（toast + 历史）
        self._push_js(
            "if(window.iChen&&iChen.Notify){iChen.Notify.push("
            + json.dumps(level) + "," + json.dumps(prefix + text) + ");}"
        )

        # 通道 2：Windows 气球（best-effort，异步、不阻塞、失败静默）
        native_ok = False
        if sys.platform == "win32":
            try:
                # PowerShell 单引号字符串：只需把单引号双写转义
                t = (title or "iChen").replace("'", "''")
                b = (body or "").replace("'", "''")
                icon = "Error" if level == "error" else ("Warning" if level == "warn" else "Info")
                ps = (
                    "Add-Type -AssemblyName System.Windows.Forms;"
                    "Add-Type -AssemblyName System.Drawing;"
                    "$n=New-Object System.Windows.Forms.NotifyIcon;"
                    "$n.Icon=[System.Drawing.SystemIcons]::Information;"
                    "$n.Visible=$true;"
                    "$n.ShowBalloonTip(3000,'" + t + "','" + b + "',"
                    "[System.Windows.Forms.ToolTipIcon]::" + icon + ");"
                    "Start-Sleep -Seconds 4;$n.Dispose()"
                )
                subprocess.Popen(
                    ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                native_ok = True
            except Exception as e:
                print(f"[iChen] 系统通知发送失败（已降级为仅应用内提示）: {e}")

        return {"ok": True, "native": native_ok}
