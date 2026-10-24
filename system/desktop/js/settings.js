/* ============================================================
   settings.js - 控制台 → 设置
   主题 / Tab 栏位置：持久化到 data/local_config.json（经 Python 桥），
   浏览器预览（无桥）时降级用 localStorage。
   状态行（版本 / App 总数）/ 最近通知 / 退出应用。
   App 与文件夹的增删改已移到控制台 →「App 管理」（appmgmt.js）。
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};
    const $ = (id) => document.getElementById(id);

    const THEME_KEY = 'ichen-theme';
    const ACCENT_KEY = 'ichen-accent';
    const ACCENT_CUSTOM_KEY = 'ichen-accent-custom';

    // 主题色预设：每套含「浅色模式色 + 深色模式色」两个值，作用于 --layer-base
    // （Tab 栏 / 列表 / 自绘标题栏那片统一底色）。
    const ACCENT_PRESETS = {
        default: { light: '#eef0f4', dark: '#2b2e34' },
        warm:    { light: '#f3f0ec', dark: '#322e2a' },
        blue:    { light: '#eaeef5', dark: '#2a303c' },
        green:   { light: '#edf1ec', dark: '#2c322d' },
    };

    let currentAccent = 'default';

    function store(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }
    function load(key, def) {
        try { return localStorage.getItem(key) ?? def; } catch (e) { return def; }
    }

    /* ---------- 主题 ---------- */
    function applyTheme(theme) {
        const t = (theme === 'light' || theme === 'dark') ? theme : 'system';
        document.documentElement.dataset.theme = t;
        document.querySelectorAll('#theme-options .theme-option').forEach((b) => {
            b.classList.toggle('active', b.dataset.themeOption === t);
        });
        // 深浅模式变了 → 主题色也要跟着切到对应的那一个
        applyAccent(currentAccent);
        // 舞台背景（纯色模式要跟着换深/浅色）
        applyWallpaper(currentWallpaper);
        // 主题下传 App iframe（接入规范第八节 6）
        if (iChen.AppFrame && iChen.AppFrame.broadcastTheme) iChen.AppFrame.broadcastTheme();
    }

    function setTheme(theme) {
        applyTheme(theme);
        store(THEME_KEY, theme);
        // 持久化到 data/local_config.json（下次启动由 Python 侧读回）
        iChen.PyAPI.saveLocalConfig({ theme: theme }).catch(() => { /* 离线预览时忽略 */ });
    }

    /* ---------- 主题色（--layer-base） ---------- */
    function isDarkResolved() {
        const t = document.documentElement.dataset.theme;
        if (t === 'dark') return true;
        if (t === 'light') return false;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function getAccentColors(key) {
        if (key === 'custom') {
            const stored = load(ACCENT_CUSTOM_KEY, null);
            if (stored) {
                try { return JSON.parse(stored); } catch (e) { /* fallthrough */ }
            }
            return { light: '#eef0f4', dark: '#2b2e34' };
        }
        return ACCENT_PRESETS[key] || ACCENT_PRESETS.default;
    }

    function applyAccent(key) {
        currentAccent = key;
        const colors = getAccentColors(key);
        document.documentElement.style.setProperty(
            '--layer-base', isDarkResolved() ? colors.dark : colors.light
        );
        document.querySelectorAll('#accent-options .theme-option').forEach((b) => {
            b.classList.toggle('active', b.dataset.accent === key);
        });
        const customRow = $('accent-custom-row');
        if (customRow) customRow.hidden = (key !== 'custom');
        if (key === 'custom') {
            const li = $('accent-light'), di = $('accent-dark');
            if (li) li.value = colors.light;
            if (di) di.value = colors.dark;
        }
        // 主题色下传 App iframe
        if (iChen.AppFrame && iChen.AppFrame.broadcastTheme) iChen.AppFrame.broadcastTheme();
    }

    function setAccent(key) {
        applyAccent(key);
        store(ACCENT_KEY, key);
        iChen.PyAPI.saveLocalConfig({ accent: key }).catch(() => { /* 忽略 */ });
    }

    function setAccentCustom(light, dark) {
        const obj = { light, dark };
        store(ACCENT_CUSTOM_KEY, JSON.stringify(obj));
        iChen.PyAPI.saveLocalConfig({ accent_custom: obj }).catch(() => { /* 忽略 */ });
        applyAccent('custom');
    }

    /* ---------- 空白舞台背景 ---------- */
    const WALLPAPER_KEY = 'ichen-wallpaper';           // { mode: 'none'|'color'|'image', light, dark, image }
    let currentWallpaper = { mode: 'none', light: '#f5f6f8', dark: '#1d2025', image: '' };

    function getWallpaper() { return currentWallpaper; }

    function applyWallpaper(w) {
        currentWallpaper = Object.assign({ mode: 'none', light: '#f5f6f8', dark: '#1d2025', image: '' }, w || {});
        document.querySelectorAll('#wallpaper-options .theme-option').forEach((b) => {
            b.classList.toggle('active', b.dataset.wallpaper === currentWallpaper.mode);
        });
        const colorRow = $('wallpaper-color-row');
        const imageRow = $('wallpaper-image-row');
        if (colorRow) colorRow.hidden = (currentWallpaper.mode !== 'color');
        if (imageRow) imageRow.hidden = (currentWallpaper.mode !== 'image');
        if (currentWallpaper.mode === 'color') {
            const li = $('wallpaper-light'), di = $('wallpaper-dark');
            if (li) li.value = currentWallpaper.light;
            if (di) di.value = currentWallpaper.dark;
        }
        if (currentWallpaper.mode === 'image') {
            const p = $('wallpaper-path');
            if (p) p.textContent = currentWallpaper.image ? currentWallpaper.image.split(/[\\/]/).pop() : '未选择';
        }
        // 背景写到「空白占位卡」上：只在没有窗口的那张圆角卡内显示，不影响外圈底层色
        const ph = $('stage-placeholder');
        if (ph) {
            ph.style.removeProperty('background-image');
            ph.style.removeProperty('background-color');
            if (currentWallpaper.mode === 'color') {
                ph.style.backgroundColor = isDarkResolved() ? currentWallpaper.dark : currentWallpaper.light;
                ph.style.backgroundImage = 'none';
            } else if (currentWallpaper.mode === 'image' && currentWallpaper.image) {
                ph.style.backgroundImage = 'url("file:///' + currentWallpaper.image.replace(/\\/g, '/') + '")';
                ph.style.backgroundSize = 'cover';
                ph.style.backgroundPosition = 'center';
            }
        }
        // 深浅模式切换时背景也要跟着换
        if (iChen.AppFrame && iChen.AppFrame.broadcastTheme) iChen.AppFrame.broadcastTheme();
    }

    function setWallpaper(patch) {
        applyWallpaper(Object.assign({}, currentWallpaper, patch));
        store(WALLPAPER_KEY, JSON.stringify(currentWallpaper));
        iChen.PyAPI.saveLocalConfig({ wallpaper: currentWallpaper }).catch(() => { /* 忽略 */ });
    }

    async function pickWallpaperImage() {
        const picked = await iChen.PyAPI.pickFiles('open', false, 'image', '');
        if (!picked || !picked.ok || !(picked.paths || []).length) return;
        setWallpaper({ image: picked.paths[0] });
    }

    /* ---------- Tab 栏位置（持久化到 data/local_config.json） ---------- */
    function applyTabbarPosition(pos) {
        const p = (pos === 'bottom') ? 'bottom' : 'left';
        document.documentElement.dataset.tabbar = p;
        document.querySelectorAll('#tabbar-options .theme-option').forEach((b) => {
            b.classList.toggle('active', b.dataset.tabbarOption === p);
        });
    }

    function setTabbarPosition(pos) {
        applyTabbarPosition(pos);
        iChen.PyAPI.saveLocalConfig({ tabbar_position: pos }).catch(() => { /* 忽略 */ });
    }

    /* ---------- 无边框窗口开关（持久化到 local_config，重启后生效） ---------- */
    // 当前实例的真实窗口模式（唯一门禁，来自后端 getWindowMode），开关初始态只认它
    let currentFrameless = false;

    function setFramelessSwitch(on) {
        const btn = $('frameless-switch');
        if (btn) btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }

    function syncFramelessSwitch() {
        return iChen.PyAPI.getWindowMode().then((r) => {
            currentFrameless = !!(r && r.frameless);
            setFramelessSwitch(currentFrameless);
            const row = $('frameless-restart-row');
            if (row) row.hidden = true;   // 重新同步 = 无待生效改动
        }).catch(() => { /* 忽略：保持默认关闭态 */ });
    }

    function onFramelessToggle() {
        const btn = $('frameless-switch');
        if (!btn) return;
        const next = btn.getAttribute('aria-checked') !== 'true';
        setFramelessSwitch(next);   // 先给视觉反馈，保存失败再回滚
        iChen.PyAPI.saveLocalConfig({ frameless: next }).then((r) => {
            if (r && r.status === 'error') throw new Error(r.message || '保存失败');
            const row = $('frameless-restart-row');
            if (row) row.hidden = false;
            if (iChen.Notify) iChen.Notify.info('无边框窗口设置已保存，重启后生效');
        }).catch((e) => {
            setFramelessSwitch(currentFrameless);
            if (iChen.Notify) iChen.Notify.error('设置保存失败：' + (e && e.message ? e.message : e));
        });
    }

    /* ---------- 状态行 ---------- */
    async function loadStatus() {
        try {
            const info = await iChen.PyAPI.getSystemInfo();
            $('settings-version').textContent = info.version || '—';
            const set = (id, v) => { const el = $(id); if (el) el.textContent = (v == null || v === '') ? '—' : String(v); };
            set('settings-running-count', info.running_count);
            set('settings-python', info.python);
            set('settings-platform', info.platform);
            set('settings-data-size', info.data_size);
            const dd = $('settings-data-dir');
            if (dd) { dd.textContent = info.data_dir || '—'; dd.title = info.data_dir || ''; }
            if (typeof info.app_count === 'number') {
                $('settings-app-count').textContent = String(info.app_count);
            }
        } catch (e) {
            $('settings-version').textContent = '—';
        }
        try {
            const r = await iChen.PyAPI.scanApps();
            $('settings-app-count').textContent = (r && typeof r.app_count === 'number') ? String(r.app_count) : '—';
        } catch (e) {
            $('settings-app-count').textContent = '—';
        }
    }

    /* ---------- 更新中枢（离线整包：zip / 文件夹 → 校验 → 备份 → updater 接管） ---------- */
    function initUpdate() {
        const btn = $('btn-update-pick');
        const status = $('update-status');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            try {
                // 先选 zip；用户也可在对话框里切到选文件夹（folder 模式不支持时退回）
                const pick = await iChen.PyAPI.pickFiles('open', false, 'zip');
                let path = (pick && pick.paths && pick.paths[0]) || '';
                if (!path) {
                    // 用户可能想选文件夹
                    const pickDir = await iChen.PyAPI.pickFiles('folder', false, 'all');
                    path = (pickDir && pickDir.paths && pickDir.paths[0]) || '';
                }
                if (!path) return; // 取消
                if (status) status.textContent = '正在校验更新包…';
                const chk = await iChen.PyAPI.checkUpdatePackage(path);
                if (!chk || !chk.ok) {
                    if (status) status.textContent = '';
                    if (iChen.Notify) iChen.Notify.error('更新包不可用：' + ((chk && chk.error) || '未知原因'));
                    return;
                }
                const msg = '发现新版本 v' + chk.version + '（当前 ' + chk.current + '）。\n'
                    + '将覆盖 system/ 与 shared/common/，备份现有文件后自动重启完成更新。\n'
                    + '用户数据（data/）不受影响。是否继续？';
                if (!window.confirm(msg)) { if (status) status.textContent = ''; return; }
                if (status) status.textContent = '正在启动更新程序…';
                const r = await iChen.PyAPI.applyUpdatePackage(path);
                if (r && r.ok) {
                    if (iChen.Notify) iChen.Notify.info('更新程序已启动，中枢即将自动重启');
                } else {
                    if (status) status.textContent = '';
                    if (iChen.Notify) iChen.Notify.error('更新失败：' + ((r && r.error) || '未知原因'));
                }
            } catch (e) {
                if (status) status.textContent = '';
                if (iChen.Notify) iChen.Notify.error('更新流程出错：' + (e && e.message ? e.message : e));
            }
        });
    }

    /* ---------- 诊断（最近日志 / 打开日志目录 / 导出诊断包） ---------- */
    function initDiagnostics() {
        const openBtn = $('btn-open-logs');
        const expBtn = $('btn-export-diag');
        const viewBtn = $('btn-view-logs');
        const view = $('log-view');
        const status = $('diag-status');

        if (openBtn) openBtn.addEventListener('click', async () => {
            const r = await iChen.PyAPI.openLogFolder();
            if (!r || !r.ok) {
                if (iChen.Notify) iChen.Notify.error('打开日志目录失败：' + ((r && r.error) || ''));
            }
        });
        if (expBtn) expBtn.addEventListener('click', async () => {
            if (status) status.textContent = '正在导出…';
            const r = await iChen.PyAPI.exportDiagnostics('');
            if (r && r.ok) {
                if (status) status.textContent = '已导出：' + r.path;
                if (iChen.Notify) iChen.Notify.info('诊断包已导出');
            } else {
                if (status) status.textContent = '';
                if (iChen.Notify) iChen.Notify.error('导出失败：' + ((r && r.error) || ''));
            }
        });
        if (viewBtn) viewBtn.addEventListener('click', async () => {
            const r = await iChen.PyAPI.getRecentLogs(200);
            if (!view) return;
            if (r && r.ok) {
                view.style.display = 'block';
                view.textContent = r.content || '（日志为空）';
            } else {
                view.style.display = 'block';
                view.textContent = '读取失败：' + ((r && r.error) || '');
            }
        });
    }

    /* ---------- 最近通知（控制台历史；来源见 notify.js） ---------- */
    function fmtTime(ts) {
        const d = new Date(ts);
        const p = (n) => (n < 10 ? '0' + n : '' + n);
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    async function copyText(text, btn) {
        let ok = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        } catch (e) { /* 退回 execCommand */ }
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                ta.remove();
            } catch (e) { ok = false; }
        }
        if (btn) {
            const old = btn.textContent;
            btn.textContent = ok ? '已复制' : '复制失败';
            btn.disabled = true;
            setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1200);
        }
    }

    function renderNotify() {
        const box = $('notify-list');
        if (!box || !iChen.Notify) return;
        const list = iChen.Notify.history();
        if (!list.length) {
            box.innerHTML = '<div class="app-manage-empty">本次运行还没有通知</div>';
            return;
        }
        box.innerHTML = '';
        list.forEach((n) => {
            const row = document.createElement('div');
            row.className = 'settings-row notify-row notify-' + n.level;
            const t = document.createElement('span');
            t.className = 'settings-label';
            t.textContent = fmtTime(n.ts);
            const v = document.createElement('span');
            v.className = 'settings-value';
            v.textContent = n.text;
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'btn notify-copy-btn';
            copyBtn.textContent = '复制';
            copyBtn.title = '复制通知内容';
            copyBtn.addEventListener('click', () => copyText(n.text, copyBtn));
            row.appendChild(t);
            row.appendChild(v);
            row.appendChild(copyBtn);
            box.appendChild(row);
        });
    }

    /* ---------- init ---------- */
    // 主题 / Tab 栏位置 / 舞台背景：优先读 data/local_config.json（跨设备保留），
    // 读不到再退回 localStorage（浏览器预览或首次启动）。
    function loadAndApplyConfig() {
        return iChen.PyAPI.getLocalConfig().then((c) => {
            const cfg = c || {};
            applyTabbarPosition(cfg.tabbar_position || 'left');
            // 主题色先于主题应用，避免 applyTheme 内部 applyAccent 时取到旧值
            if (cfg.accent) store(ACCENT_KEY, cfg.accent);
            if (cfg.accent_custom) store(ACCENT_CUSTOM_KEY, JSON.stringify(cfg.accent_custom));
            applyAccent(cfg.accent || load(ACCENT_KEY, 'default'));
            // 舞台背景（空白/纯色/自定义图片）
            let wp = cfg.wallpaper;
            if (!wp) {
                try { wp = JSON.parse(load(WALLPAPER_KEY, '')) || null; } catch (e) { wp = null; }
            }
            applyWallpaper(wp || { mode: 'none' });
            applyTheme(cfg.theme || load(THEME_KEY, 'system'));
        }).catch(() => {
            applyTabbarPosition('left');
            applyAccent(load(ACCENT_KEY, 'default'));
            let wp = null;
            try { wp = JSON.parse(load(WALLPAPER_KEY, '')) || null; } catch (e) { wp = null; }
            applyWallpaper(wp || { mode: 'none' });
            applyTheme(load(THEME_KEY, 'system'));
        });
    }

    iChen.Settings = {
        init() {
            loadAndApplyConfig();
            syncFramelessSwitch();
            // 桥注入晚于 DOMContentLoaded：首次读取拿到的是兜底 {}，
            // 桥就绪后必须重读一次，否则持久化的主题/Tab 位置看似"没保存"
            document.addEventListener('ichen:bridge-ready', () => {
                loadAndApplyConfig();
                syncFramelessSwitch();
            });

            document.querySelectorAll('#theme-options .theme-option').forEach((b) => {
                b.addEventListener('click', () => setTheme(b.dataset.themeOption));
            });
            document.querySelectorAll('#tabbar-options .theme-option').forEach((b) => {
                b.addEventListener('click', () => setTabbarPosition(b.dataset.tabbarOption));
            });
            document.querySelectorAll('#accent-options .theme-option').forEach((b) => {
                b.addEventListener('click', () => setAccent(b.dataset.accent));
            });
            const acLight = $('accent-light'), acDark = $('accent-dark');
            if (acLight) acLight.addEventListener('input', () => setAccentCustom(acLight.value, (acDark && acDark.value) || '#2b2e34'));
            if (acDark)  acDark.addEventListener('input',  () => setAccentCustom((acLight && acLight.value) || '#eef0f4', acDark.value));
            // 舞台背景
            document.querySelectorAll('#wallpaper-options .theme-option').forEach((b) => {
                b.addEventListener('click', () => setWallpaper({ mode: b.dataset.wallpaper }));
            });
            const wpLight = $('wallpaper-light'), wpDark = $('wallpaper-dark');
            if (wpLight) wpLight.addEventListener('input', () => setWallpaper({ light: wpLight.value }));
            if (wpDark)  wpDark.addEventListener('input',  () => setWallpaper({ dark: wpDark.value }));
            const wpPick = $('wallpaper-pick');
            if (wpPick) wpPick.addEventListener('click', pickWallpaperImage);

            // 无边框窗口开关 + 立即重启
            const flBtn = $('frameless-switch');
            if (flBtn) flBtn.addEventListener('click', onFramelessToggle);
            const restartBtn = $('frameless-restart-btn');
            if (restartBtn) restartBtn.addEventListener('click', () => {
                restartBtn.disabled = true;
                iChen.PyAPI.restartApp().then((r) => {
                    if (r && r.status === 'error') {
                        restartBtn.disabled = false;
                        if (iChen.Notify) iChen.Notify.error('重启失败：' + (r.message || ''));
                    }
                    // 成功时进程即将退出，无需复位按钮
                }).catch((e) => {
                    restartBtn.disabled = false;
                    if (iChen.Notify) iChen.Notify.error('重启失败：' + e);
                });
            });

            // 系统主题变化（theme=system 时）同步 App iframe
            try {
                const mq = window.matchMedia('(prefers-color-scheme: dark)');
                mq.addEventListener('change', () => {
                    const cur = document.documentElement.dataset.theme;
                    if (cur === 'system') applyTheme('system');
                });
            } catch (e) { /* 忽略 */ }

            loadStatus();
            initUpdate();
            initDiagnostics();

            // 设置面板被打开时刷新状态（控制台 → 设置条目）
            document.addEventListener('ichen:zone-changed', (e) => {
                if (e.detail && (e.detail.panel === 'settings' || e.detail.zone === 'settings')) {
                    loadStatus();
                    renderNotify();
                    syncFramelessSwitch();
                }
            });

            $('settings-quit').addEventListener('click', () => { iChen.PyAPI.quitApp(); });

            // 最近通知
            if (iChen.Notify) {
                iChen.Notify.onChange(renderNotify);
                const clearBtn = $('btn-notify-clear');
                if (clearBtn) clearBtn.addEventListener('click', () => iChen.Notify.clear());
            }
            renderNotify();
        },
    };
})();
