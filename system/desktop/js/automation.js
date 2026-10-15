/* ============================================================
   automation.js - 控制台 → 自动化
   - 规则：触发器（打开 App / cron / 中枢启动）→ 动作（后台运行某个 App）
   - 动作执行：openBackground 只挂载隐藏实例，前台界面保持不变
   - 列表：启用开关 / 编辑 / 删除；表单下拉统一用玻璃材质自绘组件
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};
    const $ = (id) => document.getElementById(id);

    let _apps = [];   // 扁平化 App 列表：{id, name, zone, node}（node 为扫描树原始节点，供后台挂载）
    let _rules = [];
    let _startupFired = false; // 中枢启动触发器每次运行只执行一次

    /* ---------- 工具 ---------- */
    function toast(ok, okMsg, err) {
        if (ok) {
            if (iChen.UI) iChen.UI.showToast(okMsg);
        } else if (iChen.Notify) {
            iChen.Notify.error(err || '操作失败');
        } else if (iChen.UI) {
            iChen.UI.showToast(err || '操作失败');
        }
    }

    function appName(id) {
        const a = _apps.find((x) => x.id === id);
        return a ? a.name : (id || '—');
    }

    function nodeOf(id) {
        const a = _apps.find((x) => x.id === id);
        return a ? a.node : null;
    }

    function flattenTree(nodes, zone, out) {
        (nodes || []).forEach((n) => {
            if (n.type === 'app') {
                out.push({ id: n.id, name: n.name || n.id, zone: zone, node: n });
            } else if (n.children && n.children.length) {
                flattenTree(n.children, zone, out);
            }
        });
        return out;
    }

    async function loadApps() {
        try {
            const r = await iChen.PyAPI.scanApps('');
            const tree = (r && r.tree) || [];
            const out = [];
            (tree || []).forEach((zone) => {
                if (zone.children) flattenTree(zone.children, zone.name || zone.key, out);
            });
            _apps = out;
        } catch (e) {
            _apps = [];
        }
    }

    async function loadRules() {
        try {
            const r = await iChen.PyAPI.listAutomationRules();
            _rules = (r && r.rules) || [];
        } catch (e) {
            _rules = [];
        }
    }

    /* ---------- 动作执行：后台启动运行 App（前台不变） ---------- */
    async function startAppBackground(appId) {
        if (!appId) return { ok: false, error: '未指定目标 App' };
        if (!iChen.AppFrame || !iChen.AppFrame.openBackground) {
            return { ok: false, error: 'AppFrame 未就绪' };
        }
        let node = nodeOf(appId);
        if (!node) await loadApps();           // 缓存没有（如刚启动）就现扫一次
        node = nodeOf(appId);
        if (!node) return { ok: false, error: '未找到 App: ' + appId };
        return iChen.AppFrame.openBackground(node);
    }

    /** 执行一条规则的动作；失败时通知（成功保持安静，不打扰前台） */
    async function executeRule(r) {
        const a = r.action || {};
        if (a.type === 'run_app') {
            const res = await startAppBackground(a.appId);
            if (!res || !res.ok) {
                if (iChen.Notify) {
                    iChen.Notify.error('自动化「' + (r.name || '未命名') + '」执行失败：' + ((res && res.error) || '未知错误'));
                }
                return false;
            }
            return true;
        }
        return false;
    }

    /** App 打开事件：匹配 enabled 且 trigger=app_open 且 appId 命中的规则，后台执行动作 */
    async function onAppOpen(appId) {
        if (!appId) return;
        await loadRules();
        for (const r of _rules) {
            if (!r.enabled) continue;
            const t = r.trigger || {};
            if (t.type !== 'app_open' || String(t.appId || '') !== String(appId)) continue;
            await executeRule(r);
        }
    }

    /** 中枢启动事件：匹配 trigger=startup 的启用规则，后台启动指定 App（每次运行仅一次） */
    async function onStartup() {
        if (_startupFired) return;
        // 桥未就绪时不触发；由 bridge-ready 事件再次调用
        if (!iChen.PyAPI || !iChen.PyAPI.isReady || !iChen.PyAPI.isReady()) return;
        _startupFired = true;
        await loadApps();
        await loadRules();
        for (const r of _rules) {
            if (!r.enabled) continue;
            const t = r.trigger || {};
            if (t.type !== 'startup') continue;
            await executeRule(r);
        }
    }

    /* ---------- 渲染 ---------- */
    function triggerText(r) {
        const t = r.trigger || {};
        if (t.type === 'app_open') return '打开 App：' + appName(t.appId);
        if (t.type === 'cron') return 'cron：' + (t.cron || '—');
        if (t.type === 'startup') return '中枢启动时';
        return '—';
    }

    function actionText(r) {
        const a = r.action || {};
        if (a.type === 'run_app') return '后台运行 App：' + appName(a.appId);
        return '—';
    }

    function paint() {
        const host = $('automation-list');
        if (!host) return;
        if (!_rules.length) {
            host.innerHTML = '<div class="app-manage-empty">还没有自动化规则。点击右上角「新建规则」添加。<br>'
                + '触发器支持：打开某个 App、cron 定时、中枢启动时；动作目前支持：后台运行某个 App。</div>';
            return;
        }
        host.innerHTML = '';
        _rules.forEach((r) => {
            const card = document.createElement('div');
            card.className = 'auto-card' + (r.enabled ? '' : ' auto-disabled');

            const head = document.createElement('div');
            head.className = 'auto-card-head';

            const left = document.createElement('div');
            left.className = 'auto-card-title';
            const name = document.createElement('span');
            name.className = 'auto-name';
            name.textContent = r.name || '未命名规则';
            const tag = document.createElement('span');
            tag.className = 'auto-tag' + (r.enabled ? ' auto-tag-on' : ' auto-tag-off');
            tag.textContent = r.enabled ? '已启用' : '已停用';
            left.appendChild(name);
            left.appendChild(tag);

            const right = document.createElement('div');
            right.className = 'auto-card-actions';
            const tog = document.createElement('label');
            tog.className = 'auto-switch';
            tog.title = r.enabled ? '点击停用' : '点击启用';
            const sw = document.createElement('input');
            sw.type = 'checkbox';
            sw.checked = !!r.enabled;
            sw.addEventListener('change', () => onToggle(r, sw.checked));
            tog.appendChild(sw);
            tog.appendChild(document.createElement('span'));
            right.appendChild(tog);

            const edit = document.createElement('button');
            edit.className = 'btn';
            edit.textContent = '编辑';
            edit.addEventListener('click', () => openForm(r));
            right.appendChild(edit);

            const del = document.createElement('button');
            del.className = 'btn btn-danger';
            del.textContent = '删除';
            del.addEventListener('click', () => onDelete(r));
            right.appendChild(del);

            head.appendChild(left);
            head.appendChild(right);
            card.appendChild(head);

            const body = document.createElement('div');
            body.className = 'auto-card-body';
            const trow = document.createElement('div');
            trow.className = 'auto-row';
            trow.innerHTML = '<span class="auto-row-label">触发</span><span class="auto-row-val"></span>';
            trow.querySelector('.auto-row-val').textContent = triggerText(r);
            const arow = document.createElement('div');
            arow.className = 'auto-row';
            arow.innerHTML = '<span class="auto-row-label">动作</span><span class="auto-row-val"></span>';
            arow.querySelector('.auto-row-val').textContent = actionText(r);
            body.appendChild(trow);
            body.appendChild(arow);
            card.appendChild(body);

            host.appendChild(card);
        });
    }

    /* ---------- 操作 ---------- */
    async function onToggle(r, enabled) {
        const res = await iChen.PyAPI.toggleAutomationRule(r.id, enabled);
        if (res && res.ok) {
            r.enabled = enabled;
            toast(true, '已' + (enabled ? '启用' : '停用') + '规则');
        } else {
            toast(false, null, (res && res.error) || '切换失败');
        }
        paint();
    }

    async function onDelete(r) {
        const ok = await iChen.Dialog.confirm('确定删除规则「' + (r.name || '未命名') + '」？', '删除规则');
        if (!ok) return;
        const res = await iChen.PyAPI.deleteAutomationRule(r.id);
        if (res && res.ok) {
            toast(true, '已删除规则');
            await loadRules();
            paint();
        } else {
            toast(false, null, (res && res.error) || '删除失败');
        }
    }

    /* ---------- 玻璃下拉选择（替代浏览器原生 select，风格与右键菜单一致） ---------- */
    function makeSelect(options, value, onChange) {
        const wrap = document.createElement('div');
        wrap.className = 'gsel';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dlg-input gsel-btn';
        const label = document.createElement('span');
        label.className = 'gsel-label';
        btn.appendChild(label);
        wrap.appendChild(btn);

        let val = value;
        let opts = options || [];
        let menu = null;

        function sync() {
            const cur = opts.find((o) => o.value === val);
            label.textContent = cur ? cur.label : '— 选择 —';
            label.style.color = cur ? '' : 'var(--color-text-secondary)';
        }

        function closeMenu() {
            if (!menu) return;
            menu.remove();
            menu = null;
            document.removeEventListener('mousedown', onOutside, true);
        }

        function onOutside(e) {
            if (menu && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
        }

        function openMenu() {
            if (menu) { closeMenu(); return; }
            menu = document.createElement('div');
            menu.className = 'gsel-menu';
            if (!opts.length) {
                const empty = document.createElement('div');
                empty.className = 'gsel-item gsel-empty';
                empty.textContent = '（暂无可选项）';
                menu.appendChild(empty);
            }
            opts.forEach((o) => {
                const it = document.createElement('div');
                it.className = 'gsel-item' + (o.value === val ? ' gsel-active' : '');
                it.textContent = o.label;
                it.addEventListener('click', () => {
                    val = o.value;
                    sync();
                    closeMenu();
                    if (typeof onChange === 'function') onChange(val); // 菜单挂在 body，点击不冒泡到表单，必须显式回调
                });
                menu.appendChild(it);
            });
            // 固定定位挂在 body：不被对话框裁剪，贴着按钮下方展开
            const rect = btn.getBoundingClientRect();
            menu.style.minWidth = rect.width + 'px';
            document.body.appendChild(menu);
            const mh = menu.getBoundingClientRect();
            let top = rect.bottom + 4;
            if (top + mh.height > window.innerHeight - 8) {
                top = Math.max(8, rect.top - mh.height - 4); // 下方放不下则向上展开
            }
            menu.style.left = Math.max(8, rect.left) + 'px';
            menu.style.top = top + 'px';
            setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
        }

        btn.addEventListener('click', openMenu);
        sync();

        return {
            el: wrap,
            get value() { return val; },
            set value(v) { val = v; sync(); },
            setOptions(next, v) { opts = next || []; if (typeof v !== 'undefined') val = v; sync(); },
        };
    }

    /* ---------- 新建/编辑表单 ---------- */
    function field(label) {
        const el = document.createElement('div');
        el.className = 'dlg-field';
        const lab = document.createElement('div');
        lab.className = 'dlg-field-label';
        lab.textContent = label;
        el.appendChild(lab);
        return el;
    }

    function appOptions() {
        return _apps.map((a) => ({ value: a.id, label: a.name + '（' + (a.zone || '') + '）' }));
    }

    function openForm(rule) {
        const editing = !!rule;
        const r = rule ? JSON.parse(JSON.stringify(rule)) : {
            id: '', name: '', enabled: true,
            trigger: { type: 'app_open', appId: '', cron: '' },
            action: { type: 'run_app', appId: '' },
        };
        if (!r.trigger) r.trigger = { type: 'app_open', appId: '', cron: '' };
        if (!r.action) r.action = { type: 'run_app', appId: '' };

        const overlay = document.createElement('div');
        overlay.className = 'dlg-overlay';
        const box = document.createElement('div');
        box.className = 'dlg';

        const title = document.createElement('div');
        title.className = 'dlg-title';
        title.textContent = editing ? '编辑规则' : '新建规则';
        box.appendChild(title);

        // 名称
        const fName = document.createElement('input');
        fName.className = 'dlg-input';
        fName.value = r.name || '';
        const fNameEl = field('名称');
        fNameEl.appendChild(fName);
        box.appendChild(fNameEl);

        // 触发器类型（玻璃下拉）
        const fTrig = makeSelect([
            { value: 'app_open', label: '打开 App' },
            { value: 'cron', label: 'cron 定时' },
            { value: 'startup', label: '中枢启动时' },
        ], r.trigger.type || 'app_open', (v) => {
            fTrigAppEl.style.display = (v === 'app_open') ? '' : 'none';
            fCronEl.style.display = (v === 'cron') ? '' : 'none';
        });
        const fTrigEl = field('触发器');
        fTrigEl.appendChild(fTrig.el);
        box.appendChild(fTrigEl);

        // 触发 App（触发器=打开 App 时显示）
        const fTrigApp = makeSelect(appOptions(), r.trigger.appId || '');
        const fTrigAppEl = field('触发 App（打开此 App 时触发）');
        fTrigAppEl.appendChild(fTrigApp.el);
        box.appendChild(fTrigAppEl);

        // cron（触发器=cron 时显示）
        const fCron = document.createElement('input');
        fCron.className = 'dlg-input';
        fCron.value = r.trigger.cron || '';
        fCron.placeholder = '例如：0 9 * * 1-5（工作日 9:00）';
        const fCronEl = field('cron 表达式（分 时 日 月 周，5 字段）');
        fCronEl.appendChild(fCron);
        box.appendChild(fCronEl);

        // 动作类型（玻璃下拉）
        const fAct = makeSelect([{ value: 'run_app', label: '后台运行某个 App' }], r.action.type || 'run_app');
        const fActEl = field('动作');
        fActEl.appendChild(fAct.el);
        box.appendChild(fActEl);

        // 目标 App（玻璃下拉）
        const fActApp = makeSelect(appOptions(), r.action.appId || '');
        const fActAppEl = field('目标 App');
        fActAppEl.appendChild(fActApp.el);
        box.appendChild(fActAppEl);

        // 初始显隐同步（后续切换由触发器下拉的 onChange 回调驱动）
        {
            const tt = fTrig.value;
            fTrigAppEl.style.display = (tt === 'app_open') ? '' : 'none';
            fCronEl.style.display = (tt === 'cron') ? '' : 'none';
        }

        const actions = document.createElement('div');
        actions.className = 'dlg-actions';
        const cancel = document.createElement('button');
        cancel.className = 'btn';
        cancel.textContent = '取消';
        const save = document.createElement('button');
        save.className = 'btn btn-primary';
        save.textContent = '保存';
        actions.appendChild(cancel);
        actions.appendChild(save);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }
        cancel.addEventListener('click', close);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

        save.addEventListener('click', async () => {
            r.name = (fName.value || '').trim();
            if (!r.name) { toast(false, null, '请填写规则名称'); return; }
            r.trigger.type = fTrig.value;
            r.trigger.appId = fTrigApp.value;
            r.trigger.cron = (fCron.value || '').trim();
            r.action.type = fAct.value;
            r.action.appId = fActApp.value;

            if (r.trigger.type === 'app_open' && !r.trigger.appId) {
                toast(false, null, '请选择触发 App'); return;
            }
            if (r.trigger.type === 'cron' && !r.trigger.cron) {
                toast(false, null, '请填写 cron 表达式'); return;
            }
            if (r.action.type === 'run_app' && !r.action.appId) {
                toast(false, null, '请选择目标 App'); return;
            }

            const res = await iChen.PyAPI.saveAutomationRule(r);
            if (res && res.ok) {
                toast(true, editing ? '已更新规则' : '已创建规则');
                close();
                await loadRules();
                paint();
            } else {
                toast(false, null, (res && res.error) || '保存失败');
            }
        });

        fName.focus();
    }

    /* ---------- 入口 ---------- */
    function bind() {
        const btn = $('btn-automation-new');
        if (btn) btn.addEventListener('click', () => openForm(null));
    }

    function init() {
        bind();
        // 中枢启动触发器：桥已就绪则立即执行，否则等 bridge-ready
        if (iChen.PyAPI.isReady()) {
            onStartup();
        } else {
            document.addEventListener('ichen:bridge-ready', () => onStartup(), { once: true });
        }
    }

    async function render() {
        const host = $('automation-list');
        if (!host) return;
        await loadApps();
        await loadRules();
        paint();
    }

    // 导出：startAppBackground 供后端 cron 到点后反向推流调用
    iChen.Automation = {
        init,
        render,
        startAppBackground,
        onAppOpen,
        onStartup,
    };
})();
