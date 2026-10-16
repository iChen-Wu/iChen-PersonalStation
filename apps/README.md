# 在这里开发 iChen App（给 AI 的工作说明）

**把这个 `apps/` 文件夹选为工作区，就可以直接为 iChen 开发 App。** 不需要、也不应该修改中枢代码。
完整权威规格在中枢仓库的 `docs/3-App开发指南.md`（即本目录的 `../docs/3-App开发指南.md`），
本文件是上手要点，两者冲突时以《3-App开发指南》为准。

## 工作区规则

1. 这个 `apps/` 属于**开发版中枢**（上一级是 iChen 项目根）。现有 App（demo_hello、hello、
   班级管理/*、图标集、待机、系统/文件、Qxia、wyuan）是**测试夹具**——中枢的自动化测试依赖它们，
   **不要修改、改名或删除**。新 App 请新建独立文件夹。
2. App 完成并在开发版验证后，由用户**手工拷贝**到正式版 `D:\iChen\apps\` 对应分区；
   中枢更新工具永远不会自动同步 apps（正式版 App 受保护）。
3. 界面文案与代码注释一律中文；图标只用 SVG 文件（可用 `work/图标集/` 里的素材）。

## 目录模型（5 个事实）

1. `work/`、`space/` 是两个**分区**（界面 Tab），各带 `folder.json`（名称/图标/顺序）。
   新 App 放进某个分区；需要分类就建一层含 `folder.json` 的文件夹（参照 `work/班级管理/`）。
2. 含 **`manifest.json`** 的目录 = 一个 App（扫描到就停止下钻）；含 folder.json 的是分类；
   App 不能直接放在 apps 根目录。
3. 一个 App 三件套：`manifest.json` + `ui/index.html` + `core.py`（纯界面型可不要 core.py）。
4. 移动 / 改名 / 删除文件夹 = 搬移 / 改名 / 卸载 App，重开中枢自动跟随。
5. `__pycache__`、点开头目录、普通 .md 文件都会被扫描忽略。

## manifest.json（最小版）

```json
{
  "name": "我的应用",
  "id": "作者.应用名",
  "version": "0.1.0",
  "description": "一句话说明",
  "icon": "icon.svg",
  "type": "logic",
  "ui": "ui/index.html",
  "entry": "core.py"
}
```

- `id` 全局唯一：英文小写 + 点（如 `byu.song`），用于通信与路由。
- `type`：`logic`（界面+Python）/ `ui`（纯界面）/ `url`（网址，配 `url` 与
  `container: iframe|external`）/ `service`（常驻后台，必须写 `teardown()`）。
- entry/ui/icon 只接受 App 目录内的相对路径，绝对路径和 `..` 会被拒绝。

## 通信约定（核心 3 条）

1. **前端 → 后端**：`window.parent.postMessage({ app: "<id>", action: "x", payload: {} }, "*")`；
   中枢调用 `core.run({"action": "x", "payload": {}})`，返回 dict 原样回执（带 `ok` 字段）。
2. **握手与主题**：界面监听 message——`ichen:bridge`=已嵌入中枢；`ichen:css`=注入共享样式
   （新建 style 追加到 head）；`ichen:theme`=设置 `document.documentElement.dataset.theme`。
   浏览器直接打开 HTML 是「独立模式」，必须有兜底样式与演示数据，也能正常渲染。
3. **本地文件路径**只走文件通道（`ichen:pick-file`，mode=open/folder/save），
   不要自己弹文件选择器、不要在 iframe 里拼路径。

## core.py（最小版）

```python
def run(params: dict) -> dict:
    action = (params or {}).get('action')
    payload = (params or {}).get('payload') or {}
    if action == 'hello':
        return {'ok': True, 'message': '你好', 'payload': payload}
    return {'ok': False, 'error': f'未知动作: {action}'}


def teardown():
    """仅后台服务需要：停线程、关端口、释放连接。"""
    pass
```

- 模块按 id 缓存、按文件修改时间热重载；模块级全局状态在多次 run 间存活。
- `run()` 同步执行无超时，不要写长时间阻塞逻辑。
- 需要业务数据时 `from GYun... import ...` / `from BYu... import ...` /
  `from common.paths import DATA_DIR`（shared 库在中枢运行时自动可用）；
  禁止 `import system.*`，禁止 sys.path 技巧。
- App 自己产生的文件放本 App 目录下的 `data/`。

## 交付要求

1. 给出相对 `apps/` 的完整文件树和每个文件的**完整内容**，不要省略。
2. 自测四件事：① 浏览器直接开 ui/index.html 正常；② `python core.py` 打印正常 JSON；
   ③ 重开中枢（在项目根 `python -m system.main`）能看到 App 并走通桥调用；④ 深色主题不错乱。
3. 不新增对中枢代码的修改；不引用外网 CDN；不伪造执行结果。
