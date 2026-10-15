"""App 编辑（控制台 → 设置 → App 管理；对应 V3.0.0 · P4 基础批）。

能力：改名 / 排序 / 移动 / 卸载删除 / 元数据编辑 / 分区与文件夹管理 / 命名冲突杜绝。

安全底线（与《App 接入规范》第十节一致）：
- 一切目标路径都必须落在 `apps/` **之内**，`..` / 绝对路径 / 盘符一律拒绝；
- 命名冲突**在命名时就杜绝**（同名目录直接拒绝，不做覆盖、不做自动改名）；
- 删除只允许删 App 目录或分类文件夹，且要求显式确认。
"""
import json
import re
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from system.apphost.apps import APPS_ROOT, find_app_node

# 目录 / 文件名禁用字符（对齐 Windows 命名规则，避免跨平台踩坑）
_ILLEGAL = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
             *(f"LPT{i}" for i in range(1, 10))}


def _valid_name(name: str) -> Optional[str]:
    """校验一个新的目录 / 文件名；合法返回 None，否则返回原因。"""
    n = (name or "").strip()
    if not n:
        return "名字不能为空"
    if n in (".", ".."):
        return "名字非法"
    if _ILLEGAL.search(n):
        return '名字不能包含 \\ / : * ? " < > |'
    if n.endswith(".") or n.endswith(" "):
        return "名字不能以点或空格结尾"
    if n.split(".")[0].upper() in _RESERVED:
        return f"「{n}」是系统保留名"
    return None


def _safe_under_apps(rel_or_abs: str) -> Optional[Path]:
    """把相对 apps/ 的路径解析成绝对路径；越界返回 None。"""
    raw = str(rel_or_abs or "").replace("\\", "/").strip("/")
    p = Path(raw)
    if p.is_absolute() or p.drive:
        return None
    root = APPS_ROOT.resolve()
    try:
        target = (root / raw).resolve()
    except OSError:
        return None
    if target == root or root in target.parents:
        return target
    return None


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _node_dir(app_id: str) -> Optional[Path]:
    node = find_app_node(APPS_ROOT, app_id or "")
    if not node:
        return None
    return _safe_under_apps(node.get("path", ""))


class AppEditMixin:
    """App / 分区 / 分类 的编辑桥（组合进 Api）。"""

    # ==================== 改名 ====================
    def rename_app(self, app_id: str, new_name: str, rename_folder: bool = True) -> Dict[str, Any]:
        """改 App 显示名；rename_folder=True 时尽量连文件夹一起改。"""
        d = _node_dir(app_id)
        if d is None or not (d / "manifest.json").is_file():
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        name = (new_name or "").strip()
        if not name:
            return {"ok": False, "error": "显示名不能为空"}

        meta = _read_json(d / "manifest.json")
        meta["name"] = name
        try:
            _write_json(d / "manifest.json", meta)
        except OSError as e:
            return {"ok": False, "error": f"写入 manifest 失败: {e}"}

        moved = False
        if rename_folder and d.name != name:
            reason = _valid_name(name)
            if reason:
                return {"ok": True, "folder_renamed": False, "warning": f"显示名已改；文件夹未改（{reason}）"}
            target = d.parent / name
            if target.exists():
                return {"ok": True, "folder_renamed": False,
                        "warning": "显示名已改；文件夹未改（同名目录已存在）"}
            try:
                d.rename(target)
                moved = True
            except OSError as e:
                return {"ok": True, "folder_renamed": False, "warning": f"显示名已改；文件夹未改（{e}）"}
        return {"ok": True, "folder_renamed": moved}

    # ==================== 排序与元数据 ====================
    def set_app_meta(self, app_id: str, meta: Dict[str, Any]) -> Dict[str, Any]:
        """编辑 manifest 的元数据（只接受白名单字段，name/id 受保护）。"""
        d = _node_dir(app_id)
        if d is None or not (d / "manifest.json").is_file():
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        allowed = {"description", "icon", "order", "type", "channel", "url", "container"}
        patch = {k: v for k, v in (meta or {}).items() if k in allowed}
        if not patch:
            return {"ok": False, "error": "没有可改的字段"}
        if "order" in patch:
            try:
                patch["order"] = float(patch["order"])
            except (TypeError, ValueError):
                return {"ok": False, "error": "order 必须是数字"}
        cur = _read_json(d / "manifest.json")
        cur.update(patch)
        try:
            _write_json(d / "manifest.json", cur)
        except OSError as e:
            return {"ok": False, "error": f"写入失败: {e}"}
        return {"ok": True, "meta": cur}

    def set_app_icon(self, app_id: str, src_file: str) -> Dict[str, Any]:
        """把选中的图片复制进 App 目录并设为 manifest 的 icon。"""
        d = _node_dir(app_id)
        if d is None or not (d / "manifest.json").is_file():
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        src = Path(src_file or "")
        if not src.is_file():
            return {"ok": False, "error": f"图标文件不存在: {src_file}"}
        if src.suffix.lower() != ".svg":
            return {"ok": False, "error": "图标只支持 SVG 文件"}
        icon_name = "icon" + src.suffix.lower()
        try:
            shutil.copyfile(src, d / icon_name)
        except OSError as e:
            return {"ok": False, "error": f"复制图标失败: {e}"}
        return self.set_app_meta(app_id, {"icon": icon_name})

    # ==================== 移动 ====================
    def move_app(self, app_id: str, target_dir: str) -> Dict[str, Any]:
        """把 App 移到 apps/ 下的另一个目录（分区或分类，须已存在）。"""
        src = _node_dir(app_id)
        if src is None or not (src / "manifest.json").is_file():
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        dst_dir = _safe_under_apps(target_dir)
        if dst_dir is None or not dst_dir.is_dir():
            return {"ok": False, "error": f"目标目录不存在: {target_dir}"}
        if dst_dir == src.parent:
            return {"ok": False, "error": "目标与当前位置相同"}
        if dst_dir == src or src in dst_dir.parents:
            return {"ok": False, "error": "不能移动到自己的子目录"}
        target = dst_dir / src.name
        if target.exists():
            return {"ok": False, "error": f"目标已存在同名目录: {src.name}（请先改名）"}
        try:
            shutil.move(str(src), str(target))
        except OSError as e:
            return {"ok": False, "error": f"移动失败: {e}"}
        return {"ok": True, "path": str(target.relative_to(APPS_ROOT.resolve()).as_posix())}

    # ==================== 卸载 / 删除 ====================
    def delete_app(self, app_id: str, confirm: bool = False) -> Dict[str, Any]:
        """卸载 App（删除其目录）。必须显式 confirm。"""
        if not confirm:
            return {"ok": False, "error": "需要确认（confirm=True）"}
        d = _node_dir(app_id)
        if d is None or not (d / "manifest.json").is_file():
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        try:
            shutil.rmtree(d)
        except OSError as e:
            return {"ok": False, "error": f"删除失败: {e}"}
        return {"ok": True}

    # ==================== 分区 / 分类管理 ====================
    def create_folder(self, parent_dir: str, name: str, meta: Dict[str, Any] = None) -> Dict[str, Any]:
        """在 parent_dir 下新建分类文件夹（带 folder.json）。"""
        reason = _valid_name(name)
        if reason:
            return {"ok": False, "error": reason}
        parent = _safe_under_apps(parent_dir)
        if parent is None or not parent.is_dir():
            return {"ok": False, "error": f"父目录不存在: {parent_dir}"}
        target = parent / name.strip()
        if target.exists():
            return {"ok": False, "error": f"已存在同名目录: {name}（命名冲突在命名时杜绝）"}
        try:
            target.mkdir()
            info = {"name": name.strip()}
            if isinstance(meta, dict):
                info.update({k: v for k, v in meta.items() if k in {"icon", "order", "description"}})
            _write_json(target / "folder.json", info)
        except OSError as e:
            return {"ok": False, "error": f"创建失败: {e}"}
        return {"ok": True, "path": str(target.relative_to(APPS_ROOT.resolve()).as_posix())}

    def rename_folder(self, path: str, new_name: str) -> Dict[str, Any]:
        """给**分类文件夹**改名（改目录名并同步 folder.json 的 name）。

        注意：分区（apps/ 一级目录）不允许改目录名——分区 key 即目录名，
        改名会破坏所有 App 路径；且分区内若有运行中的 App，目录被锁会
        抛 WinError 5。改分区显示名请走 set_folder_meta（只改 folder.json）。
        """
        reason = _valid_name(new_name)
        if reason:
            return {"ok": False, "error": reason}
        d = _safe_under_apps(path)
        if d is None or not d.is_dir():
            return {"ok": False, "error": f"目录不存在: {path}"}
        if d == APPS_ROOT.resolve():
            return {"ok": False, "error": "不能改 apps/ 根目录名"}
        if d.parent == APPS_ROOT.resolve():
            return {"ok": False, "error": "分区目录名不能改（它是分区标识）；请改显示名（只改 folder.json，不动目录）"}
        target = d.parent / new_name.strip()
        if target.exists():
            return {"ok": False, "error": f"已存在同名目录: {new_name}"}
        try:
            d.rename(target)
            fj = target / "folder.json"
            if fj.is_file():
                info = _read_json(fj)
                info["name"] = new_name.strip()
                _write_json(fj, info)
        except OSError as e:
            hint = "（目录可能被运行中的 App 占用，请先停止相关 App 再改名）" if getattr(e, "winerror", None) == 5 else ""
            return {"ok": False, "error": f"{e}{hint}"}
        return {"ok": True, "path": str(target.relative_to(APPS_ROOT.resolve()).as_posix())}

    def set_folder_meta(self, path: str, meta: Dict[str, Any]) -> Dict[str, Any]:
        """编辑分区 / 分类的 folder.json 元数据（显示名 / 描述 / 图标 / 排序）。

        只改 folder.json，**不动目录名**（目录改名走 rename_folder）。
        普通文件夹（原本无 folder.json）会补建一个。
        """
        d = _safe_under_apps(path)
        if d is None or not d.is_dir():
            return {"ok": False, "error": f"目录不存在: {path}"}
        if d == APPS_ROOT.resolve():
            return {"ok": False, "error": "不能编辑 apps/ 根目录"}
        allowed = {"name", "description", "icon", "order"}
        patch = {k: v for k, v in (meta or {}).items() if k in allowed}
        if not patch:
            return {"ok": False, "error": "没有可改的字段"}
        if "name" in patch and not str(patch["name"]).strip():
            return {"ok": False, "error": "显示名不能为空"}
        if "order" in patch:
            try:
                patch["order"] = float(patch["order"])
            except (TypeError, ValueError):
                return {"ok": False, "error": "order 必须是数字"}
        fj = d / "folder.json"
        info = _read_json(fj) if fj.is_file() else {}
        info.update(patch)
        try:
            _write_json(fj, info)
        except OSError as e:
            return {"ok": False, "error": f"写入失败: {e}"}
        return {"ok": True, "meta": info}

    def set_folder_icon(self, path: str, src_file: str) -> Dict[str, Any]:
        """把选中的图片复制进分区 / 分类目录并设为 folder.json 的 icon。"""
        d = _safe_under_apps(path)
        if d is None or not d.is_dir():
            return {"ok": False, "error": f"目录不存在: {path}"}
        src = Path(src_file or "")
        if not src.is_file():
            return {"ok": False, "error": f"图标文件不存在: {src_file}"}
        if src.suffix.lower() != ".svg":
            return {"ok": False, "error": "图标只支持 SVG 文件"}
        icon_name = "icon" + src.suffix.lower()
        try:
            shutil.copyfile(src, d / icon_name)
        except OSError as e:
            return {"ok": False, "error": f"复制图标失败: {e}"}
        return self.set_folder_meta(path, {"icon": icon_name})

    def delete_folder(self, path: str, confirm: bool = False) -> Dict[str, Any]:
        """删除分类文件夹（可含内容，即「全部删除」）。分区（apps/ 一级目录）也允许删除，
        但必须显式 confirm=True（删除分区=删除整个 Tab 及其所有内容，不可恢复）。"""
        if not confirm:
            return {"ok": False, "error": "需要确认（confirm=True）"}
        d = _safe_under_apps(path)
        if d is None or not d.is_dir():
            return {"ok": False, "error": f"目录不存在: {path}"}
        if d == APPS_ROOT.resolve():
            return {"ok": False, "error": "不能删除 apps 根目录"}
        try:
            shutil.rmtree(d)
        except OSError as e:
            return {"ok": False, "error": f"删除失败: {e}"}
        return {"ok": True}

    def delete_folder_keep_apps(self, path: str, confirm: bool = False) -> Dict[str, Any]:
        """「保留删除」：把文件夹内直接子 App 移到上一级，再删除该文件夹。
        分区（apps/ 一级目录）不支持——App 不能放在 apps/ 根。子文件夹会一并删除。"""
        if not confirm:
            return {"ok": False, "error": "需要确认（confirm=True）"}
        d = _safe_under_apps(path)
        if d is None or not d.is_dir():
            return {"ok": False, "error": f"目录不存在: {path}"}
        if d == APPS_ROOT.resolve():
            return {"ok": False, "error": "不能删除 apps 根目录"}
        parent = d.parent
        if parent == APPS_ROOT.resolve():
            return {"ok": False, "error": "分区不能保留删除（App 不能放在 apps/ 根目录）"}
        moved, failed = 0, []
        for child in d.iterdir():
            if child.is_dir() and (child / "manifest.json").is_file():
                target = parent / child.name
                if target.exists():
                    failed.append(child.name)
                    continue
                try:
                    shutil.move(str(child), str(target))
                    moved += 1
                except OSError as e:
                    failed.append(f"{child.name}: {e}")
        try:
            shutil.rmtree(d)
        except OSError as e:
            return {"ok": False, "error": f"删除文件夹失败: {e}", "moved": moved, "failed": failed}
        return {"ok": True, "moved": moved, "failed": failed}

    # ==================== 查询 ====================
    def list_app_editable(self) -> Dict[str, Any]:
        """列出可编辑的 App（id / name / path / order），供界面渲染。"""
        from system.apphost.apps import scan_apps_tree

        out: List[Dict[str, Any]] = []

        def walk(nodes):
            for n in nodes or []:
                if n.get("type") == "app":
                    out.append({"id": n.get("id"), "name": n.get("name"),
                                "path": n.get("path"), "order": n.get("order")})
                if n.get("children"):
                    walk(n["children"])

        walk(scan_apps_tree(APPS_ROOT).get("tree", []))
        return {"ok": True, "apps": out}

    # ==================== 新建（UI 化 / URL 化） ====================
    def _new_app_dir(self, parent_dir: str, dir_name: str):
        """建一个新 App 目录并返回 (Path, 错误)。目录名冲突直接拒绝。"""
        reason = _valid_name(dir_name)
        if reason:
            return None, reason
        parent = _safe_under_apps(parent_dir)
        if parent is None or not parent.is_dir():
            return None, f"父目录不存在: {parent_dir}"
        target = parent / dir_name.strip()
        if target.exists():
            return None, f"已存在同名目录: {dir_name}（命名冲突在命名时杜绝）"
        return target, None

    def create_app_from_html(self, parent_dir: str, name: str, html: str,
                             app_id: str = None, description: str = "") -> Dict[str, Any]:
        """UI 化新建：粘贴一段 HTML，生成最小 App（允许无 core.py）。"""
        if not (html or "").strip():
            return {"ok": False, "error": "HTML 不能为空"}
        target, err = self._new_app_dir(parent_dir, name)
        if err:
            return {"ok": False, "error": err}
        aid = (app_id or "").strip() or ("ui." + re.sub(r"\W+", "_", name.lower()).strip("_"))
        try:
            target.mkdir()
            _write_json(target / "manifest.json", {
                "name": name.strip(), "id": aid, "version": "0.1.0",
                "description": description or "UI 化新建", "icon": "icon.svg",
                "ui": "ui/index.html", "type": "ui",
            })
            (target / "icon.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                '<rect x="8" y="8" width="48" height="48" rx="12" fill="#dbe7fb"/></svg>',
                encoding="utf-8")
            (target / "ui").mkdir()
            (target / "ui" / "index.html").write_text(html, encoding="utf-8")
        except OSError as e:
            return {"ok": False, "error": f"创建失败: {e}"}
        return {"ok": True, "id": aid, "path": str(target.relative_to(APPS_ROOT.resolve()).as_posix())}

    def create_url_app(self, parent_dir: str, name: str, url: str,
                       app_id: str = None, description: str = "") -> Dict[str, Any]:
        """URL 化新建：生成 URL 型 App（裸 iframe 容器，不注入、不握手）。
        支持带协议（http(s)://）或裸地址（如 192.168.3.78、example.com），
        裸地址自动补 http://。"""
        u = (url or "").strip()
        if not u:
            return {"ok": False, "error": "URL 不能为空"}
        if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", u):
            u = "http://" + u
        if not re.match(r"^https?://", u, re.I):
            return {"ok": False, "error": "URL 必须以 http:// 或 https:// 开头"}
        target, err = self._new_app_dir(parent_dir, name)
        if err:
            return {"ok": False, "error": err}
        aid = (app_id or "").strip() or ("url." + re.sub(r"\W+", "_", name.lower()).strip("_"))
        try:
            target.mkdir()
            _write_json(target / "manifest.json", {
                "name": name.strip(), "id": aid, "version": "0.1.0",
                "description": description or "URL 化新建", "icon": "icon.svg",
                "type": "url", "url": u, "container": "iframe",
            })
            (target / "icon.svg").write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                '<circle cx="32" cy="32" r="22" fill="none" stroke="#7c8aa5" stroke-width="4"/>'
                '<path d="M12 32 h40 M32 12 c10 12 10 28 0 40 M32 12 c-10 12-10 28 0 40" '
                'fill="none" stroke="#7c8aa5" stroke-width="3"/></svg>', encoding="utf-8")
        except OSError as e:
            return {"ok": False, "error": f"创建失败: {e}"}
        return {"ok": True, "id": aid, "path": str(target.relative_to(APPS_ROOT.resolve()).as_posix())}

    # ==================== 导入 / 复制 / 导出 ====================
    def import_app_folder(self, parent_dir: str, src_dir: str, new_name: str = None) -> Dict[str, Any]:
        """文件夹导入：把任意外部文件夹**复制**进 apps/（须含 manifest.json）。"""
        src = Path(str(src_dir or "")).expanduser()
        if not src.is_dir() or not (src / "manifest.json").is_file():
            return {"ok": False, "error": "源文件夹不存在，或其中没有 manifest.json"}
        dir_name = (new_name or "").strip() or src.name
        target, err = self._new_app_dir(parent_dir, dir_name)
        if err:
            return {"ok": False, "error": err}
        try:
            shutil.copytree(src, target)
        except OSError as e:
            return {"ok": False, "error": f"导入失败: {e}"}
        return {"ok": True, "path": str(target.relative_to(APPS_ROOT.resolve()).as_posix())}

    def duplicate_app(self, app_id: str, new_name: str) -> Dict[str, Any]:
        """复制 App：新目录名 = new_name，id 追加后缀避免重复。"""
        src = _node_dir(app_id)
        if src is None or not (src / "manifest.json").is_file():
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        target, err = self._new_app_dir(str(src.parent.relative_to(APPS_ROOT.resolve()).as_posix()), new_name)
        if err:
            return {"ok": False, "error": err}
        try:
            shutil.copytree(src, target)
            meta = _read_json(target / "manifest.json")
            meta["name"] = new_name.strip()
            # id 追加时间戳后缀：连续复制不会撞 id（仅 .copy 会）
            base_id = str(meta.get("id") or "app")
            meta["id"] = base_id + ".copy" + str(int(time.time()))
            _write_json(target / "manifest.json", meta)
        except OSError as e:
            return {"ok": False, "error": f"复制失败: {e}"}
        return {"ok": True, "id": meta["id"],
                "path": str(target.relative_to(APPS_ROOT.resolve()).as_posix())}

    def export_app(self, app_id: str, dest_dir: str) -> Dict[str, Any]:
        """导出 App：把 App 目录**复制**到指定的外部目录。"""
        src = _node_dir(app_id)
        if src is None or not (src / "manifest.json").is_file():
            return {"ok": False, "error": f"未找到 App: {app_id}"}
        dest = Path(str(dest_dir or "")).expanduser()
        if not dest.is_dir():
            return {"ok": False, "error": f"目标目录不存在: {dest_dir}"}
        target = dest / src.name
        if target.exists():
            return {"ok": False, "error": f"目标已存在: {target.name}"}
        try:
            shutil.copytree(src, target)
        except OSError as e:
            return {"ok": False, "error": f"导出失败: {e}"}
        return {"ok": True, "path": str(target)}
