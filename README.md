# iChen

**个人操作系统** —— 让每一个 py、html 小程序都有一个集成的中枢：扫描发现、挂载运行、
调度与生命周期，由系统统一承担。

写一个 App，就是按规范放一个文件夹。放进 `apps/` 就出现在桌面，拖走即卸载——类似 APK 的即装即用体验。

- Windows 桌面常驻（pywebview + WebView2，托盘运行）
- 本地优先：数据落在本地 SQLite，LLM 能力可选接入
- 一套代码，三种形态：开发版 / 正式版 / U 盘移动版

## 它解决什么问题

手边的小工具往往各自为政：一个脚本一个黑窗，没有界面、没有入口、数据散落各处。
iChen 把它们统一成一种形态——**App 文件夹**。界面跑在桌面里的 iframe，逻辑跑在中枢进程，
数据进统一的库；发现、挂载、调度、热重载、后台回收，全部由系统代管。

## 功能特性

### 即写即用的 App 体系

- **一个文件夹就是一个 App**：`manifest.json` + `ui/index.html` + `core.py` 三件套，
  中枢启动时递归扫描 `apps/`，无需注册、无需改中枢代码
- **四种类型**：逻辑型（界面 + Python）/ 纯界面型 / 网址型（iframe 嵌入或系统浏览器）/
  后台服务型（常驻端口，`teardown()` 统一回收）
- **热重载**：模块按 id 缓存、按文件修改时间自动重载，改完即生效
- **桥协议**：握手、共享样式注入、深浅色主题同步、系统文件对话框通道
- **实例保活**：切换分区、切走再切回，App 界面状态不丢

### 桌面体验

- 分区（Tab）→ 分类 → App 三级树，`folder.json` 自定义名称、图标与排序
- 右键管理：新建 App（导入文件夹 / HTML / URL）、重命名、换图标、移动、删除
- 深浅色主题全局跟随，可选无边框窗口，`--debug` 开启调试控制台
- 自动化：cron 定时与「打开应用」触发，规则持久化于 `data/automation.json`

### 数据与业务地基

- **GYun**：SQLite 实体库 + LLM 地基；**BYu**：班级、积分、歌曲等业务库
- 运行数据统一在 `data/`（db / config / logs），路径常量唯一来源 `common/paths.py`
- 公共样式唯一来源 `common/css`，与桌面副本的一致性由测试守护

### 工程化

- 145 项单元测试一键运行；依赖方向（App 禁止 import system）、CSS 同步等架构约束由测试强制
- 增量更新正式版：SHA-256 逐文件比对、默认只读、业务数据硬保护
- 工程脚本外置在开发机工作区级工程台 `../workbench/`（仓库外）：测试、更新、代码统计、启动器构建

## 架构总览

```
apps/       App 内容根（work / space 分区）        ← 三件套放进来，就是装上了
─────────────────────────────────────────────────
system/     系统中枢（常驻进程，托盘）
  desktop     桌面界面（分区树 · App 实例 · 控制台）
  kernel      内核（pywebview 桥 · 设置 · 窗口 · 托盘）
  apphost     App 宿主（扫描 · srcdoc 挂载 · core.run · 热重载）
─────────────────────────────────────────────────
shared/     共享库（无进程）
  GYun        数据 / LLM 地基
  BYu         业务库
  common      公共样式 + 路径常量（唯一来源）
─────────────────────────────────────────────────
data/       运行数据（db / config / logs；不提交）

工程脚本在仓库外：../workbench/（开发机工作区级工程台，不随仓库分发）
```

一条调用链：桌面把 App 的 `ui/index.html` 经 iframe `srcdoc` 挂载 → 界面 `postMessage` 发指令 →
宿主在本地进程调用 `core.run(params)` → 返回的 dict 原样回执到界面。

## 第一个 App

```
apps/
  work/
    my_first/
      manifest.json
      icon.svg
      ui/index.html
      core.py
```

```json
{ "name": "我的第一个 App", "id": "me.first", "type": "logic",
  "ui": "ui/index.html", "entry": "core.py", "icon": "icon.svg" }
```

```python
def run(params: dict) -> dict:
    return {"ok": True, "message": "你好，iChen"}
```

界面里一行代码调用后端：

```javascript
window.parent.postMessage({ app: "me.first", action: "hello", payload: {} }, "*");
```

重开中枢，分区树里就会出现它。完整规格见 [3-App开发指南](docs/3-App开发指南.md)。

## 快速开始

环境：Windows 10/11，Python 3.10+，WebView2（Win11 自带）。

```bash
pip install -e .        # 注册 GYun / BYu
python -m system.main   # 启动中枢（App 桌面，托盘常驻）
```

## 三种形态

| 形态 | 位置 | 说明 |
|---|---|---|
| 开发版 | 本仓库 | 中枢开发地；apps 只留测试夹具 |
| 正式版 | `D:/iChen` | 日常使用：业务 App、业务库、业务数据；快捷方式启动 |
| 移动版 | `H:/iChen`（U 盘） | U 盘随身：自带嵌入式 Python，干净环境 |

更新正式版走增量工具（先比对后写入，永不触碰 apps / shared / data / runtime）：

```bash
python ../workbench/tools/update_production.py            # 只比对
python ../workbench/tools/update_production.py --apply    # 确认后写入
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/README.md](docs/README.md) | 文档索引（三部分） |
| [docs/1-开发流程.md](docs/1-开发流程.md) | 版本规则、开发习惯、发布同步、备份恢复 |
| [docs/2-项目说明.md](docs/2-项目说明.md) | 定位、三版本边界、目录结构、机制、数据红线 |
| [docs/3-App开发指南.md](docs/3-App开发指南.md) | 做 App 的权威规格（manifest / ui / core / 桥协议） |
| [docs/开发记录.md](docs/开发记录.md) | v3.0.0 起的变更台账 |

## 给 AI 的一句话

做 App 时把工作区直接选到 `apps/`，读 [apps/README.md](apps/README.md) 即可开工——
不需要修改中枢任何代码。

## 约定

- 统一包绝对导入（`from common.paths import PROJECT_ROOT`），禁止 `sys.path` 技巧与相对导入
- 路径一律取自 `common.paths`；启动统一 `python -m 包.模块`
- 图标一律 SVG 文件；服务即 App——常驻逻辑写成 service 型 App，不设独立服务类别
