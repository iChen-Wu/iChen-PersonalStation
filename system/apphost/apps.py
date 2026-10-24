"""iChen 前端 - App 盒子桥（apps/ 目录树扫描 + core.run 运行时）

对应《App 接入规范（初始测试）》：
- 含 manifest.json 的目录 = App（叶子，不再下钻）
- 含 folder.json 的目录 = 分类（可下钻；图标/排序/改名覆盖）
- 都无 = 普通文件夹（按目录名显示为分类，兜底）
- order 仅同层生效（小在前），缺省按名称排；App 与分类同层按各自 order 混合排序

本模块尽量保持模块级纯函数，便于脱离 pywebview 单测。
"""
import atexit
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

try:
    from GYun.core.constants import PROJECT_ROOT
except Exception:  # GYun 未安装时退回相对定位（项目根 = shell 的上级）
    PROJECT_ROOT = Path(__file__).resolve().parents[2]

try:
    from common.paths import APPDATA_DIR
except Exception:  # shared 未上 sys.path 时退回相对构造（与 common.paths 同位置）
    APPDATA_DIR = PROJECT_ROOT / "data" / "appdata"

APPS_ROOT = PROJECT_ROOT / "apps"

_SKIP_DIRS = {"__pycache__"}

# pick_files 的过滤预设：App 只能按预设名申请，避免任意 file_types 串
_PICK_FILETYPES = {
    "image": ("图片 (*.png;*.jpg;*.jpeg;*.bmp;*.webp)", "所有文件 (*.*)"),
    "svg": ("SVG 图标 (*.svg)", "所有文件 (*.*)"),
    "json": ("JSON (*.json)", "所有文件 (*.*)"),
    "miniapp": ("iChen App 包 (*.miniapp)", "所有文件 (*.*)"),
    "zip": ("iChen 更新包 (*.zip)", "所有文件 (*.*)"),
    "all": ("所有文件 (*.*)",),
}


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _uri(path: Path) -> str:
    """绝对 file URI（供 file:// 页面下的 img / iframe 使用）"""
    try:
        return path.resolve().as_uri()
    except Exception:
        return ""


def _safe_child(base: Path, rel: str):
    """把 manifest 里的相对路径解析到 base 之内；越界返回 None。

    安全要求（《App 接入规范》第十节）：entry / ui / icon 必须是 App 目录内的
    相对路径；绝对路径、盘符路径、以 .. 越出 base 者一律拒绝。
    """
    if not rel or not str(rel).strip():
        return None
    raw = str(rel).strip().replace("\\", "/")
    p = Path(raw)
    if p.is_absolute() or p.drive or raw.startswith("/"):
        return None
    try:
        root = base.resolve()
        resolved = (root / raw).resolve()
    except OSError:
        return None
    if resolved != root and root in resolved.parents:
        return resolved
    return None


def _icon_uri(base: Path, icon: str) -> str:
    p = _safe_child(base, icon)
    return _uri(p) if p and p.exists() else ""


def _icon_data(base: Path, icon: str) -> str:
    """icon.svg 内容转 base64 data URI（<img> 直接可用，不依赖 file:// 子资源加载）"""
    p = _safe_child(base, icon)
    if p is None:
        return ""
    try:
        raw = p.read_bytes()
    except OSError:
        return ""
    import base64
    return "data:image/svg+xml;base64," + base64.b64encode(raw).decode("ascii")


def _name(info: Dict[str, Any], fallback: str) -> str:
    return (info.get("name") or "").strip() or fallback


def _sort_key(node: Dict[str, Any]) -> tuple:
    order = node.get("order")
    name = (node.get("name") or node.get("id") or "").casefold()
    if isinstance(order, (int, float)):
        return (0, float(order), name)
    return (1, 0.0, name)


def _scan_dir(base: Path, top: Path) -> List[Dict[str, Any]]:
    """扫描一个目录的所有直接子项（folder / app 混合），返回排序后的节点列表。

    top 为"相对路径基准"（通常 = APPS_ROOT），保证节点 path 始终相对 apps 根，
    这样 scan_apps(zone=...) 与整树扫描得到的 path 语义一致（供 run_app 定位）。
    """
    try:
        entries = [p for p in base.iterdir() if p.is_dir() and p.name not in _SKIP_DIRS and not p.name.startswith(".")]
    except OSError:
        return []

    nodes: List[Dict[str, Any]] = []
    for d in sorted(entries):
        manifest_path = d / "manifest.json"
        folder_path = d / "folder.json"
        rel = d.relative_to(top).as_posix()

        if manifest_path.exists():
            info = _read_json(manifest_path)
            node = {
                "type": "app",
                "name": _name(info, d.name),
                "id": (info.get("id") or "").strip() or rel,
                "version": info.get("version") or "",
                "description": (info.get("description") or "").strip(),
                "icon": info.get("icon") or "",
                "icon_uri": _icon_uri(d, info.get("icon") or ""),
                "icon_data": _icon_data(d, info.get("icon") or ""),
                "order": info.get("order"),
                "entry": (info.get("entry") or "core.py").strip(),
                "ui": (info.get("ui") or "ui/index.html").strip(),
                # manifest 的 type（logic/ui/chat/url）——节点自身的 type 是 app/folder，故换个键名
                "app_type": (info.get("type") or "").strip(),
                "url": (info.get("url") or "").strip(),
                "container": (info.get("container") or "").strip(),
                "path": rel,
                "dir": _uri(d),
            }
            nodes.append(node)
            continue

        if folder_path.exists():
            info = _read_json(folder_path)
            node = {
                "type": "folder",
                "name": _name(info, d.name),
                "description": (info.get("description") or "").strip(),
                "icon": info.get("icon") or "",
                "icon_uri": _icon_uri(d, info.get("icon") or ""),
                "icon_data": _icon_data(d, info.get("icon") or ""),
                "order": info.get("order"),
                "path": rel,
                "children": _scan_dir(d, top),
            }
            nodes.append(node)
            continue

        # 普通文件夹兜底（可下钻，无信息）
        nodes.append({
            "type": "folder",
            "name": d.name,
            "description": "",
            "icon": "",
            "icon_uri": "",
            "icon_data": "",
            "order": None,
            "path": rel,
            "children": _scan_dir(d, top),
        })

    nodes.sort(key=_sort_key)
    return nodes


def scan_apps_tree(root: Path = APPS_ROOT, top: Path = None) -> Dict[str, Any]:
    """扫描 apps/ 根目录（或指定 root），返回目录树。top = 相对路径基准，默认 APPS_ROOT。

    输出：
        {
          "root": "<apps 绝对 URI>",
          "app_count": int,
          "tree": [ {folder|app 节点}, ... ],
          "error": null | str,
        }
    """
    top = Path(top) if top is not None else APPS_ROOT
    result: Dict[str, Any] = {
        "root": _uri(root),
        "app_count": 0,
        "tree": [],
        "error": None,
    }
    if not root.exists():
        result["error"] = f"apps 根目录不存在: {root}"
        return result
    try:
        result["tree"] = _scan_dir(root, top)
    except Exception as e:
        result["error"] = str(e)
        return result

    def _count(nodes: List[Dict[str, Any]]) -> int:
        n = 0
        for node in nodes:
            if node.get("type") == "app":
                n += 1
            elif node.get("children"):
                n += _count(node["children"])
        return n

    result["app_count"] = _count(result["tree"])
    return result


def scan_zones_tree(root: Path = APPS_ROOT) -> Dict[str, Any]:
    """扫描 apps/ 的一级目录 = 主体（Tab）列表。

    每个一级目录是一个 zone；folder.json 提供显示名/图标/顺序（缺省用目录名）。
    App 根层不再直接放 App：一级目录即分区。
    """
    result: Dict[str, Any] = {"root": _uri(root), "zones": [], "error": None}
    if not root.exists():
        result["error"] = f"apps 根目录不存在: {root}"
        return result
    try:
        entries = [p for p in root.iterdir()
                   if p.is_dir() and p.name not in _SKIP_DIRS and not p.name.startswith(".")]
    except OSError as e:
        result["error"] = str(e)
        return result

    zones: List[Dict[str, Any]] = []
    for d in sorted(entries):
        folder_path = d / "folder.json"
        info = _read_json(folder_path) if folder_path.exists() else {}
        zones.append({
            "key": d.name,
            "type": "zone",
            "name": _name(info, d.name),
            "icon": info.get("icon") or "",
            "icon_uri": _icon_uri(d, info.get("icon") or ""),
            "icon_data": _icon_data(d, info.get("icon") or ""),
            "order": info.get("order"),
            "description": (info.get("description") or "").strip(),
            "path": d.name,
        })
    zones.sort(key=_sort_key)
    result["zones"] = zones
    return result


def find_app_node(root: Path, app_id: str, top: Path = None) -> Dict[str, Any]:
    """在扫描树中按 id 查找 App 节点（供 run_app 定位目录）。"""
    def _walk(nodes: List[Dict[str, Any]]):
        for node in nodes:
            if node.get("type") == "app" and node.get("id") == app_id:
                return node
            if node.get("children"):
                found = _walk(node["children"])
                if found:
                    return found
        return None
    return _walk(scan_apps_tree(root, top).get("tree", [])) or {}


# ==================== App 运行时（core.run 动态加载） ====================

def _module_name_for(app_id: str) -> str:
    """app_id（如 demo.hello）→ 安全模块名（ichen_app_demo_hello）"""
    return "ichen_app_" + re.sub(r"\W", "_", app_id)


# app_id -> (core_path, mtime, module)：
# 缓存 App 模块，使 core.py 的模块级状态（后台线程 / 句柄 / 连接）在多次 run 之间存活；
# 文件 mtime 变化则重新加载（改 core 后刷新生效），换载前先调旧模块的 teardown()。
_MODULE_CACHE: Dict[str, Any] = {}


def _call_teardown(module) -> None:
    """调用模块的可选生命周期钩子 teardown()，异常不外抛。"""
    fn = getattr(module, "teardown", None)
    if callable(fn):
        try:
            fn()
        except Exception as e:
            print(f"[apphost] {getattr(module, '__name__', '?')}.teardown() 异常: {e}")


def _load_app_module(app_id: str, core_path: Path):
    """取 App core 模块（缓存复用 + mtime 热更）。

    - mtime 未变：直接返回缓存模块（模块级后台资源持续可引用）
    - mtime 变化 / 首次：换载；旧模块若定义了 teardown() 先调用以回收资源
    """
    name = _module_name_for(app_id)
    try:
        mtime = core_path.stat().st_mtime
    except OSError:
        mtime = None

    cached = _MODULE_CACHE.get(app_id)
    if cached and cached[0] == core_path and cached[1] == mtime:
        return cached[2]

    if cached:
        _call_teardown(cached[2])

    spec = importlib.util.spec_from_file_location(name, core_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载 {core_path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules.pop(name, None)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    # 注入 App 私有数据目录（data/appdata/<app_id>）：core 在 run()/函数内
    # 可直接读全局 APP_DATA_DIR（模块顶层引用不可行——注入发生在模块执行之后）
    try:
        _appdata = APPDATA_DIR / app_id
        _appdata.mkdir(parents=True, exist_ok=True)
        module.APP_DATA_DIR = str(_appdata)
    except OSError:
        pass
    _MODULE_CACHE[app_id] = (core_path, mtime, module)
    return module


def teardown_app(app_id: str) -> Dict[str, Any]:
    """实例终止时回收 App 的后台资源：调用 core.py 的可选 teardown() 并移出缓存。

    App 起的后台线程 / 端口 / 句柄应在 `teardown()` 里释放；
    未定义该钩子的纯计算 App 调用此方法是空操作。
    """
    entry = _MODULE_CACHE.pop(app_id, None)
    sys.modules.pop(_module_name_for(app_id), None)
    if not entry:
        return {"ok": True, "cached": False}
    module = entry[2]
    if not callable(getattr(module, "teardown", None)):
        return {"ok": True, "cached": True, "teardown": False}
    try:
        module.teardown()
        return {"ok": True, "cached": True, "teardown": True}
    except Exception as e:
        return {"ok": False, "error": f"{app_id} teardown 异常: {type(e).__name__}: {e}"}


def _teardown_all() -> None:
    """中枢进程退出时回收所有缓存 App 的后台资源。"""
    for app_id in list(_MODULE_CACHE.keys()):
        entry = _MODULE_CACHE.pop(app_id, None)
        if entry:
            _call_teardown(entry[2])


atexit.register(_teardown_all)


def call_app(app_id: str, action: str = "run", payload: Dict[str, Any] = None,
             root: Path = APPS_ROOT, _depth: int = 0) -> Dict[str, Any]:
    """按 id 调用另一个 App 的 `core.run()` —— **运行时解析**，App 可随意搬移 / 改名。

    与旧的「import 直调」的区别：不写死模块路径，对方改名或换目录后仍能定位。
    回执结构与桥回执一致：`{"app", "action", "ok", ...}`。
    """
    if _depth > 8:
        return {"app": app_id, "action": action, "ok": False,
                "error": "App 互调层级过深（可能存在循环调用）"}
    node = find_app_node(root, app_id or "")
    if not node:
        return {"app": app_id, "action": action, "ok": False, "error": f"未找到 App: {app_id}"}
    if node.get("type") != "app":
        return {"app": app_id, "action": action, "ok": False,
                "error": f"{app_id} 不是 App（分类 / 文件夹不能调用）"}
    app_dir = root / node.get("path", "")
    result = run_core(app_dir, node.get("entry") or "core.py", app_id,
                      action or "run", payload or {}, _depth=_depth + 1)
    return {"app": app_id, "action": action or "run", **result}


def run_core(app_dir: Path, entry: str, app_id: str, action: str, payload: Dict[str, Any],
             _depth: int = 0) -> Dict[str, Any]:
    """动态加载 App 的 core.run(params) 并执行，任何异常都收口为 ok:false，不向上抛。

    params = {"action": action, "payload": payload}（对接入规范：action 透传进 run）
    模块按 app_id 缓存（见 _load_app_module）：core.py 的后台资源跨调用存活，
    实例终止时由 teardown_app() 回收。
    """
    core_path = _safe_child(app_dir, entry)
    if core_path is None:
        return {"ok": False, "error": f"入口路径非法（必须在 App 目录内）: {entry}"}
    if not core_path.exists():
        return {"ok": False, "error": f"缺少逻辑入口 {entry}（纯界面 App 无 core.py）"}

    try:
        module = _load_app_module(app_id, core_path)
    except Exception as e:
        return {"ok": False, "error": f"加载 {core_path.name} 失败: {e}"}

    fn = getattr(module, "run", None)
    if not callable(fn):
        return {"ok": False, "error": f"{entry} 缺少 run(params) 入口"}

    # 注入 App 互调能力：core.py 里可写 `ichen_call("other.app", "action", {...})`
    # 按 id 运行时解析，不写死模块路径。
    def _ichen_call(target_id: str, act: str = "run", pay: Dict[str, Any] = None):
        return call_app(target_id, act, pay, root=APPS_ROOT, _depth=_depth + 1)

    module.ichen_call = _ichen_call

    try:
        params: Dict[str, Any] = {"action": action}
        if payload:
            params["payload"] = payload
        result = fn(params)
        if not isinstance(result, dict):
            return {"ok": True, "data": result}
        out = dict(result)
        out.setdefault("ok", True)
        return out
    except Exception as e:
        return {"ok": False, "error": f"{app_id} 执行异常: {type(e).__name__}: {e}"}


class AppsMixin:
    """apps/ 分区与目录树扫描 + App 运行时（组合进 Api，供 pywebview js_api 调用）"""

    def scan_apps(self, zone: str = None) -> Dict[str, Any]:
        """扫描目录树（手动刷新入口）。

        zone 指定（如 "work"）时只扫该一级分区；否则返回整树（设置页 App 总数用）。
        """
        if zone:
            name = str(zone).strip()
            # 只允许分区目录名（拒绝 .. / a/b / 绝对路径 等越界写法）
            if not name or name in (".", "..") or name != Path(name).name:
                return {"root": _uri(APPS_ROOT), "app_count": 0, "tree": [],
                        "error": f"分区名非法: {zone}"}
            root = APPS_ROOT / name
            if not root.exists() or not root.is_dir():
                return {"root": _uri(APPS_ROOT), "app_count": 0, "tree": [],
                        "error": f"分区不存在: {zone}"}
            return scan_apps_tree(root, APPS_ROOT)
        return scan_apps_tree(APPS_ROOT)

    def scan_zones(self) -> Dict[str, Any]:
        """扫描 apps/ 一级目录 → 主体（Tab）列表（工作区/空间/…），刷新后自动跟随 apps 目录变化"""
        return scan_zones_tree(APPS_ROOT)

    def run_app(self, app_id: str, action: str = None, payload: Dict[str, Any] = None) -> Dict[str, Any]:
        """执行 App 逻辑：定位 app 目录 → 动态加载 entry(core.py) → 调用 run()。

        回执结构：{"app": app_id, "action": action, "ok": bool, ...run 返回值}
        """
        node = find_app_node(APPS_ROOT, app_id or "")
        if not node:
            return {"app": app_id, "action": action, "ok": False, "error": f"未找到 App: {app_id}"}
        app_dir = APPS_ROOT / node.get("path", "")
        result = run_core(app_dir, node.get("entry") or "core.py", app_id,
                          action or "run", payload or {})
        return {"app": app_id, "action": action or "run", **result}

    def terminate_app(self, app_id: str) -> Dict[str, Any]:
        """终止 App 实例的后台部分：调用 core.py 的 teardown() 钩子并移出模块缓存。

        前端在销毁 iframe（界面实例）前调用；App 起的后台线程 / 端口 / 句柄
        必须在自己的 teardown() 里释放。纯界面 / 纯计算 App 无钩子时是空操作。
        """
        result = teardown_app(app_id or "")
        return {"app": app_id, **result}

    def open_app_folder(self, app_id: str) -> Dict[str, Any]:
        """在系统文件管理器中打开 App 所在文件夹（Windows os.startfile）"""
        node = find_app_node(APPS_ROOT, app_id or "")
        if not node:
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        folder = (APPS_ROOT / node.get("path", "")).resolve()
        try:
            import os
            os.startfile(str(folder))  # type: ignore[attr-defined]  # Windows only
            return {"ok": True, "path": str(folder)}
        except Exception as e:
            return {"ok": False, "error": f"无法打开文件夹: {e}"}

    def get_shared_css(self) -> str:
        """返回 shared/common/css 的 tokens + components 文本，供前端注入进 iframe。

        App 不得用相对路径引用 shared；嵌入模式由框架注入（见 App 接入规范第五节）。
        """
        parts = []
        for name in ("tokens.css", "components.css"):
            p = PROJECT_ROOT / "shared" / "common" / "css" / name
            try:
                if p.exists():
                    parts.append(p.read_text(encoding="utf-8"))
            except OSError:
                continue
        return "\n".join(parts)

    def get_app_ui(self, app_id: str) -> Dict[str, Any]:
        """读取 App 的 ui/index.html 文本（供前端 srcdoc 挂载，绕开 file:// 子资源限制）。

        返回 {"ok": True, "html": ..., "dir": <App 目录 file URI>, "ui": <相对 ui 路径>}
        srcdoc 内以 <base href=dir> 指向 App 目录，相对资源仍可解析。
        """
        node = find_app_node(APPS_ROOT, app_id or "")
        if not node:
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        app_dir = APPS_ROOT / node.get("path", "")
        ui = node.get("ui") or "ui/index.html"
        p = _safe_child(app_dir, ui)
        if p is None:
            return {"ok": False, "error": f"界面路径非法（必须在 App 目录内）: {ui}"}
        if not p.exists():
            return {"ok": False, "error": f"缺少界面文件 {ui}（纯逻辑 App 无 ui/）"}
        try:
            html = p.read_text(encoding="utf-8")
        except OSError as e:
            return {"ok": False, "error": f"读取 {ui} 失败: {e}"}
        return {"ok": True, "html": html, "dir": _uri(app_dir), "ui": ui}

    # ==================== 文件通道（App 取本地真实路径的唯一途径） ====================

    def pick_files(self, mode: str = "open", multiple: bool = False,
                   filter: str = "all", default_name: str = "") -> Dict[str, Any]:
        """弹出系统文件对话框，返回用户选中的绝对路径。

        iframe 里的 App 读不到本地路径（srcdoc 跨源 + file:// 限制），需要真实路径时
        经框架申请本方法（App 侧 postMessage `ichen:pick-file`，见 appframe.js）。

        mode:   open（打开文件）/ folder（选目录）/ save（保存文件）
        filter: image / svg / json / all（预设，见 _PICK_FILETYPES）
        返回 {"ok": True, "paths": [...]}；用户取消返回 {"ok": False, "canceled": True}
        """
        if not self._window:
            return {"ok": False, "canceled": True, "error": "窗口未就绪，无法打开文件对话框"}
        try:
            import webview
        except ImportError:
            return {"ok": False, "canceled": True,
                    "error": "pywebview 不可用（浏览器预览模式没有文件对话框）"}

        open_dialog = getattr(webview, "OPEN_DIALOG", 10)
        folder_dialog = getattr(webview, "FOLDER_DIALOG", 20)
        save_dialog = getattr(webview, "SAVE_DIALOG", 30)
        dialog_type = {"open": open_dialog, "folder": folder_dialog,
                       "save": save_dialog}.get(str(mode or "open").strip().lower(), open_dialog)
        file_types = list(_PICK_FILETYPES.get(str(filter or "all").strip().lower(),
                                             _PICK_FILETYPES["all"]))

        try:
            if dialog_type == folder_dialog:
                result = self._window.create_file_dialog(dialog_type)
            elif dialog_type == save_dialog:
                result = self._window.create_file_dialog(
                    dialog_type, save_filename=str(default_name or ""), file_types=file_types)
            else:
                result = self._window.create_file_dialog(
                    dialog_type, allow_multiple=bool(multiple), file_types=file_types)
        except TypeError:
            # 旧版 pywebview 是位置参数签名；再试一次，仍失败则如实报错
            try:
                result = self._window.create_file_dialog(
                    dialog_type, "", bool(multiple), str(default_name or ""), file_types)
            except Exception as e:
                return {"ok": False, "canceled": True, "error": f"文件对话框失败: {e}"}
        except Exception as e:
            return {"ok": False, "canceled": True, "error": f"文件对话框失败: {e}"}

        if isinstance(result, str):
            result = [result]  # SAVE_DIALOG 在部分平台返回单个字符串，统一成列表
        paths = [str(p) for p in (result or []) if str(p).strip()]
        if not paths:
            return {"ok": False, "canceled": True}
        return {"ok": True, "paths": paths}
