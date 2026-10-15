"""miniapp 导入导出 —— App 打包（.miniapp = zip）与落位。

包布局（zip 内）::

    <app目录名>/manifest.json ...   # App 全部文件（含 requires 声明）
    __pkg__/pkg.json                # 打包清单：app_dir / shared / py_pure / pip_required
    __pkg__/shared/<模块>/...       # 依赖的 shared 模块整目录（排除数据与缓存）
    __pkg__/pylibs/...              # 纯 Python 的第三方库（直接拷贝可用）

manifest 的依赖声明（可选字段，缺省视为无依赖）::

    "requires": { "shared": ["GYun"], "py": ["requests", "pip:beautifulsoup4"] }

- shared：写 shared/ 下的模块目录名；整模块打包，数据库（*.db、data/ 目录）绝不进包。
- py：写 import 用的模块名（requests / bs4）；带二进制的库（pywebview、Pillow 等）
  无法跨机拷贝，导出时自动转入 pip_required 清单；`pip:xxx` 前缀直接按 pip 包名
  记入 pip_required。导入时 pip_required 统一 `pip install --target data/pylibs`。
"""
import importlib
import importlib.util
import json
import re
import shutil
import site
import subprocess
import sys
import sysconfig
import zipfile
from pathlib import Path
from typing import Any, Dict, List

try:
    from common.paths import PROJECT_ROOT, PYLIBS_DIR
except Exception:  # shared 未上 sys.path 时退回相对定位（项目根 = apphost 的上两级）
    PROJECT_ROOT = Path(__file__).resolve().parents[2]
    PYLIBS_DIR = PROJECT_ROOT / "data" / "pylibs"

SHARED_ROOT = PROJECT_ROOT / "shared"
APPS_ROOT = PROJECT_ROOT / "apps"

_PKG_DIR = "__pkg__"
_PKG_META = _PKG_DIR + "/pkg.json"
_ZIP_SUFFIX = ".miniapp"
_MOD_NAME_OK = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SKIP_DIR_NAMES = {"__pycache__", "data"}      # 打包 shared 时跳过的目录名
_SKIP_FILE_SUFFIXES = {".db", ".pyc", ".pyo"}  # 数据与缓存一律不进包


def ensure_pylibs_path() -> None:
    """把 data/pylibs 挂上 sys.path（miniapp 导入的第三方库落点），进程内 core 可直接 import。

    用 site.addsitedir 而非 sys.path.insert：追加到末尾（不遮蔽系统/已装包）、
    会处理目录里的 .pth 文件，且幂等——pip 新装包后再调一次即可免重启中枢
    （此前 import 失败的已运行 App 只需在后台列表里「重启」该实例，不用重启中枢）。"""
    try:
        PYLIBS_DIR.mkdir(parents=True, exist_ok=True)
        site.addsitedir(str(PYLIBS_DIR))
    except OSError:
        pass


ensure_pylibs_path()


# ==================== 导出 ====================

def _collect_shared(module: str, zf: zipfile.ZipFile) -> None:
    """把 shared/<module> 整目录写进 zip 的 __pkg__/shared/<module>（跳过数据/缓存）。"""
    src = SHARED_ROOT / module
    base = src.resolve()
    for path in sorted(src.rglob("*")):
        rel = path.resolve().relative_to(base)
        parts = rel.parts
        if path.is_dir():
            if path.name in _SKIP_DIR_NAMES:
                continue  # 不进入（rglob 还会给出其子项，用 parts 前缀过滤即可）
            continue
        if any(p in _SKIP_DIR_NAMES for p in parts[:-1]):
            continue
        if path.suffix.lower() in _SKIP_FILE_SUFFIXES:
            continue
        zf.write(path, f"{_PKG_DIR}/shared/{module}/{rel.as_posix()}")


def _is_stdlib(origin: str) -> bool:
    try:
        stdlib = sysconfig.get_paths()["stdlib"]
        return Path(origin).resolve().is_relative_to(Path(stdlib).resolve())
    except (ValueError, OSError, KeyError):
        return False


def _has_binary_ext(folder: Path) -> bool:
    return any(p.suffix.lower() in {".pyd", ".so", ".dll"} for p in folder.rglob("*") if p.is_file())


def _collect_py(entry: str, zf: zipfile.ZipFile, meta: Dict[str, Any]) -> None:
    """按模块名收集一个第三方库；带二进制 / 找不到的记入 pip_required（导入时 pip 安装）。"""
    pip_required: List[str] = meta["pip_required"]
    py_pure: List[str] = meta["py_pure"]
    if entry.startswith("pip:"):
        name = entry[4:].strip()
        if name:
            pip_required.append(name)
        return
    name = entry.strip()
    if not _MOD_NAME_OK.match(name):
        pip_required.append(entry)  # 非常规写法（如带版本号的 pip 名），交给导入端 pip
        return
    try:
        spec = importlib.util.find_spec(name)
    except (ImportError, ValueError, ModuleNotFoundError):
        spec = None
    if spec is None or not spec.origin:
        pip_required.append(name)
        return
    if _is_stdlib(spec.origin):
        return  # 标准库不打包
    if spec.submodule_search_locations:  # 包
        folder = Path(list(spec.submodule_search_locations)[0])
        if _has_binary_ext(folder):
            pip_required.append(name)
            return
        base = folder.resolve()
        for path in sorted(folder.rglob("*")):
            if path.is_dir() or path.name in _SKIP_DIR_NAMES or path.suffix.lower() in _SKIP_FILE_SUFFIXES:
                continue
            zf.write(path, f"{_PKG_DIR}/pylibs/{name}/{path.resolve().relative_to(base).as_posix()}")
    else:  # 单文件模块
        if Path(spec.origin).suffix.lower() != ".py":
            pip_required.append(name)
            return
        zf.write(Path(spec.origin), f"{_PKG_DIR}/pylibs/{name}.py")
    py_pure.append(name)


def export_miniapp(app_id: str, target: str) -> Dict[str, Any]:
    """把 App（含声明的 shared 模块与纯 py 库）打包为 .miniapp。target 为前端保存对话框给的绝对路径。"""
    from system.apphost.app_edit import _node_dir, _read_json

    d = _node_dir(app_id)
    if d is None or not (d / "manifest.json").is_file():
        return {"ok": False, "error": f"未找到 App: {app_id}"}
    target_path = Path(target or "")
    if target_path.suffix.lower() != _ZIP_SUFFIX:
        target_path = target_path.with_suffix(_ZIP_SUFFIX)
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return {"ok": False, "error": f"保存位置不可用: {e}"}

    manifest = _read_json(d / "manifest.json")
    req = manifest.get("requires") or {}
    shared_list = [s for s in (req.get("shared") or []) if isinstance(s, str)]
    meta: Dict[str, Any] = {
        "format": 1,
        "app_dir": d.name,
        "shared": [],
        "py_pure": [],
        "pip_required": [],
    }
    try:
        with zipfile.ZipFile(target_path, "w", zipfile.ZIP_DEFLATED) as zf:
            base = d.resolve()
            for path in sorted(d.rglob("*")):
                if path.is_dir() or path.name in _SKIP_DIR_NAMES or path.suffix.lower() in _SKIP_FILE_SUFFIXES:
                    continue
                rel = path.resolve().relative_to(base)
                if any(p in _SKIP_DIR_NAMES for p in rel.parts[:-1]):
                    continue
                zf.write(path, f"{d.name}/{rel.as_posix()}")
            for mod in shared_list:
                if not _MOD_NAME_OK.match(mod) or not (SHARED_ROOT / mod).is_dir():
                    continue
                _collect_shared(mod, zf)
                meta["shared"].append(mod)
            for entry in (req.get("py") or []):
                if isinstance(entry, str):
                    _collect_py(entry, zf, meta)
            zf.writestr(_PKG_META, json.dumps(meta, ensure_ascii=False, indent=2))
    except OSError as e:
        return {"ok": False, "error": f"打包失败: {e}"}
    return {
        "ok": True,
        "path": str(target_path),
        "shared": meta["shared"],
        "py_pure": meta["py_pure"],
        "pip_required": meta["pip_required"],
    }


# ==================== 导入 ====================

def _safe_members(zf: zipfile.ZipFile) -> List[zipfile.ZipInfo]:
    """过滤 zip 成员：拒绝绝对路径 / .. / 盘符（防 zip slip）。"""
    ok: List[zipfile.ZipInfo] = []
    for m in zf.infolist():
        name = m.filename.replace("\\", "/")
        p = Path(name)
        if p.is_absolute() or ".." in p.parts or (len(p.parts) and p.parts[0].endswith(":")):
            continue
        ok.append(m)
    return ok


def import_miniapp(zip_path: str, parent_dir: str = "", conflict: str = "") -> Dict[str, Any]:
    """导入 .miniapp：App 落位 apps/<parent_dir>/，shared 缺则补，纯 py 库解到 data/pylibs，
    pip_required 后台 pip 安装。conflict='overwrite' 时覆盖同 id 的既有 App。"""
    from system.apphost.app_edit import _node_dir, _safe_under_apps, _read_json

    src = Path(zip_path or "")
    if not src.is_file():
        return {"ok": False, "error": f"找不到包文件: {zip_path}"}
    parent = _safe_under_apps(parent_dir) if parent_dir else APPS_ROOT.resolve()
    if parent is None or not parent.is_dir():
        return {"ok": False, "error": f"目标目录不存在: {parent_dir}"}

    try:
        zf = zipfile.ZipFile(src)
    except (zipfile.BadZipFile, OSError) as e:
        return {"ok": False, "error": f"无法读取包: {e}"}
    with zf:
        names = {m.filename.replace("\\", "/") for m in _safe_members(zf)}
        if _PKG_META not in names:
            return {"ok": False, "error": "不是有效的 miniapp 包（缺少 __pkg__/pkg.json）"}
        try:
            meta = json.loads(zf.read(_PKG_META).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {"ok": False, "error": "pkg.json 损坏"}
        app_dir_name = str(meta.get("app_dir") or "")
        if not app_dir_name or "/" in app_dir_name or ".." in app_dir_name:
            return {"ok": False, "error": "pkg.json 的 app_dir 非法"}

        # id 冲突：同 id 已存在 → 需要用户决定（更新覆盖 / 取消）
        manifest_name = f"{app_dir_name}/manifest.json"
        if manifest_name not in names:
            return {"ok": False, "error": f"包内缺少 {manifest_name}"}
        try:
            manifest = json.loads(zf.read(manifest_name).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {"ok": False, "error": "包内 manifest.json 损坏"}
        app_id = str(manifest.get("id") or "")
        existing = _node_dir(app_id) if app_id else None
        if existing is not None:
            if conflict != "overwrite":
                # 返回双方版本号，前端据此引导「更新」而非报错
                local_ver = str((_read_json(existing / "manifest.json") or {}).get("version") or "")
                return {"ok": False, "conflict": "app_exists", "app_id": app_id,
                        "local_version": local_ver,
                        "pkg_version": str(manifest.get("version") or ""),
                        "error": f"已存在同 id 的 App: {app_id}"}
            if existing.resolve().is_dir() and (existing.resolve() / "manifest.json").is_file():
                shutil.rmtree(existing.resolve())
        target_app = parent / app_dir_name
        if target_app.exists():
            return {"ok": False, "error": f"目标已存在同名目录: {app_dir_name}（换分区或先删除）"}

        result: Dict[str, Any] = {"ok": True, "id": app_id, "path": str(target_app),
                                  "shared_installed": [], "shared_skipped": [],
                                  "py_installed": [], "pip_required": list(meta.get("pip_required") or []),
                                  "pip_failed": []}

        # 1) App 本体：解包到 apps/<parent>/<zip 内路径>（zip 内路径以 app_dir 开头）
        parent_res = parent.resolve()
        for m in _safe_members(zf):
            name = m.filename.replace("\\", "/")
            if name == _PKG_META or name.startswith(_PKG_DIR + "/"):
                continue
            dest = (parent_res / name).resolve()
            if not str(dest).startswith(str(parent_res) + str(Path("/"))):
                continue  # 双保险：只落在目标分区下
            if m.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(m) as fsrc, open(dest, "wb") as fdst:
                shutil.copyfileobj(fsrc, fdst)

        # 2) shared 模块：本地已有 → 跳过（不覆盖）；没有 → 解包补齐
        shared_root = SHARED_ROOT.resolve()
        for mod in meta.get("shared") or []:
            if not _MOD_NAME_OK.match(str(mod)):
                continue
            if (SHARED_ROOT / mod).exists():
                result["shared_skipped"].append(mod)
                continue
            prefix = f"{_PKG_DIR}/shared/{mod}/"
            for m in _safe_members(zf):
                name = m.filename.replace("\\", "/")
                if not name.startswith(prefix):
                    continue
                rel = name[len(prefix):]
                dest = (shared_root / mod / rel).resolve()
                if not str(dest).startswith(str(shared_root) + str(Path("/"))):
                    continue
                if m.is_dir():
                    dest.mkdir(parents=True, exist_ok=True)
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(m) as fsrc, open(dest, "wb") as fdst:
                    shutil.copyfileobj(fsrc, fdst)
            result["shared_installed"].append(mod)

        # 3) 纯 py 库 → data/pylibs（已在 sys.path）
        try:
            PYLIBS_DIR.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        pylibs_root = PYLIBS_DIR.resolve()
        for m in _safe_members(zf):
            name = m.filename.replace("\\", "/")
            if not name.startswith(f"{_PKG_DIR}/pylibs/"):
                continue
            rel = name[len(_PKG_DIR) + len("/pylibs/"):]
            dest = (pylibs_root / rel).resolve()
            if not str(dest).startswith(str(pylibs_root) + str(Path("/"))):
                continue
            if m.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(m) as fsrc, open(dest, "wb") as fdst:
                shutil.copyfileobj(fsrc, fdst)
            result["py_installed"].append(rel)

    # 4) pip_required：--target 装到 data/pylibs（与解包落点一致）；失败不阻断导入
    if result["pip_required"]:
        try:
            PYLIBS_DIR.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(
                [sys.executable, "-m", "pip", "install", "--target", str(PYLIBS_DIR),
                 "--quiet", *result["pip_required"]],
                capture_output=True, text=True, timeout=600,
            )
            if r.returncode != 0:
                result["pip_failed"] = list(result["pip_required"])
                result["pip_error"] = (r.stderr or r.stdout or "").strip()[-500:]
        except (subprocess.TimeoutExpired, OSError) as e:
            result["pip_failed"] = list(result["pip_required"])
            result["pip_error"] = str(e)
        finally:
            # 新装包立即生效：刷新目录缓存 + 重挂 pylibs（处理可能的 .pth），免重启中枢
            importlib.invalidate_caches()
            ensure_pylibs_path()

    return result


class MiniappMixin:
    """miniapp 导入导出（组合进 Api，供 pywebview js_api 调用）"""

    def export_miniapp(self, app_id: str, target: str) -> Dict[str, Any]:
        """打包 App 为 .miniapp（target 为保存对话框返回的路径）。"""
        return export_miniapp(app_id, target)

    def import_miniapp(self, zip_path: str, parent_dir: str = "", conflict: str = "") -> Dict[str, Any]:
        """导入 .miniapp 包。conflict='overwrite' 表示用户已确认覆盖同 id 的既有 App。"""
        return import_miniapp(zip_path, parent_dir, conflict)
