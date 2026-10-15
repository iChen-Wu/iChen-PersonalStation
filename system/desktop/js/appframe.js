/* ============================================================
   appframe.js - 程序实例管理（多实例保活）+ 样式注入 + 桥
   核心：一个 App 打开 = 一个常驻实例（独立 iframe，状态保留）。
   - 切换 App / 切换主体 Tab：只切换显示，**不销毁、不重载**（后台挂起）
   - 控制台"程序"面板可查看实例并手动终止（销毁 iframe）
   - 通信：App → 父 {app, action, payload}；父执行后回执同构消息
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};
    const $ = (id) => document.getElementById(id);

    // 桥标记：能被直接读取的场景（同源 iframe）下 App 可用它快速判定
    window.__ICHEN_BRIDGE__ = true;

    /** appId -> { id, node, zone, iframe, openedAt } */
    const instances = new Map();
    let activeId = null;

    const stage = () => $('stage');
    const placeholder = () => $('stage-placeholder');
    const zoneOf = (node) => String(node.path || '').split('/')[0] || '';

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

    /** URL 型 App 无法嵌入时的舞台兜底：外部打开 / 重试嵌入 */
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
        stage().appendChild(el);
        inst.blockedEl = el;
    }

    function createInstance(node) {
        const iframe = document.createElement('iframe');
        iframe.className = 'app-frame';
        iframe.dataset.appId = node.id;
        iframe.hidden = true;
        stage().appendChild(iframe);

        const inst = { id: node.id, node: node, zone: zoneOf(node), iframe: iframe, openedAt: Date.now() };
        iframe.onload = () => onLoaded(inst);
        instances.set(node.id, inst);
        mount(inst);
        notifyChange();
        return inst;
    }

    /** 打开 App：已在运行则直接切过去（不重启）；否则新建实例 */
    function open(node) {
        if (!node || node.type !== 'app') return null;
        const existing = instances.get(node.id);
        if (existing) { show(node.id); return existing; }
        const inst = createInstance(node);
        show(node.id);
        // 自动化：app_open 触发器（只在首次真正打开时触发，切换前台不重复触发）
        if (iChen.Automation) {
            try { iChen.Automation.onAppOpen(node.id); } catch (e) { /* 忽略 */ }
        }
        return inst;
    }

    /** 后台启动 App：只挂载实例（iframe 隐藏、逻辑随界面加载启动），前台保持不变。
     *  已在运行则原样返回（不重启、不切前台），避免重复启动冲突。 */
    function openBackground(node) {
        if (!node || node.type !== 'app') return { ok: false, error: 'App 节点非法' };
        const existing = instances.get(node.id);
        if (existing) return { ok: true, already: true };
        createInstance(node); // iframe 初始即 hidden，不调用 show → 前台不动
        return { ok: true };
    }

    /** 显示某个实例（其余隐藏但保活） */
    function show(id) {
        const inst = instances.get(id);
        if (!inst) return;
        activeId = id;
        hidePanels();
        instances.forEach((x, key) => {
            x.iframe.hidden = (key !== id);
            if (x.blockedEl) x.blockedEl.hidden = (key !== id);
        });
        if (iChen.UI) iChen.UI.animateIn(inst.iframe); // 程序切前台淡入
        placeholder().hidden = true;
        document.dispatchEvent(new CustomEvent('ichen:instance-shown', { detail: { id: id, zone: inst.zone } }));
    }

    function hidePanels() {
        const s = $('settings-view');
        const p = $('processes-view');
        if (s) s.hidden = true;
        if (p) p.hidden = true;
    }

    /** 切主体（分区）：显示该分区中最近打开的实例；没有则舞台留空（其他实例保活挂后台） */
    function showForZone(zone) {
        let target = null;
        instances.forEach((x) => { if (x.zone === zone) target = x; }); // 后进者优先
        if (target) { show(target.id); return true; }
        activeId = null;
        instances.forEach((x) => {
            x.iframe.hidden = true;
            if (x.blockedEl) x.blockedEl.hidden = true;
        });
        // 无运行中的实例：舞台保持空白（不再显示「从左侧选择一个 App」遗留提示）
        placeholder().hidden = true;
        return false;
    }

    /** 隐藏全部实例（面板显示时用；不销毁） */
    function hideAll() {
        instanceList().forEach((x) => {
            x.iframe.hidden = true;
            if (x.blockedEl) x.blockedEl.hidden = true;
        });
        placeholder().hidden = true;
    }

    /** 终止实例：先调 core.teardown() 回收后台资源（端口/线程），再销毁 iframe */
    async function terminate(id) {
        const inst = instances.get(id);
        if (!inst) return false;
        // 后台回收必须先于 iframe 移除：App 起的端口/线程靠 teardown 钩子释放，
        // 只删 iframe 会留下孤儿线程（HTTP 端口仍可访问）。
        try { await iChen.PyAPI.terminateApp(id); } catch (e) { /* 回收失败也继续销毁界面 */ }
        const wasActive = (activeId === id);
        try { inst.iframe.remove(); } catch (e) { /* 忽略 */ }
        try { if (inst.blockedEl) inst.blockedEl.remove(); } catch (e) { /* 忽略 */ }
        instances.delete(id);
        notifyChange();
        if (wasActive) {
            activeId = null;
            // 只在用户正停留在该 App 所属主体时才切到同区其它实例；
            // 在控制台面板（后台 / App 管理 / 设置）里终止时保持当前面板，不跳走。
            const currentZone = (iChen.Shell && iChen.Shell.getZone()) || null;
            if (currentZone === inst.zone) {
                showForZone(inst.zone);
            }
        }
        return true;
    }

    function instanceList() { return Array.from(instances.values()); }

    /** 供控制台"程序"面板：实例摘要 */
    function listInstances() {
        return instanceList().map((x) => ({
            id: x.id,
            name: x.node.name || x.id,
            icon: x.node.icon_data || '',
            zone: x.zone,
            opened_at: x.openedAt,
            active: x.id === activeId,
        }));
    }

    function notifyChange() {
        document.dispatchEvent(new CustomEvent('ichen:instances-changed', { detail: { count: instances.size } }));
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

    /** 重启实例：teardown 回收 → 销毁 iframe → 用原节点重新后台挂载（不切前台） */
    async function restart(id) {
        const inst = instances.get(id);
        if (!inst) return false;
        const node = inst.node;
        await terminate(id);
        openBackground(node);
        return true;
    }

    iChen.AppFrame = {
        init() { /* 无需 */ },
        open,
        openBackground,
        show,
        showForZone,
        hideAll,
        terminate,
        restart,
        notifyMountFailure,
        list: listInstances,
        count: () => instances.size,
        current: () => instances.get(activeId) || null,
        broadcastTheme: broadcastTheme,
    };
})();
