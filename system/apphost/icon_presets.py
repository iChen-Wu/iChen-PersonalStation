"""图标预设（控制台 → App 管理 / 新建与修改图标）。

- 内置预设写在代码里（永远可用，不可删）；
- 用户预设存在 `data/icon_presets/`（`presets.json` 索引 + `<id>.svg` 文件），
  可新增、可删除（「预设可改」）；
- `apply_icon_preset` 把预设 SVG 直接写进 App / 文件夹目录的 `icon.svg`
  并更新 manifest.json / folder.json，与既有的 `set_app_icon` / `set_folder_icon`
  （选择本地文件）共用同一套元数据字段。

图标一律 SVG（对齐全项目约定，禁止 emoji / Unicode 字符当图标）。
"""
import base64
import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from common.paths import DATA_DIR
from system.apphost.app_edit import _node_dir, _safe_under_apps

# 用户预设目录（与业务 App 数据分离，离线整包更新不影响这里）
PRESETS_DIR = DATA_DIR / "icon_presets"
_INDEX_FILE = "presets.json"


def _icon(fill: str, body: str) -> str:
    """统一规格的内置图标：64×64 圆角底色 + 白色图形。"""
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
            '<rect x="4" y="4" width="56" height="56" rx="14" fill="' + fill + '"/>'
            + body + '</svg>')


BUILTIN_PRESETS: List[Dict[str, str]] = [
    {"id": "builtin.grid", "name": "应用格", "svg": _icon(
        "#4c7df0",
        '<rect x="16" y="16" width="13" height="13" rx="3" fill="#fff"/>'
        '<rect x="35" y="16" width="13" height="13" rx="3" fill="#fff"/>'
        '<rect x="16" y="35" width="13" height="13" rx="3" fill="#fff"/>'
        '<rect x="35" y="35" width="13" height="13" rx="3" fill="#fff"/>')},
    {"id": "builtin.doc", "name": "文档", "svg": _icon(
        "#d99a2b",
        '<rect x="21" y="13" width="22" height="38" rx="4" fill="#fff"/>'
        '<g stroke="#d99a2b" stroke-width="3" stroke-linecap="round">'
        '<line x1="27" y1="24" x2="37" y2="24"/>'
        '<line x1="27" y1="32" x2="37" y2="32"/>'
        '<line x1="27" y1="40" x2="33" y2="40"/></g>')},
    {"id": "builtin.folder", "name": "文件夹", "svg": _icon(
        "#4f9d69",
        '<path d="M16 20 h11 l4 5 h17 v20 a3 3 0 0 1 -3 3 H19 a3 3 0 0 1 -3 -3 Z" fill="#fff"/>')},
    {"id": "builtin.terminal", "name": "终端", "svg": _icon(
        "#333b4d",
        '<path d="M21 24 l8 8 -8 8" fill="none" stroke="#fff" stroke-width="4" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
        '<line x1="33" y1="40" x2="43" y2="40" stroke="#fff" stroke-width="4" stroke-linecap="round"/>')},
    {"id": "builtin.music", "name": "音乐", "svg": _icon(
        "#9a5ad0",
        '<path d="M38 18 v22 a6 6 0 1 1 -4 -5.7 V22 l-9 2 v18 a6 6 0 1 1 -4 -5.7 V22 Z" fill="#fff"/>')},
    {"id": "builtin.image", "name": "图片", "svg": _icon(
        "#2f9e9a",
        '<rect x="17" y="18" width="30" height="28" rx="4" fill="none" stroke="#fff" stroke-width="3"/>'
        '<circle cx="26" cy="27" r="3.5" fill="#fff"/>'
        '<path d="M18.5 43 L28 32 l6 6 4 -4 6 9 Z" fill="#fff"/>')},
    {"id": "builtin.globe", "name": "网页", "svg": _icon(
        "#3b82f6",
        '<circle cx="32" cy="32" r="15" fill="none" stroke="#fff" stroke-width="3"/>'
        '<ellipse cx="32" cy="32" rx="7" ry="15" fill="none" stroke="#fff" stroke-width="3"/>'
        '<line x1="17" y1="32" x2="47" y2="32" stroke="#fff" stroke-width="3"/>')},
    {"id": "builtin.bolt", "name": "闪电", "svg": _icon(
        "#e8a33d",
        '<path d="M36 15 L20 35 h10 l-4 14 18 -22 H33 Z" fill="#fff"/>')},
    {"id": "builtin.star", "name": "星标", "svg": _icon(
        "#e05c7a",
        '<path d="M32 16 l4.8 10 11 1.4 -8 7.5 2 10.7 -9.8 -5.3 -9.8 5.3 2 -10.7 -8 -7.5 11 -1.4 Z" fill="#fff"/>')},
    {"id": "builtin.chat", "name": "对话", "svg": _icon(
        "#4f9cf9",
        '<path d="M18 22 a4 4 0 0 1 4 -4 h20 a4 4 0 0 1 4 4 v14 a4 4 0 0 1 -4 4 '
        'H30 l-8 6 v-6 h-4 a4 4 0 0 1 -4 -4 Z" fill="#fff"/>')},
]

_BUILTIN_MAP = {p["id"]: p for p in BUILTIN_PRESETS}


def _data_uri(svg: str) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


def _clean_svg(svg: str) -> Optional[str]:
    """校验并归一化 SVG 文本；非法返回 None。"""
    s = (svg or "").strip()
    low = s.lower()
    i = low.find("<svg")
    if i < 0:
        return None
    s = s[i:]
    if "</svg>" not in s.lower():
        return None
    if len(s) > 200000:
        return None
    return s


def _ensure_dir() -> Path:
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    return PRESETS_DIR


def _load_user() -> List[Dict[str, str]]:
    try:
        data = json.loads((PRESETS_DIR / _INDEX_FILE).read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _save_user(items: List[Dict[str, str]]) -> None:
    _ensure_dir()
    (PRESETS_DIR / _INDEX_FILE).write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_user_svg(item: Dict[str, str]) -> str:
    f = PRESETS_DIR / Path(str(item.get("file") or "")).name
    try:
        return f.read_text(encoding="utf-8")
    except Exception:
        return ""


class IconPresetMixin:
    """图标预设桥（组合进 Api）。"""

    # ==================== 预设列表 / 增删 ====================
    def list_icon_presets(self) -> Dict[str, Any]:
        """列出内置 + 用户预设（带 data URI，前端直接渲染网格）。"""
        out: List[Dict[str, Any]] = []
        for p in BUILTIN_PRESETS:
            out.append({"id": p["id"], "name": p["name"], "builtin": True,
                        "data_uri": _data_uri(p["svg"])})
        for it in _load_user():
            svg = _read_user_svg(it)
            if svg:
                out.append({"id": it.get("id", ""), "name": it.get("name", "") , "builtin": False,
                            "data_uri": _data_uri(svg)})
        return {"ok": True, "presets": out, "dir": str(PRESETS_DIR)}

    def save_icon_preset(self, name: str, svg: str) -> Dict[str, Any]:
        """新增用户预设（从 SVG 文本导入），可反复增删。"""
        clean = _clean_svg(svg)
        if clean is None:
            return {"ok": False, "error": "不是合法的 SVG 文本"}
        nm = (name or "").strip()[:40] or "我的图标"
        pid = "user." + uuid.uuid4().hex[:10]
        fname = uuid.uuid4().hex[:12] + ".svg"
        try:
            _ensure_dir()
            (PRESETS_DIR / fname).write_text(clean, encoding="utf-8")
            items = _load_user()
            items.append({"id": pid, "name": nm, "file": fname})
            _save_user(items)
        except OSError as e:
            return {"ok": False, "error": f"保存预设失败: {e}"}
        return {"ok": True, "preset": {"id": pid, "name": nm, "builtin": False,
                                       "data_uri": _data_uri(clean)}}

    def delete_icon_preset(self, preset_id: str) -> Dict[str, Any]:
        """删除用户预设（内置预设不可删）。"""
        pid = str(preset_id or "").strip()
        if not pid.startswith("user."):
            return {"ok": False, "error": "内置预设不可删除"}
        items = _load_user()
        target = next((it for it in items if it.get("id") == pid), None)
        if target is None:
            return {"ok": False, "error": "预设不存在（可能已删除）"}
        try:
            f = PRESETS_DIR / Path(str(target.get("file") or "")).name
            if f.is_file():
                f.unlink()
            items = [it for it in items if it.get("id") != pid]
            _save_user(items)
        except OSError as e:
            return {"ok": False, "error": f"删除预设失败: {e}"}
        return {"ok": True}

    # ==================== 应用预设到 App / 文件夹 ====================
    def _preset_svg(self, preset_id: str) -> str:
        pid = str(preset_id or "").strip()
        if pid in _BUILTIN_MAP:
            return _BUILTIN_MAP[pid]["svg"]
        for it in _load_user():
            if it.get("id") == pid:
                return _read_user_svg(it)
        return ""

    def apply_icon_preset(self, kind: str, target: str, preset_id: str) -> Dict[str, Any]:
        """把预设图标写成目标目录的 icon.svg，并更新元数据。

        kind: "app"（target = app_id）或 "folder"（target = 相对 apps/ 的路径）。
        """
        svg = self._preset_svg(preset_id)
        if not svg:
            return {"ok": False, "error": "预设图标不存在（可能已删除）"}
        k = str(kind or "").strip().lower()
        if k == "app":
            d = _node_dir(target)
            if d is None or not (d / "manifest.json").is_file():
                return {"ok": False, "error": f"未找到 App: {target}"}
        elif k == "folder":
            d = _safe_under_apps(target)
            if d is None or not d.is_dir():
                return {"ok": False, "error": f"目录不存在: {target}"}
        else:
            return {"ok": False, "error": "kind 只能是 app 或 folder"}
        try:
            (d / "icon.svg").write_text(svg, encoding="utf-8")
        except OSError as e:
            return {"ok": False, "error": f"写入图标失败: {e}"}
        if k == "app":
            return self.set_app_meta(target, {"icon": "icon.svg"})
        return self.set_folder_meta(target, {"icon": "icon.svg"})
