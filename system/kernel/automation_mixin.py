"""自动化模块：规则触发 → 自动执行动作（控制台 → 自动化）

规则结构：
    {
        "id": "<uuid>",
        "name": "规则名",
        "enabled": true,
        "trigger": {
            "type": "app_open" | "cron" | "startup",
            "appId": "<触发 App id>",      # type=app_open 时必填
            "cron": "分 时 日 月 周"        # type=cron 时必填（5 字段）
        },
        "action": {
            "type": "run_app",
            "appId": "<目标 App id>"       # 待后台运行的 App
        },
        "created_at": <unix ts>
    }

触发器：
    - app_open：某个 App 被打开时（前端 AppFrame.open → iChen.Automation.onAppOpen 匹配执行）
    - cron：5 字段 cron 表达式，由后台线程按分钟轮询触发
    - startup：中枢启动时（前端 automation.js init → onStartup 匹配执行）

动作（当前仅）：
    - run_app：后台运行某个 App（前端挂载隐藏实例，前台不变；
      cron 到点时由后端反向推流调用前端 iChen.Automation.startAppBackground）

持久化：data/automation.json
"""
import json
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from common.paths import DATA_DIR
except Exception:  # 极端情况下退回相对定位
    DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

RULES_FILE = DATA_DIR / "automation.json"


class AutomationMixin:
    # ---------- 持久化 ----------
    def _load_rules(self) -> List[Dict[str, Any]]:
        try:
            with open(RULES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            rules = data.get("rules") if isinstance(data, dict) else data
            return rules if isinstance(rules, list) else []
        except Exception:
            return []

    def _save_rules(self, rules: List[Dict[str, Any]]) -> None:
        RULES_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(RULES_FILE, "w", encoding="utf-8") as f:
            json.dump({"rules": rules}, f, ensure_ascii=False, indent=2)

    # ---------- CRUD ----------
    def list_automation_rules(self) -> Dict[str, Any]:
        """列出全部规则（按创建时间倒序）"""
        rules = sorted(self._load_rules(), key=lambda r: r.get("created_at", 0), reverse=True)
        return {"ok": True, "rules": rules}

    def save_automation_rule(self, rule: Dict[str, Any]) -> Dict[str, Any]:
        """新建或更新规则（按 id 去重）。返回保存后的规则。"""
        if not isinstance(rule, dict):
            return {"ok": False, "error": "规则数据非法"}
        rule = json.loads(json.dumps(rule))  # 深拷贝，避免外部引用污染
        rid = str(rule.get("id") or "").strip()
        rules = self._load_rules()
        now = int(time.time())
        if rid:
            for i, r in enumerate(rules):
                if r.get("id") == rid:
                    # 保留 created_at，更新其它字段
                    rule["id"] = rid
                    rule["created_at"] = r.get("created_at", now)
                    rules[i] = rule
                    break
            else:
                rid = ""  # id 不存在 → 当新建
        if not rid:
            rule["id"] = uuid.uuid4().hex
            rule.setdefault("created_at", now)
            rules.append(rule)
        self._save_rules(rules)
        self._ensure_scheduler()
        return {"ok": True, "rule": rule}

    def delete_automation_rule(self, rule_id: str) -> Dict[str, Any]:
        rules = [r for r in self._load_rules() if r.get("id") != rule_id]
        self._save_rules(rules)
        return {"ok": True}

    def toggle_automation_rule(self, rule_id: str, enabled: bool) -> Dict[str, Any]:
        rules = self._load_rules()
        for r in rules:
            if r.get("id") == rule_id:
                r["enabled"] = bool(enabled)
                break
        self._save_rules(rules)
        self._ensure_scheduler()
        return {"ok": True}

    # ---------- 触发执行 ----------
    def _execute_action(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """执行动作（cron 后台线程用）。

        run_app：优先反向推流让前端后台挂载实例（界面随逻辑一起启动）；
        窗口未就绪（如单测环境）时退回后端 core.run，保证规则仍可执行。
        """
        if not isinstance(action, dict):
            return {"ok": False, "error": "动作数据非法"}
        atype = action.get("type")
        if atype == "run_app":
            app_id = str(action.get("appId") or "")
            if not app_id:
                return {"ok": False, "error": "未指定目标 App"}
            if self._window:
                code = ("iChen.Automation && iChen.Automation.startAppBackground"
                        " && iChen.Automation.startAppBackground(" + json.dumps(app_id) + ")")
                self._push_js(code)
                return {"ok": True, "mode": "background_ui"}
            try:
                res = self.run_app(app_id, "run", {})  # type: ignore[attr-defined]
                return {"ok": bool(res.get("ok")), "result": res}
            except Exception as e:
                return {"ok": False, "error": str(e)}
        return {"ok": False, "error": f"不支持的动作类型: {atype}"}

    # ==================== cron 调度器 ====================
    # 状态放实例（惰性初始化）：类变量会在 Api 多实例/重载时串状态

    def _ensure_scheduler(self) -> None:
        """按需启动 cron 调度线程（仅一次）。"""
        if getattr(self, '_scheduler_started', False):
            return
        if not hasattr(self, '_scheduler_lock'):
            self._scheduler_lock = threading.Lock()
            self._last_fire: Dict[str, tuple] = {}  # rule_id -> (y,m,d,h,mi)
        with self._scheduler_lock:
            if getattr(self, '_scheduler_started', False):
                return
            self._scheduler_started = True
            t = threading.Thread(target=self._scheduler_loop, daemon=True, name="ichen-automation")
            t.start()

    def _scheduler_loop(self) -> None:
        # 每 30 秒轮询一次，按分钟对齐避免重复触发
        while True:
            try:
                self._tick_cron()
            except Exception as e:
                print(f"[iChen] automation cron tick error: {e}")
            time.sleep(30)

    def _tick_cron(self) -> None:
        now = datetime.now()
        cur = (now.year, now.month, now.day, now.hour, now.minute)
        for r in self._load_rules():
            if not r.get("enabled"):
                continue
            trig = r.get("trigger") or {}
            if trig.get("type") != "cron":
                continue
            expr = str(trig.get("cron") or "").strip()
            if not expr:
                continue
            rid = r.get("id")
            if self._last_fire.get(rid) == cur:
                continue  # 本分钟已触发过
            if not _cron_match(expr, now):
                continue
            self._last_fire[rid] = cur
            try:
                res = self._execute_action(r.get("action") or {})
                print(f"[iChen] automation cron fired: {r.get('name')} -> {res}")
            except Exception as e:
                print(f"[iChen] automation cron action error: {e}")


# ==================== cron 解析（5 字段：分 时 日 月 周） ====================
def _parse_field(field: str, min_v: int, max_v: int) -> List[int]:
    """解析单个 cron 字段为允许值列表。支持 * / */n / a-b / a,b"""
    values: List[int] = []
    for part in field.split(","):
        part = part.strip()
        if not part:
            continue
        step = 1
        if "/" in part:
            base, step_s = part.split("/", 1)
            step = int(step_s)
        else:
            base = part
        if base == "*":
            start, end = min_v, max_v
        elif "-" in base:
            a, b = base.split("-", 1)
            start, end = int(a), int(b)
        else:
            start = end = int(base)
        values.extend(range(start, end + 1, step))
    return [v for v in values if min_v <= v <= max_v]


def _cron_match(expr: str, now: datetime) -> bool:
    """5 字段 cron 匹配当前时间（分 时 日 月 周）。"""
    parts = expr.split()
    if len(parts) != 5:
        return False
    try:
        minutes = _parse_field(parts[0], 0, 59)
        hours = _parse_field(parts[1], 0, 23)
        days = _parse_field(parts[2], 1, 31)
        months = _parse_field(parts[3], 1, 12)
        # cron 周几：0=周日 … 6=周六（同时接受 7=周日）
        weekdays_raw = _parse_field(parts[4], 0, 7)
        weekdays = sorted({0 if w == 7 else w for w in weekdays_raw})
    except Exception:
        return False
    weekday = now.weekday() + 1  # Monday=1..Sunday=7 → 转 cron: Sunday=0
    cron_wd = 0 if weekday == 7 else weekday
    return (
        now.minute in minutes
        and now.hour in hours
        and now.day in days
        and now.month in months
        and cron_wd in weekdays
    )
