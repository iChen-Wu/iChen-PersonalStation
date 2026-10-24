/* ============================================================
   shell.js - 主壳状态机（动态主体）
   - 主体（Tab）由 apps/ 一级目录动态生成（scan_zones；folder.json 提供
     名称/图标/顺序）——apps 里新增一级文件夹，刷新后 Tab 自动出现
   - 底部固定「后台 / 控制台」：后台 = 运行中的实例列表；控制台列表是控制台条目（设置为其一）
   - 无顶部状态栏（v3.2.0 起）：App 名称由卡片头部承担；无待机层（待机将来由程序承担）
   - 列表区右缘手柄可拖宽（会话内记忆，不持久化），拖过窄阈值即折叠
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};

    const state = {
        zones: [],          // [{key,name,icon_data,order,...}]
        zone: null,         // 当前主体 key（分区路径 或 'console'）
        item: null,         // 当前条目 key（分区树选中项 / 控制台条目）
        consoleItem: null,  // 上次所在的控制台条目（运行时记忆，切走再回来时恢复）
        collapsed: false,   // 列表区折叠
    };

    const $ = (id) => document.getElementById(id);

    /** 复制文本到剪贴板：优先 Clipboard API，失败降级 execCommand（WebView2 / 非安全上下文） */
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch (e2) { return false; }
        }
    }

    /** 接入页：把完整开发规格填入折叠预览，并绑定「复制给 AI」按钮
     *
     * 规格原文不再内嵌在 index.html 里（那段文本含 </style> </script> </body> </html>，
     * 浏览器按 RCDATA 没事，但 VS Code 的 HTML 语言服务会当真实标签而报错），
     * 改由 js/welcome-doc.js 提供 window.__ICHEN_WELCOME_DOC__。
     */
    async function initWelcomeDoc() {
        const host = $('welcome-view');
        if (host && !host.dataset.loaded) {
            // 面板内容独立成 welcome/welcome.html，便于热改动（改完刷新页面即可）
            try {
                const r = await fetch('welcome/welcome.html', { cache: 'no-cache' });
                if (r.ok) { host.innerHTML = await r.text(); host.dataset.loaded = '1'; }
            } catch (e) { host.innerHTML = '<div class="settings-wrap"><h2>接入 iChen</h2><div class="welcome-text">接入内容加载失败：' + e.message + '</div></div>'; }
        }
        const view = $('welcome-doc-view');
        const btn = $('welcome-copy-doc');
        if (!view || !btn) return;
        const doc = String(window.__ICHEN_WELCOME_DOC__ || '').trim();
        if (!doc) {
            view.textContent = '（未找到规格原文：请确认 js/welcome-doc.js 已加载）';
            btn.disabled = true;
            return;
        }
        view.textContent = doc;
        btn.addEventListener('click', async () => {
            const oldText = btn.textContent;
            const ok = await copyText(doc);
            btn.textContent = ok ? '已复制，直接粘贴发给 AI 即可' : '复制失败，请展开下方预览手动复制';
            if (!ok) btn.classList.remove('btn-primary');
            setTimeout(() => {
                btn.textContent = oldText;
                btn.classList.add('btn-primary');
            }, 1600);
        });
    }

    // 统一 base64 data URI（避免 utf8 data URI 在部分 WebView 下的解析差异）
    const svgUri = (svg) => 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));

    const DEFAULT_TAB_ICON = svgUri(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + '<rect x="8" y="8" width="48" height="48" rx="12" fill="#dbe7fb"/></svg>');

    // 控制台条目：接入（说明）/ 调度（运行中的实例）/ 自动化 / 设置
    const CONSOLE_ITEMS = [
        {
            key: 'welcome', name: '接入', panel: 'welcome',
            icon: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                + '<circle cx="32" cy="32" r="22" fill="none" stroke="#7c8aa5" stroke-width="4"/>'
                + '<path d="M32 28 v16" stroke="#7c8aa5" stroke-width="5" stroke-linecap="round"/>'
                + '<circle cx="32" cy="20" r="3" fill="#7c8aa5"/></svg>'),
        },
        {
            key: 'programs', name: '调度', panel: 'programs',
            icon: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                + '<rect x="7" y="9" width="34" height="28" rx="6" fill="none" stroke="#8fa3c0" stroke-width="4"/>'
                + '<rect x="21" y="22" width="36" height="30" rx="6" fill="#dbe7fb" stroke="#7c8aa5" stroke-width="4"/></svg>'),
        },
        {
            key: 'appmgmt', name: 'App 管理', panel: 'appmgmt',
            icon: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                + '<rect x="10" y="16" width="44" height="34" rx="6" fill="none" stroke="#7c8aa5" stroke-width="4"/>'
                + '<path d="M10 26h44" stroke="#7c8aa5" stroke-width="4"/>'
                + '<circle cx="18" cy="21" r="2.5" fill="#7c8aa5"/></svg>'),
        },
        {
            key: 'automation', name: '自动化', panel: 'automation',
            icon: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                + '<circle cx="32" cy="32" r="8" fill="none" stroke="#7c8aa5" stroke-width="4"/>'
                + '<path d="M32 12 v8 M32 44 v8 M12 32 h8 M44 32 h8" stroke="#7c8aa5" stroke-width="4" stroke-linecap="round"/>'
                + '<circle cx="32" cy="32" r="22" fill="none" stroke="#aebbd0" stroke-width="3" stroke-dasharray="4 6"/></svg>'),
        },
        {
            key: 'settings', name: '设置', panel: 'settings',
            icon: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
                + '<circle cx="32" cy="32" r="11" fill="none" stroke="#7c8aa5" stroke-width="5"/>'
                + '<g stroke="#7c8aa5" stroke-width="5" stroke-linecap="round">'
                + '<line x1="32" y1="8" x2="32" y2="15"/><line x1="32" y1="49" x2="32" y2="56"/>'
                + '<line x1="8" y1="32" x2="15" y2="32"/><line x1="49" y1="32" x2="56" y2="32"/></g></svg>'),
        },
    ];

    /* ================= 主体（分区 Tab） ================= */
    async function loadZones() {
        try {
            const r = await iChen.PyAPI.scanZones();
            state.zones = (r && r.zones) || [];
        } catch (e) {
            state.zones = [];
        }
        renderZoneTabs();
        return state.zones;
    }

    function renderZoneTabs() {
        const box = $('zone-tabs');
        if (!box) return;
        box.innerHTML = '';
        (state.zones || []).forEach((z) => {
            const b = document.createElement('button');
            b.className = 'tab zone-tab';
            b.dataset.zone = z.key;
            if (state.zone === z.key) b.classList.add('active');
            b.title = z.description ? (z.name + ' · ' + z.description) : z.name;
            const img = document.createElement('img');
            img.className = 'tab-icon';
            img.src = z.icon_data || DEFAULT_TAB_ICON;
            img.alt = '';
            const s = document.createElement('span');
            // 名称宽度固定：≤3 字原样；>3 字显示"前 2 字 + …"（保证各 Tab 布局一致）
            const chars = Array.from(z.name || z.key || '');
            s.textContent = chars.length <= 3 ? chars.join('') : chars.slice(0, 2).join('') + '…';
            s.title = chars.join('');
            b.appendChild(img);
            b.appendChild(s);
            b.addEventListener('click', () => { clickZone(z.key); });
            // 右键 Tab 图标 → 分区操作菜单（新建 App / 新建文件夹 / 删除分区）
            b.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (iChen.Tree && iChen.Tree.showZoneMenu) iChen.Tree.showZoneMenu(z.key, z.name, e.clientX, e.clientY);
            });
            box.appendChild(b);
        });
    }

    /** 点击主体 Tab：先重扫分区元数据（Tab 栏自身的名称/图标也一起刷新），再激活。
     *  再点当前 Tab（列表展开中）→ 折叠列表；已折叠时点 → 展开。 */
    async function clickZone(key) {
        await loadZones();
        if ((state.zones || []).some((x) => x.key === key)) {
            if (state.zone === key && !state.collapsed) { collapsePane(); return; }
            activate(key);
        } else {
            await reload(); // 分区刚被改名/删除 → 走回退逻辑
        }
    }

    function setTabActive(key) {
        document.querySelectorAll('#tabbar .tab').forEach((t) => {
            t.classList.toggle('active', t.dataset.zone === key);
        });
    }

    /** 激活一个主体（分区 key 或 'console'） */
    function activate(key) {
        if (key === 'console') { activateConsole(); return; }
        const z = (state.zones || []).find((x) => x.key === key);
        if (!z) return;
        // 是否真正切换了主体（折叠后再点同 Tab 展开 = 同主体，不重放淡入）
        const zoneChanged = (state.zone !== key);
        state.collapsed = false; // 点击主体 Tab：若列表处于折叠则自动展开
        state.zone = key;
        state.item = null;
        setTabActive(key);

        // 列表区（折叠走 CSS 过渡，不用 display:none）
        syncPaneClass();
        $('listpane-title').textContent = z.name;

        // 内容：面板全部隐藏（保留 App 实例，后台挂起）
        hidePanels();
        if (iChen.AppFrame) iChen.AppFrame.showForZone(key); // 该分区上次运行的程序（没有则占位）

        // 渲染该分区的目录树（仅真正切换分区时淡入）
        if (iChen.Tree) iChen.Tree.refreshForZone(key, z.name, zoneChanged);
        syncPaneToggle();
        document.dispatchEvent(new CustomEvent('ichen:zone-changed', { detail: { zone: key, zoneName: z.name } }));
    }

    /* ================= 控制台（设置等条目） ================= */
    async function activateConsole() {
        // 是否真正切到控制台（折叠后再点同 Tab 展开 = 同主体，不重放面板淡入）
        const zoneChanged = (state.zone !== 'console');
        state.collapsed = false;
        state.zone = 'console';
        setTabActive('console');

        syncPaneClass();
        $('listpane-title').textContent = '控制台';

        renderConsoleList();

        // 恢复上次所在的控制台条目（运行时记忆）；没有则默认第一个
        const remembered = state.consoleItem && CONSOLE_ITEMS.some((x) => x.key === state.consoleItem)
            ? state.consoleItem
            : (CONSOLE_ITEMS.length ? CONSOLE_ITEMS[0].key : null);
        selectConsoleItem(remembered, zoneChanged);
        syncPaneToggle();
    }

    function renderConsoleList() {
        const root = $('app-tree');
        root.innerHTML = '';
        $('tree-empty').hidden = true;

        CONSOLE_ITEMS.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'trow trow-app console-item';
            row.dataset.kind = 'console';
            row.dataset.key = item.key;
            if (state.item === item.key) row.classList.add('active');

            const arrow = document.createElement('span');
            arrow.className = 'spacer-arrow';

            const img = document.createElement('img');
            img.className = 'trow-icon';
            img.src = item.icon || DEFAULT_TAB_ICON;
            img.alt = '';

            const name = document.createElement('span');
            name.className = 'trow-name';
            name.textContent = item.name;

            row.appendChild(arrow);
            row.appendChild(img);
            row.appendChild(name);
            row.addEventListener('click', () => selectConsoleItem(item.key));
            root.appendChild(row);
        });
    }

    function hidePanels() {
        $('settings-view').hidden = true;
        $('processes-view').hidden = true;
        $('welcome-view').hidden = true;
        $('appmgmt-view').hidden = true;
        $('automation-view').hidden = true;
    }

    function selectConsoleItem(key, animate) {
        const item = CONSOLE_ITEMS.find((x) => x.key === key);
        if (!item) return;

        // 同一条目重复激活（如折叠后展开）不重放淡入；切换条目才淡入
        const itemChanged = (state.consoleItem !== key);
        state.item = key;
        state.consoleItem = key; // 运行时记忆：控制台切走再回来时恢复到此条目
        document.querySelectorAll('#app-tree .console-item').forEach((r) => {
            r.classList.toggle('active', r.dataset.key === key);
        });

        // 隐藏所有程序实例（后台挂起、不销毁）
        if (iChen.AppFrame) iChen.AppFrame.hideAll();

        const panelKey = item.panel;
        $('settings-view').hidden = (panelKey !== 'settings');
        $('processes-view').hidden = (panelKey !== 'programs');
        $('welcome-view').hidden = (panelKey !== 'welcome');
        $('appmgmt-view').hidden = (panelKey !== 'appmgmt');
        $('automation-view').hidden = (panelKey !== 'automation');
        $('stage-placeholder').hidden = true;

        if (panelKey === 'programs' && iChen.Programs) iChen.Programs.render();
        if (panelKey === 'appmgmt' && iChen.AppMgmt) iChen.AppMgmt.render();
        if (panelKey === 'automation' && iChen.Automation) iChen.Automation.render();

        // 面板淡入：仅在真正切换条目 / 切到控制台时播放
        const panelMap = {
            settings: $('settings-view'),
            programs: $('processes-view'),
            welcome: $('welcome-view'),
            appmgmt: $('appmgmt-view'),
            automation: $('automation-view'),
        };
        const panel = panelMap[panelKey] || null;
        const shouldAnimate = (animate === undefined) ? itemChanged : animate;
        if (panel && shouldAnimate && iChen.UI) iChen.UI.animateIn(panel);

        document.dispatchEvent(new CustomEvent('ichen:zone-changed', {
            detail: { zone: 'console', panel: panelKey },
        }));
    }

    /* ================= 调度（Tab 栏固定入口：前台调度器） ================= */
    /** 进入调度视图：左侧列表是「调度器」，管理前台显示哪一个 App
     *  点击条目 = 上前台 / 再点退下；舞台本身照常显示当前前台窗口 */
    function activateBackground() {
        state.zone = 'background';
        state.item = null;
        state.collapsed = false;
        setTabActive('background');
        syncPaneClass();
        $('listpane-title').textContent = '调度';
        syncPaneToggle();
        if (iChen.AppFrame) iChen.AppFrame.renderStage(); // 前台跟随当前调度状态
        renderBackgroundList();
    }

    function renderBackgroundList() {
        const root = $('app-tree');
        root.innerHTML = '';
        $('tree-empty').hidden = true;
        const list = (iChen.AppFrame && iChen.AppFrame.list) ? iChen.AppFrame.list() : [];
        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'tree-empty-note';
            empty.textContent = '没有在运行的程序。点清单里的 App 会单独上前台；在调度里多选即可并排。';
            root.appendChild(empty);
            return;
        }
        // 按打开时间排（先入先出），前台/后台只影响标签，不改变位置，方便点击
        list.sort((a, b) => a.opened_at - b.opened_at);
        list.forEach((p) => {
            const row = document.createElement('div');
            row.className = 'trow trow-app console-item' + (p.active ? ' active' : '');

            const arrow = document.createElement('span');
            arrow.className = 'spacer-arrow';
            const img = document.createElement('img');
            img.className = 'trow-icon';
            img.src = p.icon || DEFAULT_TAB_ICON;
            img.alt = '';
            const name = document.createElement('span');
            name.className = 'trow-name';
            name.textContent = p.name;
            const desc = document.createElement('span');
            desc.className = 'ami-desc';
            desc.textContent = p.active ? '前台' : '调度';

            row.appendChild(arrow);
            row.appendChild(img);
            row.appendChild(name);
            row.appendChild(desc);
            row.addEventListener('click', () => toggleForeground(p));
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const menu = [];
                if (p.active) {
                    menu.push({ label: '退回调度', action: () => toggleForeground(p) });
                } else {
                    menu.push({ label: '放到前台（并排）', action: () => toggleForeground(p) });
                }
                menu.push({ label: '单独显示', action: () => soloInstance(p) });
                menu.push({ label: '重启', action: () => restartInstance(p) });
                menu.push({ label: '终止', danger: true, action: () => killInstance(p) });
                iChen.UI.showContextMenu(menu, e.clientX, e.clientY, row);
            });
            root.appendChild(row);
        });
    }

    /** 调度器点击：上前台 / 退回调度 切换（可多个窗口并排） */
    function toggleForeground(p) {
        if (iChen.AppFrame) iChen.AppFrame.toggle(p.id);
    }

    /** 单独显示：前台只留它 */
    function soloInstance(p) {
        if (iChen.AppFrame) iChen.AppFrame.soloStage(p.id);
    }

    async function killInstance(p) {
        if (!await iChen.Dialog.confirm('终止「' + p.name + '」？该程序将结束运行，未保存的数据会丢失。', '确认终止')) return;
        if (iChen.AppFrame) await iChen.AppFrame.terminate(p.id);
        if (iChen.UI) iChen.UI.showToast('已终止：' + p.name);
    }

    async function restartInstance(p) {
        if (iChen.AppFrame && iChen.AppFrame.restart) await iChen.AppFrame.restart(p.id);
        if (iChen.UI) iChen.UI.showToast('已重启：' + p.name);
    }

    /** 运行时长显示统一在 iChen.UI.fmtDuration（后台列表 / 程序面板共用） */

    /** 手动刷新：重扫 zones（新增/删除一级文件夹 → Tab 变化）并刷新当前视图 */
    async function reload() {
        await loadZones();
        if (state.zone === 'console') { renderConsoleList(); return; }
        if (state.zone === 'background') { renderBackgroundList(); return; }
        const current = state.zone && state.zone !== 'console';
        if (current && !(state.zones || []).some((z) => z.key === state.zone)) {
            state.zone = null; // 当前分区已被删除/不存在 → 回退
        }
        const fallback = (state.zones && state.zones.length) ? state.zones[0].key : 'console';
        activate(state.zone || fallback);
    }

    /* ================= 列表开关与后台按钮（固定顶部状态栏左侧） ================= */
    function syncPaneClass() {
        $('shell-row').classList.toggle('collapsed', state.collapsed);
    }

    /** 高亮调度 Tab：处于调度视图时点亮（折叠列表不熄灭，与其他 Tab 行为一致） */
    function syncPaneToggle() {
        const btn = $('btn-pane-toggle');
        if (!btn) return;
        btn.classList.toggle('active', state.zone === 'background');
    }

    /** 折叠左侧列表（折叠职能已移交给 Tab 图标：再点当前 Tab 即折叠） */
    function collapsePane() {
        state.collapsed = true;
        syncPaneClass();
        syncPaneToggle();
    }

    /* ================= 暴露 ================= */
    iChen.Shell = {
        getZone: () => state.zone,
        getZones: () => state.zones,
        activate,
        activateConsole,
        activateBackground,
        selectConsoleItem,
        reload,
    };

    /* ================= 事件绑定 ================= */
    document.addEventListener('DOMContentLoaded', () => {
        // 左上按钮 = 调度入口：点击出现运行中程序的列表（右键 重启/终止）
        $('btn-pane-toggle').addEventListener('click', () => {
            if (state.zone === 'background' && !state.collapsed) collapsePane();
            else activateBackground();
        });
        // 再点控制台 Tab：列表展开中 → 折叠
        $('tab-console').addEventListener('click', () => {
            if (state.zone === 'console' && !state.collapsed) collapsePane();
            else activateConsole();
        });

        // 列表区拖宽：右缘手柄，180–320px；拖过 130px 阈值即折叠（展开仍由再点当前 Tab 负责）。
        // 宽度写在根元素 --lpw，只存本次会话，不做本地持久化。
        const LP_MIN = 180, LP_MAX = 320, LP_FOLD = 130;
        const lpResize = $('lp-resize');
        if (lpResize) {
            lpResize.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const row = $('shell-row');
                row.classList.add('lp-dragging');
                // 全屏遮罩接管事件，防止鼠标划到舞台 iframe 上时跟丢
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:col-resize;';
                document.body.appendChild(overlay);
                const startX = e.clientX;
                const startW = $('list-pane').offsetWidth;
                const mv = (ev) => {
                    if (state.collapsed) return; // 已折叠：继续拖不展开，由 Tab 点击负责
                    let w = startW + ev.clientX - startX;
                    if (w < LP_FOLD) { collapsePane(); return; }
                    w = Math.min(Math.max(w, LP_MIN), LP_MAX);
                    document.documentElement.style.setProperty('--lpw', w + 'px');
                };
                const up = () => {
                    row.classList.remove('lp-dragging');
                    overlay.remove();
                    document.removeEventListener('mousemove', mv);
                    document.removeEventListener('mouseup', up);
                };
                document.addEventListener('mousemove', mv);
                document.addEventListener('mouseup', up);
            });
        }

        // 接入页：规格预览填充 + 一键复制绑定
        initWelcomeDoc();

        // 实例增减时同步调度列表
        document.addEventListener('ichen:instances-changed', () => {
            if (state.zone === 'background') renderBackgroundList();
        });

        // 启动即自动扫描 apps/（重扫分区 → 激活首个分区 → 加载其目录树），
        // 新增 / 删除文件夹后重开中枢即可见，无需手动刷新。
        reload().catch(() => {
            activate('console');
        });

        // pywebview 的 js_api 注入晚于 DOMContentLoaded：首次扫描大概率拿到
        // "未连接桥" 的空结果。桥就绪后若分区仍为空则自动重扫一次（替代原刷新按钮）。
        document.addEventListener('ichen:bridge-ready', () => {
            if (!(state.zones || []).length) reload().catch(() => {});
        });
    });
})();
