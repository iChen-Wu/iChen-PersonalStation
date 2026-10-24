/* ============================================================
   welcome-doc.js - 「接入」页里那份「完整开发规格」原文
   
   为什么单独放一个文件：
   这段文本里内嵌了一整份 HTML 示例（含 </style> </script> </body> </html>）。
   若直接写在 index.html 的 <textarea> 里，浏览器按 RCDATA 处理没问题，
   但 VS Code 的 HTML 语言服务会把它当真实标签解析、从而报错。
   放到 .js 的模板字符串里，两边都干净。
   
   读取方式：window.__ICHEN_WELCOME_DOC__（见 js/shell.js 的 initWelcomeDoc）
   ============================================================ */
window.__ICHEN_WELCOME_DOC__ = `# iChen App 开发规格（发给 AI 的完整需求）

你要在一个名为 iChen 的 Windows 桌面中枢（Python 3 + pywebview/WebView2）里为我开发一个 App。iChen 的所有功能都以「App 文件夹」的形式放在 apps/ 目录下，中枢启动时自动扫描，无需注册、无需修改中枢任何代码。请严格按本规格实现；界面文案与代码注释一律使用中文。

## 一、目录模型与扫描规则

- apps/ 的一级目录是「分区」（界面左侧的 Tab 主体），分区目录里放 folder.json 提供名称、图标和顺序。
- 递归扫描每个文件夹时：
  - 含 manifest.json → 判定为 App（叶子节点，不再向下扫描）；
  - 含 folder.json → 判定为分类或分区（可继续向下）；
  - 两者都没有 → 普通文件夹（兜底，按文件夹名显示）。
- __pycache__ 与点（.）开头的目录会被跳过。
- 对文件夹移动 / 改名 / 删除，就等于对 App 搬移 / 改名 / 卸载，重开中枢后自动跟随。
- App 不能直接放在 apps/ 根目录，必须位于某个分区（可套多层分类文件夹）之内。

目录示意：

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

## 二、manifest.json（App 名片，位于 App 文件夹第一层）

字段：
- name（必填）：显示名，可中文。
- id（必填）：全局唯一标识，英文小写 + 点，建议「作者.名称」，如 demo.hello；用于通信、日志与路由，勿用中文，勿与已有 App 重复。
- version（可选）：版本号，建议 x.y.z。
- description（可选）：一句话说明，会显示在列表里。
- icon（可选）：图标文件路径，相对 App 目录，建议 SVG；缺省用系统默认图标。
- order（可选，数字）：同层排序，小的在前；缺省按名称排。
- entry（可选）：Python 逻辑入口文件名，默认 core.py，必须位于 App 目录内。
- ui（可选）：界面文件路径，默认 ui/index.html，必须位于 App 目录内。
- type（可选）：App 类型，logic（逻辑型）/ ui（纯界面）/ url（网址）。
- url（type 为 url 时必填）：http(s):// 网址。
- container（仅 url 型）：iframe（嵌在中枢内，默认）或 external（用系统浏览器打开）。
- requires（可选）：App 的依赖声明，供「导出 / 导入 miniapp 包」使用，缺省视为无依赖。
  - shared：写 shared/ 下的模块目录名（如 ["GYun"]）；导出时整模块打包（数据库 *.db、data/ 目录绝不进包），导入时若目标机已有同名模块则跳过不覆盖。
  - py：写 import 用的模块名（如 ["requests", "bs4"]）；纯 Python 库随包拷贝，带二进制的库（pywebview、Pillow 等）无法跨机拷贝，导入时自动 pip install --target data/pylibs。也可写 pip:包名 强制按 pip 包名处理（如 ["pip:beautifulsoup4"]）。

示例：

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

打包分享：在左侧列表右键 App → 「导出 miniapp」，得到 .miniapp 包（zip 格式，内含 App 全部文件 + 依赖的 shared 模块 + 纯 Python 库 + 打包清单）；对方在「新建 App → 导入 miniapp 包」选入即可，缺的依赖自动补齐，id 冲突时可选覆盖。

## 三、folder.json（分区 / 分类信息，可选）

{ "name": "工作区", "icon": "work.svg", "order": 1, "description": "一句话说明" }

只承载展示信息；不写 folder.json 的文件夹也会以文件夹名正常显示。

## 四、App 的类型

1. 逻辑型（type 写 logic 或省略）：有 ui/index.html + core.py。界面发消息给中枢，中枢在本地进程内调用 core.py 的 run()。**最常用**。
2. 纯界面型（type: "ui"）：只有 ui/index.html，无后端。适合小工具、静态页面、纯前端小游戏。
3. URL 型（type: "url"）：只有 manifest.json + 图标，界面直接是一个网址：
   { "name": "示例", "id": "url.example", "type": "url", "url": "https://example.com", "container": "iframe", "icon": "icon.svg" }
   container 写 external 则改用系统浏览器打开。
4. 后台服务型（type: "service"）：常驻后台逻辑（HTTP 端口、定时调度、长连接），可带界面也可不带，必须实现 teardown() 释放资源。参考 apps/work/hello/。

（对话型 chat 由中枢系统层提供，不要自行实现。）

## 五、ui/index.html 界面约定

- 完全自包含：CSS/JS 内联或相对本 App 目录引用；禁止引用中枢全局对象、其他 App 资源或外网 CDN；不使用 file:// 子资源。
- 同一份文件支持两种模式：浏览器直接打开时是「独立模式」，必须用内置兜底样式和演示数据正常渲染；被中枢挂载时收到握手消息进入「嵌入模式」，操作改走 postMessage。
- 挂载方式：中枢读取 HTML 文本后用 iframe 的 srcdoc 挂载并注入 <base>，加载完成后向界面发消息。
- 图标一律使用 SVG 文件，不要用 emoji 或 Unicode 字符当图标。

### 5.1 消息协议

界面接收（监听 window 的 message 事件，读 e.data）：
- { type: "ichen:css", css: "<共享样式文本>", theme: "light|dark|system" }：中枢注入的共享样式；新建 <style> 追加到 head 即可。
- { type: "ichen:bridge" }：握手信号，收到后视为嵌入模式（srcdoc 挂载下不要只靠 window.parent 判断）。
- { type: "ichen:theme", theme: "light|dark|system" }：主题变化，必须设置 document.documentElement.dataset.theme = theme；样式请用 CSS 变量并给浅色兜底。
- 业务回执：{ app: "<你的 id>", action: "<动作名>", ok: true, ...其它字段 }；失败时 ok: false 且带 error。

界面发送（调用后端逻辑）：

window.parent.postMessage({ app: "demo.hello", action: "hello", payload: {} }, "*");

- app 必须等于本 App manifest 的 id；
- action 是动作名（字符串），payload 是参数对象；
- 中枢会调用 core.py 的 run({"action": action, "payload": payload})，并把返回的 dict 原样回执。

### 5.2 标准界面模板（直接改）

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

## 六、core.py 逻辑约定

- 必须提供 run(params: dict) -> dict；params 形如 {"action": "hello", "payload": {...}}。
- 正常返回 dict（约定成功带 ok: true）；业务错误返回 {"ok": false, "error": "说明"}；未捕获异常中枢也会兜底成错误，但你应自行处理业务异常。
- run() 同步执行且当前无超时，不要写会长时间阻塞的逻辑。
- 模块按 app_id 缓存：模块级全局状态（线程、句柄、连接）在多次 run() 之间存活；core.py 文件改动后下次调用自动热重载。
- 如果在后台开了线程 / 端口 / 长连接，必须实现可选钩子 teardown()：App 在「控制台 → 后台」被终止或中枢退出时，框架会先调用它释放资源。纯计算 App 不需要。
- entry / ui / icon 必须是 App 目录内的相对路径，绝对路径与包含 .. 的路径会被拒绝。

标准 core.py：

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

后台服务型 App 的 teardown 骨架：

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

## 七、文件通道（需要本地真实路径时）

iframe 里读不到本地文件路径。凡要打开文件、选目录、另存为，都向中枢发请求弹系统对话框，不要自己拼路径：

请求：
{ type: "ichen:pick-file", app: "demo.hello", requestId: "r1",
  mode: "open",            // open=选文件  folder=选目录  save=另存为
  multiple: false,         // 仅 open 有意义
  filter: "all",           // image / json / all 三选一
  defaultName: "data.json" // 仅 save 使用
}

回执：
{ type: "ichen:pick-file-result", requestId: "r1", ok: true, paths: ["D:/demo/a.jpg"] }
{ type: "ichen:pick-file-result", requestId: "r1", ok: false, canceled: true }              // 用户取消，不是错误
{ type: "ichen:pick-file-result", requestId: "r1", ok: false, canceled: true, error: "..." } // 非中枢环境或异常

调用示例：

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

## 八、数据存放

- App 自身数据写中枢的 data/appdata/<app_id>/（推荐）或用户经文件通道选定的位置；不要写系统目录、仓库外路径。
  core.py 里直接用注入的全局 APP_DATA_DIR（字符串路径，加载时已创建好；在 run()/函数内读取，不要在模块顶层引用），或 from common.paths import app_data_dir 调 app_data_dir(你的id)。数据落这里而不是 App 目录内：导出 / 覆盖导入 miniapp 只动 App 目录，用户数据天然不受影响。
- 不要假设能访问其他 App 的目录或中枢内部文件。

## 九、安全红线

1. 不使用绝对路径或 .. 引用 entry / ui / icon，所有资源限制在 App 目录内。
2. 界面只代表自己的 id 发消息，不伪造其他 App。
3. 不伪造执行结果：独立模式或未连接外部服务时，返回明确错误或明确标注的演示数据。
4. 不弹浏览器自带的文件选择器，本地路径只走文件通道。
5. 图标只用 SVG；界面自包含、无外网依赖。

## 十、完成后的自测清单

1. 用浏览器直接打开 ui/index.html：界面渲染正常，操作有独立模式兜底表现。
2. 在 App 目录执行 python core.py：打印 run() 的 JSON 结果，无报错。
3. 重开 iChen 中枢：分区树里出现该 App，名称 / 图标正确；打开后能经桥调到 core.run() 并看到回执。
4. 切换分区 / 切换其他 App 再切回：界面状态保留（实例后台保活）。
5. 如果起了后台线程 / 端口：在「控制台 → 后台」终止该 App 时，teardown() 被调用、端口立即释放；重新打开可再次启动。
6. 切换深色主题：界面跟随变化，不出现白底黑字错乱。

## 十一、交付格式

- 给出完整文件树（相对 apps/ 的路径）。
- 逐个给出每个文件的完整内容，不要省略、不要写「其余同上」。
- 界面文案与代码注释使用中文；id 全局唯一；不新增对中枢代码的修改。

## 十二、中枢提供的共享样式（不要自己再造）

中枢在 iframe 加载完成后会发 { type: "ichen:css", css, theme }，把 shared/common/css/tokens.css + components.css 的全部内容注入进来。你只需 new 一个 <style> 把 m.css 追加到 head 即可（见 5.2 模板）。

提供给你的样式基座：

### 12.1 CSS 变量（颜色 / 圆角 / 阴影 / 字号，深浅双主题自动切换）

颜色（**优先用这些变量**，不要写死颜色值）：
- 背景：--color-bg（主背景）/ --color-bg-muted（次背景）/ --color-bg-soft（三级）/ --color-bg-hover（悬停）/ --bg-card（玻璃卡）/ --bg-input（输入底）
- 文本：--color-text（主）/ --color-text-secondary（次）/ --color-text-muted（弱）/ --color-text-faint（最弱）
- 边框：--color-border / --color-border-soft / --color-border-strong
- 主色：--accent / --accent-hover / --accent-light / --accent-gradient（蓝调）/ --color-primary
- 语义：--success / --warning / --danger

圆角：--radius-xs(4) / --radius-sm(8) / --radius-md(12) / --radius-lg(16) / --radius-xl(24) / --radius-full
阴影：--shadow-xs / --shadow-sm / --shadow-md / --shadow-lg / --shadow-inner
过渡：--transition-fast(0.2s) / --transition-normal(0.3s) / --transition-smooth(0.4s 弹性)
字体：--font-family

主题切换：当用户切深浅主题，中枢会发 { type:"ichen:theme", theme:"light"|"dark"|"system" }，你只需：
  document.documentElement.dataset.theme = m.theme;
然后**全部用上面的 CSS 变量**，浅色深色会自动切换。禁止写死 #fff #000。

### 12.2 通用组件类（直接加到 HTML 上就能用）

按钮：
- .btn —— 基础按钮（灰底，悬停变浅）
- .btn.btn-primary —— 主按钮（蓝色渐变，提交 / 确认用）
- .btn.btn-dark —— 次按钮（深色）
- .btn.btn-square —— 方形 32×32 图标按钮
- 加 disabled 属性自动置灰

反馈：
- .toast —— 顶部 toast 提示，加 .show 类显示
- .fade-in —— 淡入动画（进入视图时加一次）

布局：
- .toolbar-spacer —— flex 填充，把右侧按钮推到末尾
- .layer —— 全屏绝对定位容器（覆盖在 body 上）

**示例**：
  <button class="btn">取消</button>
  <button class="btn btn-primary">确定</button>
  <div class="toast show">已保存</div>

### 12.3 不推荐的写法

- ❌ 自己定义 .btn / .card / .input 等同类样式 → 改用上面已有的类，或在类名上加自己的前缀
- ❌ 写死 background: #fff / color: #000 → 改用 var(--color-bg) var(--color-text)
- ❌ 引入自己的字体文件 → 用 var(--font-family)
- ❌ 全局选择器 * / body 覆写中枢样式 → 你的样式作用域只在 iframe 内，但仍要避免

## 十三、shared/ 与 common/ 模块速查

App 的 core.py 可以 import shared/ 和 shared/common/ 下的模块（中枢已把它们加进 sys.path）：

### 13.1 common.paths —— 路径工具（**必选**，不要自己拼路径）

  from common.paths import app_data_dir, DATA_DIR, APPS_ROOT

  app_data_dir(app_id) -> Path   # 当前 App 的私有数据目录，已自动创建
  DATA_DIR -> Path                # 中枢数据根目录
  APPS_ROOT -> Path               # apps/ 根目录

或更简单：**直接用注入的全局变量 APP_DATA_DIR**（在 core.py 的 run()/函数内读取，不要在模块顶层）：

  def run(params):
      from pathlib import Path
      my_db = Path(APP_DATA_DIR) / "data.db"   # 推荐

### 13.2 shared/GYun —— 实体库（数据持久化）

如果 App 需要持久化业务实体（笔记、提醒、任务、账单……），用 shared/GYun 而不是自建数据库：
- manifest.json 的 requires.shared 里加 ["GYun"]
- core.py 里 from GYun import ... （具体 API 见 shared/GYun/__init__.py 的导出）

### 13.3 其它 shared 模块

shared/ 下其它目录是可复用的中枢模块（网络、文件等）。manifest 的 requires.shared 写明后，导出 miniapp 包时会一起打进去。

## 十四、调试与排错

- iframe 里 console.log / console.error 在哪看？
  在中枢窗口右键 → 检查（或在标题栏按 F12，如果开了开发者模式）打开 DevTools，切到对应 iframe 的 console。
- 桥消息没收到回执？
  1. 检查 app 字段是否完全等于 manifest.id（区分大小写）
  2. 检查 action 在 core.py 的 run() 里有没有对应分支
  3. 检查 core.py 是否返回 dict，而不是 print
- 模块没热重载？
  改 core.py 后**下次调用**自动重载，但模块级状态会保留。如果要彻底重置，去「控制台 → 调度」终止实例再打开。
- 端口被占用？
  teardown() 没释放。检查 teardown 是否真的关闭 server / 线程，且端口立即 free。

## 十五、常见反例（不要这样写）

❌ 界面里写死颜色：body { background: #fff; color: #000; }
✅ 用 CSS 变量：body { background: var(--color-bg); color: var(--color-text); }

❌ 自己弹文件对话框：<input type="file">
✅ 走中枢文件通道：postMessage({type:"ichen:pick-file", ...})

❌ 在 core.py 顶层写：DB = sqlite3.connect(APP_DATA_DIR + "/x.db")
✅ 在函数内：def run(params): from pathlib import Path; db = Path(APP_DATA_DIR) / "x.db"

❌ 界面访问别的 App：fetch("/apps/other_app/x.json")
✅ App 之间隔离，需要共享数据用 shared/GYun

❌ 主题切换不重渲染：收到 ichen:theme 后什么都不做
✅ 必做：document.documentElement.dataset.theme = m.theme;`;
