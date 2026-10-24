"""iChen 中控 - 离线更新（zip 包 / iChen 文件夹 → 校验 → 暂存 → 备份 → updater 接管）。

流程：
1. check_update_package(path)：读取 zip 或文件夹里的 manifest.json，返回 {ok, version,
   current, newer, min_runtime_ok}。只校验，不改任何东西。
2. apply_update_package(path)：
   - 解压 / 复制到 data/updates/_staging/
   - 把现有 system/、shared/common/ 备份到 data/updates/_backup_<版本>/
   - 写 data/updates/_update_job.json（updater 的工作清单）
   - 生成 data/updates/updater.bat 并启动它，然后调用 _quit_hook 退出自己
3. updater.bat（独立进程，不依赖本进程的任何文件句柄）：
   - 等本进程 PID 退出
   - robocopy _staging/system → <root>/system /MIR
   - robocopy _staging/shared/common → <root>/shared/common /MIR
   - 若 _staging/apps 存在 → robocopy 到 <root>/apps /E（合并，不清用户自己的 App）
   - 重新拉起新中枢；失败则把 _backup 还原
4. 下次启动时 startup_update_check() 清理 job / staging，并在上次更新失败时给出提示。

包布局（zip 与文件夹相同）：
    manifest.json        必填，含 version（如 "3.3.0"）；可选 min_python（如 "3.10"）
    system/              覆盖中枢代码
    shared/common/       覆盖共享样式与公共模块
    apps/                可选，合并到 apps/（自带示例 App 的更新走这里）
不包含 runtime/、data/、U盘嵌入式 Python——这些属于环境，不归更新管。
"""
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from system.kernel.base import APP_VERSION

ROOT = Path(__file__).resolve().parents[2]
UPDATES_DIR = ROOT / "data" / "updates"
STAGING_DIR = UPDATES_DIR / "_staging"
JOB_FILE = UPDATES_DIR / "_update_job.json"
UPDATER_BAT = UPDATES_DIR / "updater.bat"

# 允许被更新覆盖的顶层目录（白名单，防止恶意包写穿到别处）
_OVERLAY_DIRS = ("system", os.path.join("shared", "common"))
_APPS_DIR = "apps"  # 包里若带 apps/ 则合并，不镜像（保留用户自有 App）


def _parse_version(v: str):
    """把 'v3.2.8' / '3.2.8' 解析成 (3,2,8) 元组用于比较；解析失败返回 None。"""
    s = str(v or "").strip().lstrip("vV")
    parts = []
    for seg in s.split("."):
        num = "".join(ch for ch in seg if ch.isdigit())
        if num == "":
            return None
        parts.append(int(num))
    return tuple(parts) if parts else None


class UpdateMixin:
    # ---------- 内部：读取包 ----------
    def _read_package(self, src: str):
        """读取 zip / 文件夹到 (manifest: dict, extract_to: callable(dst_dir))。

        返回 (None, error) 表示包非法。
        """
        p = Path(str(src or "").strip())
        if not p.exists():
            return None, "路径不存在：" + str(p)

        if p.is_dir():
            mf = p / "manifest.json"
            if not mf.exists():
                return None, "所选文件夹里没有 manifest.json，不是有效的 iChen 更新包"
            try:
                # utf-8-sig：容忍带 BOM 的 manifest（编辑器另存为 UTF-8 时常带）
                manifest = json.loads(mf.read_text(encoding="utf-8-sig"))
            except Exception as e:
                return None, "manifest.json 解析失败：" + str(e)

            def extract(dst: Path):
                for name in os.listdir(p):
                    if name in ("system", "shared", "apps"):
                        shutil.copytree(p / name, dst / name, dirs_exist_ok=True)
            return manifest, extract

        # zip 包
        try:
            zf = zipfile.ZipFile(p)
        except Exception:
            return None, "所选文件不是有效的 zip 包"
        names = zf.namelist()
        # 允许包根有一层同名外壳目录（如 ichen-v3.3.0/system/...）
        mf_name = None
        for cand in ("manifest.json",):
            if cand in names:
                mf_name = cand
                break
        if mf_name is None:
            tops = {n.split("/")[0] for n in names if "/" in n}
            for t in tops:
                cand = t + "/manifest.json"
                if cand in names:
                    mf_name = cand
                    break
        if mf_name is None:
            zf.close()
            return None, "zip 里没有 manifest.json，不是有效的 iChen 更新包"
        prefix = mf_name[: -len("manifest.json")]
        try:
            manifest = json.loads(zf.read(mf_name).decode("utf-8-sig"))
        except Exception as e:
            zf.close()
            return None, "manifest.json 解析失败：" + str(e)

        # 注意：extract 闭包持有 zf，不能在这里 close（调用方随后才解包）
        def extract(dst: Path):
            try:
                for n in zf.namelist():
                    if not n.startswith(prefix) or n.endswith("/"):
                        continue
                    rel = n[len(prefix):]
                    top = rel.split("/")[0]
                    if top not in ("system", "shared", "apps"):
                        continue  # 白名单之外的目录一律不解
                    target = dst / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(zf.read(n))
            finally:
                zf.close()
        return manifest, extract

    def _validate_manifest(self, manifest: dict):
        """返回 (ok, error, info)。info 含 version / newer / min_python_ok。"""
        if not isinstance(manifest, dict):
            return False, "manifest 不是有效的 JSON 对象", {}
        new_ver = str(manifest.get("version") or "").strip()
        if not new_ver:
            return False, "manifest.json 缺少 version 字段", {}
        cur = _parse_version(APP_VERSION)
        new = _parse_version(new_ver)
        if new is None:
            return False, "manifest.json 的 version 无法解析：" + new_ver, {}
        newer = (cur is None) or (new > cur)
        # 可选的 Python 版本下限（U盘嵌入版等老运行时的保护）
        min_py = manifest.get("min_python")
        min_py_ok = True
        if min_py:
            req = _parse_version(str(min_py))
            if req:
                min_py_ok = sys.version_info[: len(req)] >= req
        info = {
            "version": new_ver,
            "current": APP_VERSION,
            "newer": newer,
            "min_python": min_py,
            "min_python_ok": min_py_ok,
            "python": ".".join(str(x) for x in sys.version_info[:3]),
        }
        if not min_py_ok:
            return False, "该版本要求 Python ≥ " + str(min_py) + "，当前为 " + info["python"], info
        if not newer:
            return False, "包版本 v" + new_ver + " 不高于当前 " + APP_VERSION + "，无需更新", info
        return True, "", info

    # ---------- 对外：校验 ----------
    def check_update_package(self, path: str) -> dict:
        """设置页「更新中枢」第一步：只校验，返回版本比对结果。"""
        try:
            manifest, extract_or_err = self._read_package(path)
            if manifest is None:
                return {"ok": False, "error": extract_or_err}
            ok, err, info = self._validate_manifest(manifest)
            info = dict(info)
            info["ok"] = ok
            if err:
                info["error"] = err
            return info
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ---------- 对外：应用更新 ----------
    def apply_update_package(self, path: str) -> dict:
        """第二步：暂存 → 备份 → 写 job → 启动 updater.bat → 退出自己。

        成功后本进程立即退出，由 updater.bat 完成覆盖并拉起新实例。
        """
        manifest, extract_or_err = self._read_package(path)
        if manifest is None:
            return {"ok": False, "error": extract_or_err}
        ok, err, info = self._validate_manifest(manifest)
        if not ok:
            return dict(info, ok=False, error=err)

        try:
            UPDATES_DIR.mkdir(parents=True, exist_ok=True)

            # 1) 暂存
            if STAGING_DIR.exists():
                shutil.rmtree(STAGING_DIR, ignore_errors=True)
            STAGING_DIR.mkdir(parents=True)
            extract_or_err(STAGING_DIR)
            # manifest.json 放到 staging 根部（updater 与自检都会读）
            if Path(path).is_dir():
                shutil.copy2(Path(path) / "manifest.json", STAGING_DIR / "manifest.json")
            else:
                _extract_manifest_to(path, STAGING_DIR)

            # 2) 备份现有可被覆盖的目录
            backup_dir = UPDATES_DIR / ("_backup_" + APP_VERSION.lstrip("vV"))
            if backup_dir.exists():
                shutil.rmtree(backup_dir, ignore_errors=True)
            backup_dir.mkdir(parents=True)
            for rel in _OVERLAY_DIRS:
                src_dir = ROOT / rel
                if src_dir.exists():
                    shutil.copytree(src_dir, backup_dir / rel)

            # 3) 写 job + updater.bat
            job = {
                "from_version": APP_VERSION,
                "to_version": info["version"],
                "root": str(ROOT),
                "staging": str(STAGING_DIR),
                "backup": str(backup_dir),
                "pid": os.getpid(),
                "relaunch": [sys.executable, str(ROOT / "system" / "main.py")],
            }
            JOB_FILE.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
            UPDATER_BAT.write_text(_render_updater_bat(job), encoding="gbk", errors="replace")

            # 4) 启动 updater（脱离本进程），然后退出自己
            subprocess.Popen(
                ["cmd", "/c", str(UPDATER_BAT)],
                cwd=str(UPDATES_DIR),
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                | getattr(subprocess, "DETACHED_PROCESS", 0),
            )
        except Exception as e:
            return {"ok": False, "error": "更新准备失败：" + str(e)}

        # 退出自己（走 main.py 注册的退出钩子，正确停托盘与销毁窗口）
        hook = getattr(self, "_quit_hook", None)
        if callable(hook):
            try:
                hook()
            except Exception as e:
                print(f"[iChen] 更新前退出失败: {e}")
        elif self._window:
            try:
                self._window.destroy()
            except Exception:
                pass
        return {"ok": True, "message": "更新程序已启动，中枢将自动重启"}

    # ---------- 启动自检：上次更新的善后 ----------
    def startup_update_check(self) -> dict:
        """每次启动调用：清理更新现场；若上次更新失败则提示。

        返回 {"ok": True, "updated_to": 版本} 表示刚完成了一次更新。
        """
        try:
            if not JOB_FILE.exists():
                return {"ok": True, "updated": False}
            job = json.loads(JOB_FILE.read_text(encoding="utf-8"))
            updated_to = ""
            staging = Path(job.get("staging") or "")
            # staging 已被 updater 清掉 → 上次更新正常完成
            if not staging.exists():
                updated_to = str(job.get("to_version") or "")
            try:
                JOB_FILE.unlink()
            except Exception:
                pass
            # staging 残留（更新没跑成）：直接清掉，不阻塞启动；备份仍在，用户可重试
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
            return {"ok": True, "updated": bool(updated_to), "updated_to": updated_to}
        except Exception as e:
            print(f"[iChen] 更新善后检查失败: {e}")
            return {"ok": False, "error": str(e)}


def _extract_manifest_to(zip_path: str, dst: Path) -> Path:
    """从 zip 里把 manifest.json 解到 dst/manifest.json，返回该路径。"""
    with zipfile.ZipFile(zip_path) as zf:
        name = "manifest.json"
        if name not in zf.namelist():
            for n in zf.namelist():
                if n.endswith("/manifest.json"):
                    name = n
                    break
        out = dst / "manifest.json"
        out.write_bytes(zf.read(name))
        return out


def _render_updater_bat(job: dict) -> str:
    """生成 updater.bat（cmd 脚本，不依赖 Python，避免文件占用）。

    编码用 GBK 写出（cmd 默认代码页），路径用双引号包住；
    robocopy 退出码 0-7 都算成功，>=8 触发回滚。每一步独立检查。
    """
    root = job["root"]
    staging = job["staging"]
    backup = job["backup"]
    pid = job["pid"]
    relaunch = " ".join('"' + a + '"' for a in job["relaunch"])
    lines = [
        "@echo off",
        "title iChen Updater",
        "echo [iChen] 等待中枢退出 (PID " + str(pid) + ") ...",
        # 等 PID 退出：最多 60 次 × 0.5s
        "set /a n=0",
        ":wait_exit",
        "tasklist /FI \"PID eq " + str(pid) + "\" | find \"" + str(pid) + "\" >nul",
        "if errorlevel 1 goto do_update",
        "set /a n+=1",
        "if %n% GEQ 60 goto restore",
        "ping -n 1 -w 500 127.0.0.1 >nul",
        "goto wait_exit",
        ":do_update",
        "echo [iChen] 正在覆盖 system/ ...",
        "if exist \"" + staging + "\\system\" (",
        "  robocopy \"" + staging + "\\system\" \"" + root + "\\system\" /MIR /NFL /NDL /NJH /NJS >nul",
        "  if errorlevel 8 goto restore",
        ")",
        "echo [iChen] 正在覆盖 shared/common/ ...",
        "if exist \"" + staging + "\\shared\\common\" (",
        "  robocopy \"" + staging + "\\shared\\common\" \"" + root + "\\shared\\common\" /MIR /NFL /NDL /NJH /NJS >nul",
        "  if errorlevel 8 goto restore",
        ")",
        "echo [iChen] 正在合并 apps/ ...",
        "if exist \"" + staging + "\\apps\" (",
        "  robocopy \"" + staging + "\\apps\" \"" + root + "\\apps\" /E /NFL /NDL /NJH /NJS >nul",
        "  if errorlevel 8 goto restore",
        ")",
        "echo [iChen] 更新完成，启动新版本 ...",
        "rmdir /s /q \"" + staging + "\" >nul 2>&1",
        "del /q \"" + str(JOB_FILE) + "\" >nul 2>&1",
        "cd /d \"" + root + "\"",
        "start \"\" " + relaunch,
        "exit /b 0",
        ":restore",
        "echo [iChen] 更新失败，正在回滚 ...",
        "if exist \"" + backup + "\\system\" robocopy \"" + backup + "\\system\" \"" + root + "\\system\" /MIR /NFL /NDL /NJH /NJS >nul",
        "if exist \"" + backup + "\\shared\\common\" robocopy \"" + backup + "\\shared\\common\" \"" + root + "\\shared\\common\" /MIR /NFL /NDL /NJH /NJS >nul",
        "echo [iChen] 已回滚到旧版本，按任意键退出",
        "pause >nul",
        "exit /b 1",
    ]
    return "\r\n".join(lines) + "\r\n"
