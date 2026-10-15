"""iChen 中控 · Python 桥（pywebview js_api）

`Api` = `BaseApi` + 各功能 Mixin：

| Mixin | 位置 | 职责 |
|---|---|---|
| `SettingsMixin` | `system/kernel/settings_mixin.py` | 设置（版本 / 状态 / 退出 / 调试） |
| `WindowMixin` | `system/kernel/window_mixin.py` | 窗口控制（frameless 自绘标题栏用） |
| `AutomationMixin` | `system/kernel/automation_mixin.py` | 自动化规则（app_open / cron 触发 → 运行 App） |
| `AppsMixin` | `system/apphost/apps.py` | App 盒子：apps/ 扫描 + core.run + 文件通道 |
| `AppEditMixin` | `system/apphost/app_edit.py` | App 编辑：改名 / 排序 / 移动 / 卸载 / 元数据 / 分区管理 |
| `MiniappMixin` | `system/apphost/miniapp.py` | App 包导入导出（.miniapp）+ 依赖落位 |

V3.0.0 · P3 起，业务类会话（千夏对话 / 个云 IM / 会话桥）已从中枢移除——
它们不是中枢的东西，改由 App 自己承担（见《App 侧契约》）。
V3.0.0 · P4 起，「服务」类别废除——原服务改为 App，生命周期由「后台」面板统一管理。

新增功能：新建一个模块 + 一个 Mixin，在此组合即可，无需改动现有文件。
"""
from system.kernel.base import BaseApi
from system.kernel.settings_mixin import SettingsMixin
from system.kernel.window_mixin import WindowMixin
from system.kernel.automation_mixin import AutomationMixin
from system.apphost.apps import AppsMixin
from system.apphost.app_edit import AppEditMixin
from system.apphost.miniapp import MiniappMixin


class Api(BaseApi, SettingsMixin, WindowMixin, AutomationMixin, AppsMixin, AppEditMixin, MiniappMixin):
    """中控桥：所有 pywebview 可调用接口的集合"""
    pass
