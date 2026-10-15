# iChen App 开发指南

本指南是 App 开发的**唯一权威规格**，与中枢「接入」页里的完整开发规格（`system/desktop/js/welcome-doc.js`）
内容一致。做 App 时把工作区选到 `apps/`，按本指南实现即可，**不需要修改中枢任何代码**。
界面文案与代码注释一律使用中文。

## 一、目录模型与扫描规则

- `apps/` 的一级目录是「分区」（界面左侧的 Tab），分区目录里放 `folder.json` 提供名称、图标和顺序。
- 递归扫描每个文件夹时：
  - 含 `manifest.json` → 判定为 App（叶子节点，不再向下扫描）；
  - 含 `folder.json` → 判定为分类或分区（可继续向下）；
  - 两者都没有 → 普通文件夹（兜底，按文件夹名显示）。
- `__pycache__` 与点（`.`）开头的目录会被跳过；普通文件（如 README.md）不影响扫描。
- 对文件夹移动 / 改名 / 删除，就等于对 App 搬移 / 改名 / 卸载，重开中枢后自动跟随。
- App 不能直接放在 `apps/` 根目录，必须位于某个分区（可套多层分类文件夹）之内。

```
apps/
  work/                  # 分区（Tab），含 folder.json
    folder.json
    我的分类/            # 分类，含 folder.json
      folder.json
      my_app/            # App：含 manifest.json
        manifest.json
        icon.svg
        ui/index.html
        core.py
```

## 二、manifest.json（App 名片，位于 App 文件夹第一层）

- `name`（必填）：显示名，可中文。
- `id`（必填）：全局唯一标识，英文小写 + 点，建议「作者.名称」，如 `demo.hello`；用于通信、
  日志与路由，勿用中文，勿与已有 App 重复。
- `version`（可选）：版本号，建议 `x.y.z`。
- `description`（可选）：一句话说明，会显示在列表里。
- `icon`（可选）：图标文件路径，相对 App 目录，建议 SVG；缺省用系统默认图标。
- `order`（可选，数字）：同层排序，小的在前；缺省按名称排。
- `entry`（可选）：Python 逻辑入口文件名，默认 `core.py`，必须位于 App 目录内。
- `ui`（可选）：界面文件路径，默认 `ui/index.html`，必须位于 App 目录内。
- `type`（可选）：`logic`（逻辑型）/ `ui`（纯界面）/ `url`（网址）/ `service`（后台服务型）。
- `url`（type 为 url 时必填）：`http(s)://` 网址。
- `container`（仅 url 型）：`iframe`（嵌在中枢内，默认）或 `external`（用系统浏览器打开）。
- `requires`（可选）：App 的依赖声明，供「导出 / 导入 miniapp 包」使用，缺省视为无依赖。
  - `shared`：写 shared/ 下的模块目录名（如 `["GYun"]`）；导出时整模块打包（数据库 *.db、
    data/ 目录绝不进包），导入时若目标机已有同名模块则跳过不覆盖。
  - `py`：写 import 用的模块名（如 `["requests", "bs4"]`）；纯 Python 库随包拷贝，带二进制的
    库（pywebview、Pillow 等）无法跨机拷贝，导入时自动 `pip install --target data/pylibs`。
    也可写 `pip:包名` 强制按 pip 包名处理（如 `["pip:beautifulsoup4"]`）。

```json
{
  "name": "你好",
  "id": "demo.hello",
  "version": "0.1.0",
  "description": "最小示例 App",
  "icon": "icon.svg",
  "order": 1,
  "ui": "ui/index.html",
  "entry": "core.py",
  "type": "logic"
}
```

打包分享：在左侧列表右键 App → 「导出 miniapp」，得到 `.miniapp` 包（zip 格式，内含 App 全部
文件 + 依赖的 shared 模块 + 纯 Python 库 + 打包清单）；对方在「新建 App → 导入 miniapp 包」
选入即可，缺的依赖自动补齐，id 冲突时可选覆盖。

## 三、folder.json（分区 / 分类信息，可选）

```json
{ "name": "工作区", "icon": "work.svg", "order": 1, "description": "一句话说明" }
```

只承载展示信息；不写 `folder.json` 的文件夹也会以文件夹名正常显示。

## 四、App 的类型

1. **逻辑型**（`type` 写 `logic` 或省略）：有 `ui/index.html` + `core.py`。界面发消息给中枢，
   中枢在本地进程内调用 `core.py` 的 `run()`。
2. **纯界面型**（`type: "ui"`）：只有 `ui/index.html`，无后端，适合小工具、静态页面。
3. **URL 型**（`type: "url"`）：只有 manifest + 图标，界面直接是一个网址：
   `{ "name": "示例", "id": "url.example", "type": "url", "url": "https://example.com", "container": "iframe" }`；
   `container` 写 `external` 则用系统浏览器打开。
4. **服务型**（`type: "service"`）：常驻后台逻辑（端口 / 调度 / 长连接），可带界面，
   必须实现 `teardown()`，参考 `apps/work/hello/`。

（对话型 chat 由中枢系统层提供，不要自行实现。）

## 五、ui/index.html 界面约定

- **完全自包含**：CSS/JS 内联或相对本 App 目录引用；禁止引用中枢全局对象、其他 App 资源或外网
  CDN；不使用 `file://` 子资源。
- **双模式**：浏览器直接打开时是「独立模式」，必须用内置兜底样式和演示数据正常渲染；被中枢挂载时
  收到握手消息进入「嵌入模式」，操作改走 postMessage。
- 挂载方式：中枢读取 HTML 文本后用 iframe 的 srcdoc 挂载并注入 `<base>`，加载完成后向界面发消息。
- 图标一律使用 SVG 文件，不要用 emoji 或 Unicode 字符当图标。

### 5.1 消息协议

界面接收（监听 window 的 message 事件，读 `e.data`）：

- `{ type: "ichen:css", css: "<共享样式文本>", theme: "light|dark|system" }`：中枢注入的共享样式；
  新建 `<style>` 追加到 head 即可。
- `{ type: "ichen:bridge" }`：握手信号，收到后视为嵌入模式（srcdoc 挂载下不要只靠 window.parent 判断）。
- `{ type: "ichen:theme", theme: "light|dark|system" }`：主题变化，必须设置
  `document.documentElement.dataset.theme = theme`；样式请用 CSS 变量并给浅色兜底。
- 业务回执：`{ app: "<你的 id>", action: "<动作名>", ok: true, ...其它字段 }`；失败时
  `ok: false` 且带 `error`。

界面发送（调用后端逻辑）：

```javascript
window.parent.postMessage({ app: "demo.hello", action: "hello", payload: {} }, "*");
```

- `app` 必须等于本 App manifest 的 id；
- `action` 是动作名（字符串），`payload` 是参数对象；
- 中枢会调用 `core.py` 的 `run({"action": action, "payload": payload})`，并把返回的 dict 原样回执。

### 5.2 标准界面模板（直接改）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的 App</title>
<style>
  /* 内联兜底样式：浏览器直接打开也要能用；嵌入后中枢会额外注入共享样式与深色主题变量 */
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font-family: system-ui, "Microsoft YaHei", sans-serif; }
  button { padding: 8px 18px; border: 0; border-radius: 8px; background: #3b82f6; color: #fff; cursor: pointer; }
  #out { margin-top: 12px; white-space: pre-wrap; font-size: 13px; }
</style>
</head>
<body>
  <h2>我的 App</h2>
  <button id="btn">调用后端</button>
  <div id="out">（结果显示在这里）</div>
<script>
  const APP_ID = 'demo.hello'; // 必须与 manifest.json 的 id 完全一致
  let bridged = false;

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ichen:css') {           // 中枢注入共享样式
      const s = document.createElement('style');
      s.textContent = m.css || '';
      document.head.appendChild(s);
    }
    if (m.type === 'ichen:bridge') bridged = true;                 // 握手完成
    if (m.type === 'ichen:theme') {                                // 主题跟随
      document.documentElement.dataset.theme = m.theme;
    }
    if (m.type === 'ichen:pick-file-result') { /* 文件通道回执，见第七节 */ return; }
    if (m.app === APP_ID) {                                        // 业务回执
      document.getElementById('out').textContent = JSON.stringify(m, null, 2);
    }
  });

  function call(action, payload) {
    if (!bridged) { // 独立模式：给出演示数据，保证浏览器直接打开也能看界面
      document.getElementById('out').textContent = '独立模式：未接入中枢';
      return;
    }
    window.parent.postMessage({ app: APP_ID, action, payload: payload || {} }, '*');
  }

  document.getElementById('btn').addEventListener('click', () => call('hello', {}));
</script>
</body>
</html>
```

## 六、core.py 逻辑约定

- 必须提供 `run(params: dict) -> dict`；params 形如 `{"action": "hello", "payload": {...}}`。
- 正常返回 dict（约定成功带 `ok: true`）；业务错误返回 `{"ok": false, "error": "说明"}`；
  未捕获异常中枢也会兜底成错误，但应自行处理业务异常。
- `run()` 同步执行且当前无超时，不要写会长时间阻塞的逻辑。
- 模块按 app_id 缓存：模块级全局状态（线程、句柄、连接）在多次 `run()` 之间存活；core.py 文件
  改动后下次调用自动热重载。
- 如果在后台开了线程 / 端口 / 长连接，必须实现可选钩子 `teardown()`：App 在「控制台 → 后台」
  被终止或中枢退出时，框架会先调用它释放资源。纯计算 App 不需要。
- entry / ui / icon 必须是 App 目录内的相对路径，绝对路径与包含 `..` 的路径会被拒绝。

标准 `core.py`：

```python
def run(params: dict) -> dict:
    action = (params or {}).get('action')
    payload = (params or {}).get('payload') or {}
    if action == 'hello':
        return {'ok': True, 'message': '你好，来自 core.run', 'payload': payload}
    return {'ok': False, 'error': f'未知动作: {action}'}


def teardown():
    """可选：实例终止 / 中枢退出时调用，用于停线程、关端口、释放连接。"""
    pass


if __name__ == '__main__':
    import json
    print(json.dumps(run({'action': 'hello', 'payload': {}}), ensure_ascii=False))
```

后台服务型 App 的 `teardown` 骨架：

```python
import threading
from http.server import ThreadingHTTPServer

_server = None

def _ensure_server():
    global _server
    if _server is None:
        _server = ThreadingHTTPServer(('127.0.0.1', 8787), MyHandler)
        threading.Thread(target=_server.serve_forever, daemon=True).start()

def teardown():
    global _server
    if _server is not None:
        _server.shutdown()
        _server.server_close()
        _server = None
```

## 七、文件通道（需要本地真实路径时）

iframe 里读不到本地文件路径。凡要打开文件、选目录、另存为，都向中枢发请求弹系统对话框，
不要自己拼路径：

请求：

```javascript
{ type: "ichen:pick-file", app: "demo.hello", requestId: "r1",
  mode: "open",            // open=选文件  folder=选目录  save=另存为
  multiple: false,         // 仅 open 有意义
  filter: "all",           // image / json / all 三选一
  defaultName: "data.json" // 仅 save 使用
}
```

回执：

```javascript
{ type: "ichen:pick-file-result", requestId: "r1", ok: true, paths: ["D:/demo/a.jpg"] }
{ type: "ichen:pick-file-result", requestId: "r1", ok: false, canceled: true }              // 用户取消，不是错误
{ type: "ichen:pick-file-result", requestId: "r1", ok: false, canceled: true, error: "..." } // 非中枢环境或异常
```

调用示例：

```javascript
function pickFile() {
  const reqId = 'r' + Date.now();
  const onResult = (e) => {
    const m = e.data;
    if (!m || m.type !== 'ichen:pick-file-result' || m.requestId !== reqId) return;
    window.removeEventListener('message', onResult);
    if (m.ok) {
      call('read_files', { paths: m.paths }); // 把绝对路径交给 core.py 真实读写
    } else if (m.canceled && !m.error) {
      /* 用户取消：安静处理 */
    } else {
      alert('该功能需要在中枢内打开：' + (m.error || ''));
    }
  };
  window.addEventListener('message', onResult);
  window.parent.postMessage({
    type: 'ichen:pick-file', app: APP_ID, requestId: reqId,
    mode: 'open', multiple: false, filter: 'all'
  }, '*');
}
```

## 八、数据存放

- App 自身数据写中枢的 `data/appdata/<app_id>/`（推荐）或用户经文件通道选定的位置；不要写系统目录。
  core.py 里直接用注入的全局 `APP_DATA_DIR`（字符串路径，加载时已创建好；在 `run()`/函数内读取，
  不要在模块顶层引用），或 `from common.paths import app_data_dir` 调 `app_data_dir(你的id)`。
  数据落这里而不是 App 目录内：导出 / 覆盖导入 miniapp 只动 App 目录，用户数据天然不受影响。
- 共享业务数据走 `shared/` 提供的库（如 GYun 实体库），连接与路径由 `common.paths` 决定，
  不要自己拼数据库路径。
- 不要假设能访问其他 App 的目录或中枢内部文件。

## 九、安全红线

1. 不使用绝对路径或 `..` 引用 entry / ui / icon，所有资源限制在 App 目录内。
2. 界面只代表自己的 id 发消息，不伪造其他 App。
3. 不伪造执行结果：独立模式或未连接外部服务时，返回明确错误或明确标注的演示数据。
4. 不弹浏览器自带的文件选择器，本地路径只走文件通道。
5. 图标只用 SVG；界面自包含、无外网依赖。

## 十、完成后的自测清单

1. 用浏览器直接打开 `ui/index.html`：界面渲染正常，操作有独立模式兜底表现。
2. 在 App 目录执行 `python core.py`：打印 run() 的 JSON 结果，无报错。
3. 重开 iChen 中枢：分区树里出现该 App，名称 / 图标正确；打开后能经桥调到 `core.run()` 并看到回执。
4. 切换分区 / 切换其他 App 再切回：界面状态保留（实例后台保活）。
5. 如果起了后台线程 / 端口：在「控制台 → 后台」终止该 App 时，`teardown()` 被调用、端口立即释放；
   重新打开可再次启动。
6. 切换深色主题：界面跟随变化，不出现白底黑字错乱。

## 十一、给 AI 的交付格式

- 给出完整文件树（相对 `apps/` 的路径）。
- 逐个给出每个文件的完整内容，不要省略、不要写「其余同上」。
- 界面文案与代码注释使用中文；id 全局唯一；不新增对中枢代码的修改。
