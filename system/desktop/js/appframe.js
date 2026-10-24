/* ============================================================
   appframe.js - 程序实例管理（调度式多窗口 · 实例保活）+ 样式注入 + 桥
   核心：一个 App = 一个常驻实例（卡片 + iframe，状态保留）。
   调度模型（仿 iPad 多窗口）：
   - 列表点 App = 单调度：舞台上只留它，其余自动退回后台（保活）
   - 后台调度器点 App = 多调度：把它加到舞台，与已有窗口并排（缝可拖宽）
   - 单调度下再点同一个 App = 收起；多窗口下收起 = 从舞台移除该窗口
   - 「关闭」：先调 core.teardown() 回收后台资源，再销毁实例
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};
    const $ = (id) => document.getElementById(id);

    // 桥标记：能被直接读取的场景（同源 iframe）下 App 可用它快速判定
    window.__ICHEN_BRIDGE__ = true;

    /** appId -> { id, node, zone, iframe, card, openedAt, blockedEl } */
    const instances = new Map();
    /** 舞台上正在呈现的实例 id（有序，多个即并排调度） */
    let stageIds = [];

    // 分栏宽度会话内记忆（不持久化）：收起再调回仍沿用上次宽度
    const growMem = new Map();

    const stage = () => $('stage');
    const placeholder = () => $('stage-placeholder');
    const zoneOf = (node) => String(node.path || '').split('/')[0] || '';

    const DEFAULT_ICON = 'data:image/svg+xml;base64,' + btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + '<rect x="8" y="8" width="48" height="48" rx="12" fill="#dbe7fb" stroke="#8fb0e6"/>'
        + '<circle cx="32" cy="32" r="10" fill="#8fb0e6"/></svg>');

    /* ---------- 卡片骨架 ---------- */
    function buildCard(inst) {
        const card = document.createElement('div');
        card.className = 'appcard';
        card.style.display = 'none';
        card.dataset.appId = inst.id;

        const head = document.createElement('div');
        head.className = 'appcard-head';
        const icon = document.createElement('img');
        icon.className = 'appcard-icon';
        icon.src = inst.node.icon_data || DEFAULT_ICON;
        icon.alt = '';
        const name = document.createElement('span');
        name.className = 'appcard-name';
        name.textContent = inst.node.name || inst.id;
        // 右上不再放关闭/收起按钮：收起走列表再点，关闭走调度器右键「终止」
        head.appendChild(icon);
        head.appendChild(name);

        const body = document.createElement('div');
        body.className = 'appcard-body';
        body.appendChild(inst.iframe);

        card.appendChild(head);
        card.appendChild(body);
        return card;
    }

    /* ---------- 挂载 ---------- */
    async function mount(inst) {
        const { node, iframe } = inst;

        // URL 型 App：裸容器，直接 iframe src 指向外部站点。
        // 不注入 shared 样式、不握手、不参与桥——它本来就"像浏览器打开一个网页"。
        //
        // 牵制在中枢内：sandbox 不给 allow-popups，站点里 target=_blank / window.open
        // 会被浏览器拦下，不会把窗口丢给系统默认浏览器；站内同窗口跳转仍在 iframe 内完成。
        if (node.app_type === 'url' && node.url) {
            // 挂载前二次校验 scheme：只放行 http(s)，拒绝 javascript: 等危险协议
            if (!/^https?:/i.test(node.url)) {
                showUrlBlocked(inst, '仅支持 http(s) 地址，已拒绝挂载');
                return;
            }
            // manifest 指定 container=external：不尝试嵌入，直接外部浏览器打开
            if (node.container === 'external') {
                iChen.PyAPI.openExternalUrl(node.url);
                showUrlBlocked(inst, '该 App 配置为外部窗口打开');
                return;
            }
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
            iframe.src = node.url;
            setTimeout(() => {
                if (!instances.has(inst.id)) return; // 实例可能已被终止
                let blank = false;
                try { blank = !iframe.contentWindow || iframe.contentWindow.length === 0; }
                catch (e) { blank = false; }   // 跨域访问抛错 = 有内容
                if (blank) {
                    if (iChen.Notify) {
                        iChen.Notify.warn('URL 型 App「' + (node.name || node.id)
                            + '」可能禁止被嵌入（X-Frame-Options），可用下方按钮在系统浏览器打开');
                    }
                    showUrlBlocked(inst, '该站点可能禁止被嵌入（X-Frame-Options），或需要外部窗口登录');
                }
            }, 4000);
            return;
        }

        try {
            const r = await iChen.PyAPI.getAppUi(node.id);
            if (r && r.ok && r.html) {
                let html = r.html;
                if (r.dir && /<head[^>]*>/i.test(html)) {
                    html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + r.dir + '/">');
                }
                iframe.srcdoc = html;
                return;
            }
            notifyMountFailure(node, (r && r.error) || '未取到界面内容');
        } catch (e) {
            notifyMountFailure(node, String((e && e.message) || e));
        }
        if (node.dir) iframe.src = node.dir + '/' + (node.ui || 'ui/index.html');
    }

    function onLoaded(inst) {
        // URL 型 App 是裸容器：不注入样式、不握手、不参与桥
        if (inst.node && inst.node.app_type === 'url') return;
        injectCss(inst.iframe);
        handshake(inst.iframe);
    }

    /** URL 型 App 无法嵌入时的卡片兜底：外部打开 / 重试嵌入 */
    function showUrlBlocked(inst, reason) {
        if (inst.blockedEl) return;
        const el = document.createElement('div');
        el.className = 'url-blocked';
        const h = document.createElement('h3');
        h.textContent = '无法在中枢内嵌入此页面';
        const p = document.createElement('p');
        p.style.whiteSpace = 'pre-wrap';
        p.textContent = reason + '\n地址：' + inst.node.url;
        const actions = document.createElement('div');
        actions.className = 'url-blocked-actions';
        const mkBtn = (label, primary, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn' + (primary ? ' btn-primary' : '');
            b.textContent = label;
            b.addEventListener('click', fn);
            return b;
        };
        actions.appendChild(mkBtn('在系统浏览器打开', true, () => {
            iChen.PyAPI.openExternalUrl(inst.node.url);
        }));
        actions.appendChild(mkBtn('重新尝试嵌入', false, () => {
            el.remove();
            inst.blockedEl = null;
            inst.iframe.src = inst.node.url;
        }));
        el.appendChild(h);
        el.appendChild(p);
        el.appendChild(actions);
        inst.iframe.parentElement.appendChild(el); // 卡片 body 内铺满
        inst.blockedEl = el;
    }

    function createInstance(node) {
        const iframe = document.createElement('iframe');
        iframe.className = 'app-frame';
        iframe.dataset.appId = node.id;

        const inst = {
            id: node.id, node: node, zone: zoneOf(node), iframe: iframe,
            openedAt: Date.now(),
            grow: 1, // 默认等宽；用户拖缝后由 saveGrow 更新
            blockedEl: null, card: null,
        };
        inst.card = buildCard(inst);
        stage().appendChild(inst.card);
        iframe.onload = () => onLoaded(inst);
        instances.set(node.id, inst);
        mount(inst);
        notifyChange();
        return inst;
    }

    /* ---------- 舞台布局（调度式多窗口） ---------- */
    /** 重排舞台：按 stageIds 顺序并排呈现（多窗口时缝可拖宽）；空则显示占位卡 */
    function layoutStage() {
        stage().querySelectorAll('.appcard-divider').forEach((d) => d.remove());
        // 舞台列表对齐真实实例（实例被终止后会出现在这里）
        stageIds = stageIds.filter((id) => instances.has(id));

        instances.forEach((x) => { x.card.style.display = 'none'; });
        // 关键：按 stageIds 顺序把卡片重新挂回 DOM，否则「先开 A 再开 B，收起 A 再点开 A」
        // 会出现 stageIds=[B,A] 但 DOM 仍是 [A卡,B卡] 的顺序错乱，缝和 flex 都对不上
        stageIds.forEach((id, i) => {
            const inst = instances.get(id);
            if (i > 0) stage().appendChild(makeDivider());
            stage().appendChild(inst.card);
            inst.card.style.display = 'flex';
            inst.card.style.flexGrow = inst.grow;
        });
        // 舞台为空时显示一张空白圆角矩形
        placeholder().hidden = stageIds.length > 0;
        return stageIds.length;
    }

    /** 并排缝：缝两侧卡片按像素拖拽调宽，宽度写回实例并会话内记忆 */
    function makeDivider() {
        const d = document.createElement('div');
        d.className = 'appcard-divider';
        d.addEventListener('mousedown', (e) => {
            const left = d.previousElementSibling, right = d.nextElementSibling;
            if (!left || !right || !left.classList.contains('appcard') || !right.classList.contains('appcard')) return;
            e.preventDefault();
            d.classList.add('on');
            // 全屏遮罩接管鼠标事件，避免快速划过 iframe 时被 iframe 吞掉而跟丢
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:col-resize;';
            document.body.appendChild(overlay);
            const total = left.offsetWidth + right.offsetWidth;
            const startX = e.clientX, lw = left.offsetWidth;
            const mv = (ev) => {
                const nl = Math.min(Math.max(200, lw + ev.clientX - startX), total - 200);
                left.style.flexGrow = nl;
                right.style.flexGrow = total - nl;
                saveGrow(left.dataset.appId, nl);
                saveGrow(right.dataset.appId, total - nl);
            };
            const up = () => {
                d.classList.remove('on');
                overlay.remove();
                document.removeEventListener('mousemove', mv);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });
        return d;
    }

    function saveGrow(appId, grow) {
        const inst = instances.get(appId);
        if (inst) inst.grow = grow;
        growMem.set(appId, grow);
    }

    /* ---------- 对外动作 ---------- */
    /** 点分区列表里的 App = 单调度：舞台只留它。
     *  它已是舞台唯一窗口时再点 = 收起；否则其余窗口自动退回后台（保活）。 */
    function open(node) {
        if (!node || node.type !== 'app') return null;
        const existing = instances.get(node.id);
        if (existing) {
            const solo = (stageIds.length === 1 && stageIds[0] === node.id);
            if (solo) hide(node.id);
            else soloStage(node.id);
            return existing;
        }
        const inst = createInstance(node);
        soloStage(node.id);
        if (iChen.UI) iChen.UI.animateIn(inst.card);
        // 自动化：app_open 触发器（只在首次真正打开时触发，还原/聚焦不重复触发）
        if (iChen.Automation) {
            try { iChen.Automation.onAppOpen(node.id); } catch (e) { /* 忽略 */ }
        }
        return inst;
    }

    /** 后台启动 App：只挂载实例（不上舞台），舞台保持不变。
     *  已在运行则原样返回（不重启、不切舞台），避免重复启动冲突。 */
    function openBackground(node) {
        if (!node || node.type !== 'app') return { ok: false, error: 'App 节点非法' };
        const existing = instances.get(node.id);
        if (existing) return { ok: true, already: true };
        createInstance(node);
        layoutStage();
        return { ok: true };
    }

    /** 单调度：舞台清空只留这一个 */
    function soloStage(id) {
        const inst = instances.get(id);
        if (!inst) return false;
        hidePanels();
        stageIds = [id];
        layoutStage();
        notifyChange();
        document.dispatchEvent(new CustomEvent('ichen:instance-shown', { detail: { id: id, zone: inst.zone } }));
        return true;
    }

    /** 多调度：把它加到舞台末尾（已在本台则移到末尾），与已有窗口并排 */
    function addToStage(id) {
        const inst = instances.get(id);
        if (!inst) return false;
        hidePanels();
        stageIds = stageIds.filter((x) => x !== id).concat([id]);
        layoutStage();
        notifyChange();
        document.dispatchEvent(new CustomEvent('ichen:instance-shown', { detail: { id: id, zone: inst.zone } }));
        return true;
    }

    /** 从舞台移除该窗口（退回后台、实例保活）；单窗口时等于收起 */
    function hide(id) {
        const inst = instances.get(id);
        if (!inst || !stageIds.includes(id)) return false;
        stageIds = stageIds.filter((x) => x !== id);
        layoutStage();
        notifyChange();
        document.dispatchEvent(new CustomEvent('ichen:instance-shown', { detail: { id: null, zone: inst.zone } }));
        return true;
    }

    /** 后台调度器点击：在舞台 加入 / 移除 之间切换（可多个窗口同时在场） */
    function toggle(id) {
        if (stageIds.includes(id)) return hide(id);
        return addToStage(id);
    }

    function isOnStage(id) { return stageIds.includes(id); }

    function hidePanels() {
        ['settings-view', 'processes-view', 'welcome-view', 'appmgmt-view', 'automation-view']
            .forEach((pid) => { const el = $(pid); if (el) el.hidden = true; });
    }

    /** 切主体（分区）：舞台保持不变（窗口是全局的），只按当前调度重排 */
    function showForZone() {
        layoutStage();
        notifyChange();
        return stageIds.length > 0;
    }

    /** 隐藏全部卡片（控制台面板显示时用；不销毁，舞台调度记忆保留） */
    function hideAll() {
        instances.forEach((x) => { x.card.style.display = 'none'; });
        stage().querySelectorAll('.appcard-divider').forEach((d) => d.remove());
        placeholder().hidden = true;
    }

    /** 让舞台回到当前调度状态（后台视图用：该显示的窗口照常显示） */
    function renderStage() {
        hidePanels();
        layoutStage();
    }

    /** 收起到后台：卡片撤下、实例保活；后台调度器可调回 */
    function minimize(id) { return hide(id); }

    /** 终止实例：先调 core.teardown() 回收后台资源（端口/线程），再销毁卡片与 iframe */
    async function terminate(id) {
        const inst = instances.get(id);
        if (!inst) return false;
        // 后台回收必须先于 iframe 移除：App 起的端口/线程靠 teardown 钩子释放，
        // 只删 iframe 会留下孤儿线程（HTTP 端口仍可访问）。
        try { await iChen.PyAPI.terminateApp(id); } catch (e) { /* 回收失败也继续销毁界面 */ }
        try { inst.card.remove(); } catch (e) { /* 忽略 */ }
        try { if (inst.blockedEl) inst.blockedEl.remove(); } catch (e) { /* 忽略 */ }
        instances.delete(id);
        stageIds = stageIds.filter((x) => x !== id);
        layoutStage();
        notifyChange();
        return true;
    }

    function instanceList() { return Array.from(instances.values()); }

    /** 供控制台"程序"面板 / 后台调度器：实例摘要 */
    function listInstances() {
        return instanceList().map((x) => ({
            id: x.id,
            name: x.node.name || x.id,
            icon: x.node.icon_data || '',
            zone: x.zone,
            opened_at: x.openedAt,
            active: stageIds.includes(x.id),   // 在舞台上（前台）
            stage: stageIds.indexOf(x.id),
        }));
    }

    function notifyChange() {
        document.dispatchEvent(new CustomEvent('ichen:instances-changed', {
            detail: { count: instances.size, stage: stageIds.slice() },
        }));
    }

    function themeOf() {
        return (document.documentElement.dataset.theme || 'system');
    }

    /** 注入 shared 样式（URL 型 App 不注入：它是裸容器，不参与框架协议） */
    function injectCss(frame) {
        const theme = themeOf();
        iChen.PyAPI.getSharedCss().then((css) => {
            if (css && frame.contentWindow) {
                try { frame.contentWindow.postMessage({ type: 'ichen:css', css: css, theme: theme }, '*'); } catch (e) { /* 忽略 */ }
            }
        }).catch(() => { /* 忽略 */ });
    }

    /** 主题变化时广播给所有实例（设置页切换 / 系统主题变化时调用） */
    function broadcastTheme() {
        const theme = themeOf();
        instanceList().forEach((x) => {
            try { x.iframe.contentWindow.postMessage({ type: 'ichen:theme', theme: theme }, '*'); } catch (e) { /* 忽略 */ }
        });
    }

    function handshake(frame) {
        try { frame.contentWindow.postMessage({ type: 'ichen:bridge' }, '*'); } catch (e) { /* 忽略 */ }
    }

    /* ---------- 消息路由：App → 父 ---------- */
    async function route(m) {
        return iChen.PyAPI.runApp(m.app, m.action, m.payload);
    }

    function findBySource(win) {
        let found = null;
        instances.forEach((x) => { if (x.iframe.contentWindow === win) found = x; });
        return found;
    }

    /* ---------- 文件通道：App → 框架 → 系统文件对话框 → 定向回执 ----------
       安全（《App 接入规范》第十节 2）：与业务消息同一套校验——来源必须是已知实例，
       且自称的 app 与实例一致；未通过校验一律丢弃，不弹任何对话框。 */
    window.addEventListener('message', async (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object' || m.type !== 'ichen:pick-file') return;

        const inst = findBySource(e.source);
        if (!inst || inst.id !== m.app) {
            console.warn('[AppFrame] 丢弃：文件请求来源非法', m.app);
            return;
        }

        const r = await iChen.PyAPI.pickFiles(m.mode, m.multiple, m.filter, m.defaultName);
        if (!inst.iframe.contentWindow) return;
        const reply = Object.assign({ type: 'ichen:pick-file-result', requestId: m.requestId || '' }, r || {});
        try { inst.iframe.contentWindow.postMessage(reply, '*'); } catch (err) { /* 忽略 */ }
    });

    /* ---------- 通知通道：App → 框架 → 中枢通知（状态栏 toast + 历史 + Windows 气球） ----------
       App 界面发 { type:'ichen:notify', app, title, body, level }，与业务消息同一套来源校验。 */
    window.addEventListener('message', async (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object' || m.type !== 'ichen:notify') return;

        const inst = findBySource(e.source);
        if (!inst || inst.id !== m.app) {
            console.warn('[AppFrame] 丢弃：通知来源非法', m.app);
            return;
        }
        try { await iChen.PyAPI.notify(m.title, m.body, m.level, m.app); } catch (err) { /* 忽略 */ }
    });

    window.addEventListener('message', async (e) => {
        const m = e.data;
        if (!m || typeof m !== 'object') return;
        if (m.type && String(m.type).startsWith('ichen:')) return; // 框架内部消息
        if (!m.app || !m.action) return;

        // 安全（《App 接入规范》第十节）：先确认来源是已知实例、且自称的 app 与实例一致；
        // 未通过校验的消息一律丢弃、不执行——防止任意 iframe 冒名触发别的 App 动作。
        const inst = findBySource(e.source);
        if (!inst) {
            console.warn('[AppFrame] 丢弃：消息来源不是已知实例', m.app);
            return;
        }
        if (inst.id !== m.app) {
            console.warn('[AppFrame] 丢弃：app 与来源实例不符', m.app, inst.id);
            return;
        }

        const r = await route(m);
        const reply = Object.assign({}, r || {}, { app: m.app, action: m.action });
        if (inst.iframe.contentWindow) {
            try { inst.iframe.contentWindow.postMessage(reply, '*'); } catch (err) { /* 忽略 */ }
        }
    });

    function notifyMountFailure(node, reason) {
        const name = (node && (node.name || node.id)) || '未知 App';
        if (iChen.Notify) iChen.Notify.error('App 挂载失败 · ' + name + '：' + reason);
        else if (iChen.UI) iChen.UI.showToast('App 挂载失败：' + name);
    }

    /** 重启实例：teardown 回收 → 销毁实例 → 用原节点重新挂载；原本在舞台上则重启后回到舞台原位 */
    async function restart(id) {
        const inst = instances.get(id);
        if (!inst) return false;
        const node = inst.node;
        const idx = stageIds.indexOf(id);
        await terminate(id);
        openBackground(node);
        if (idx >= 0) {
            stageIds.splice(Math.min(idx, stageIds.length), 0, id);
            layoutStage();
            notifyChange();
        }
        return true;
    }

    iChen.AppFrame = {
        init() { /* 无需 */ },
        open,
        openBackground,
        soloStage,
        addToStage,
        hide,
        toggle,
        minimize,
        isOnStage,
        showForZone,
        hideAll,
        renderStage,
        terminate,
        restart,
        notifyMountFailure,
        list: listInstances,
        count: () => instances.size,
        stageCount: () => stageIds.length,
        current: () => (stageIds.length ? instances.get(stageIds[stageIds.length - 1]) : null),
        broadcastTheme: broadcastTheme,
    };
})();
