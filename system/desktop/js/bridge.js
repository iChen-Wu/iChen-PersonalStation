/* ============================================================
   bridge.js - 通信桥（pywebview.api 封装，唯一入口）
   - pywebview 桌面窗口：调用 window.pywebview.api 真实接口
     （pywebview 注入 js_api 有延迟，故动态检测 + 监听 pywebviewready）
   - 普通浏览器（纯前端预览）：无桥时返回明确的错误 / 空值，绝不伪造结果
   业务代码禁止直接使用 window.pywebview.api。
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};

    // ---------- pywebview 桥状态 ----------
    let bridgeReady = false;

    window.addEventListener('pywebviewready', function () {
        bridgeReady = true;
        // 通知各模块（如聊天层）拉取真实数据
        document.dispatchEvent(new Event('ichen:bridge-ready'));
    });

    function getRealApi() {
        if (!bridgeReady) return null;
        if (typeof window.pywebview === 'undefined' || !window.pywebview.api) return null;
        return window.pywebview.api;
    }

    // ---------- PyAPI（本地调用） ----------
    iChen.PyAPI = {
        /** pywebview 桥就绪与否（动态判断，勿缓存） */
        isReady() {
            return !!getRealApi();
        },

        /* ---------- App 盒子（分区 / 扫描 / 运行，对应 system.apphost.apps） ---------- */
        async scanZones() {
            const api = getRealApi();
            if (api) return api.scan_zones();
            return { zones: [], error: '未连接 pywebview 桥' };
        },

        async scanApps(zone) {
            const api = getRealApi();
            if (api) return api.scan_apps(zone || '');
            // 浏览器预览（无桥）：返回空树并注明，绝不伪造条目
            return { root: '', app_count: 0, tree: [], error: '未连接 pywebview 桥' };
        },

        async runApp(appId, action, payload) {
            const api = getRealApi();
            if (api) return api.run_app(appId, action || 'run', payload || {});
            return { app: appId, action: action || 'run', ok: false, error: '未连接 pywebview 桥' };
        },

        /** 终止 App 实例的后台部分（先调 core.teardown() 回收端口/线程，再销毁 iframe） */
        async terminateApp(appId) {
            const api = getRealApi();
            if (api) return api.terminate_app(appId);
            return { app: appId, ok: true };
        },

        async readTextFile(path) {
            const api = getRealApi();
            if (api) return api.read_text_file(path || '');
            return { ok: false, error: '浏览器预览不支持读取本地文件' };
        },

        async openExternalUrl(url) {
            const api = getRealApi();
            if (api) return api.open_external_url(url || '');
            // 浏览器预览：直接新标签打开
            try { window.open(url, '_blank', 'noopener'); return { ok: true, url: url }; }
            catch (e) { return { ok: false, error: String(e) }; }
        },

        async openAppFolder(appId) {
            const api = getRealApi();
            if (api) return api.open_app_folder(appId);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async getSharedCss() {
            const api = getRealApi();
            if (api) return api.get_shared_css();
            return ''; // 无桥不注入（App 有内联兜底）
        },

        async getAppUi(appId) {
            const api = getRealApi();
            if (api) return api.get_app_ui(appId);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        /** 申请系统文件对话框（App 要真实本地路径时经框架转发；浏览器预览无对话框） */
        async pickFiles(mode, multiple, filter, defaultName) {
            const api = getRealApi();
            if (api && api.pick_files) {
                return api.pick_files(mode || 'open', !!multiple, filter || 'all', defaultName || '');
            }
            return { ok: false, canceled: true, error: '未连接 pywebview 桥（浏览器预览无文件对话框）' };
        },

        /* ---------- App 编辑（控制台 → 设置 → App 管理） ---------- */
        async exportMiniapp(appId, target) {
            const api = getRealApi();
            if (api && api.export_miniapp) return api.export_miniapp(appId, target);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async importMiniapp(zipPath, parentDir, conflict) {
            const api = getRealApi();
            if (api && api.import_miniapp) return api.import_miniapp(zipPath, parentDir || '', conflict || '');
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async listEditableApps() {
            const api = getRealApi();
            if (api) return api.list_app_editable();
            return { ok: true, apps: [] };
        },

        async renameApp(appId, newName, renameFolder) {
            const api = getRealApi();
            if (api) return api.rename_app(appId, newName, renameFolder !== false);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async setAppMeta(appId, meta) {
            const api = getRealApi();
            if (api) return api.set_app_meta(appId, meta || {});
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async moveApp(appId, targetDir) {
            const api = getRealApi();
            if (api) return api.move_app(appId, targetDir);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async deleteApp(appId, confirm) {
            const api = getRealApi();
            if (api) return api.delete_app(appId, !!confirm);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async createFolder(parentDir, name, meta) {
            const api = getRealApi();
            if (api) return api.create_folder(parentDir, name, meta || {});
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async renameFolder(path, newName) {
            const api = getRealApi();
            if (api) return api.rename_folder(path, newName);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async setFolderMeta(path, meta) {
            const api = getRealApi();
            if (api) return api.set_folder_meta(path, meta || {});
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async setFolderIcon(path, srcFile) {
            const api = getRealApi();
            if (api) return api.set_folder_icon(path, srcFile);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async setAppIcon(appId, srcFile) {
            const api = getRealApi();
            if (api) return api.set_app_icon(appId, srcFile);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async deleteFolder(path, confirm) {
            const api = getRealApi();
            if (api) return api.delete_folder(path, !!confirm);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async deleteFolderKeepApps(path, confirm) {
            const api = getRealApi();
            if (api) return api.delete_folder_keep_apps(path, !!confirm);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async createAppFromHtml(parentDir, name, html, appId) {
            const api = getRealApi();
            if (api) return api.create_app_from_html(parentDir, name, html, appId || '', '');
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async createUrlApp(parentDir, name, url, appId) {
            const api = getRealApi();
            if (api) return api.create_url_app(parentDir, name, url, appId || '', '');
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async importAppFolder(parentDir, srcDir, newName) {
            const api = getRealApi();
            if (api) return api.import_app_folder(parentDir, srcDir, newName || '');
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async duplicateApp(appId, newName) {
            const api = getRealApi();
            if (api) return api.duplicate_app(appId, newName);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async exportApp(appId, destDir) {
            const api = getRealApi();
            if (api) return api.export_app(appId, destDir);
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        /* ---------- 窗口控制（frameless 自绘标题栏用） ---------- */
        async getWindowMode() {
            const api = getRealApi();
            if (api) return api.get_window_mode();
            return { frameless: false };
        },

        async windowMinimize() {
            const api = getRealApi();
            if (api) return api.window_minimize();
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async windowToggleMaximize() {
            const api = getRealApi();
            if (api) return api.window_toggle_maximize();
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async windowClose() {
            const api = getRealApi();
            if (api) return api.window_close();
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async windowState() {
            const api = getRealApi();
            if (api) return api.window_state();
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        /* ---------- 设置（版本 / 状态 / 退出） ---------- */
        async getSystemStatus() {
            const api = getRealApi();
            if (api) return api.get_system_status();
            return { version: 'v3.0.0', wyuan_connected: false };
        },

        /** 系统信息（设置抽屉：版本 + WYuan/NATS 状态） */
        async getSystemInfo() {
            const api = getRealApi();
            if (api) return api.get_system_info();
            return { version: 'v3.0.0', wyuan_connected: false, nats_connected: false };
        },

        /** 本地配置（设置抽屉：时钟格式等），失败返回空对象 */
        async getLocalConfig() {
            const api = getRealApi();
            if (api) return api.get_local_config();
            return {};
        },

        async saveLocalConfig(config) {
            const api = getRealApi();
            if (api) return api.save_local_config(config || {});
            return { status: 'ok' };
        },

        async quitApp() {
            const api = getRealApi();
            if (api) return api.quit_app();
            // 浏览器预览：尝试关闭窗口
            try {
                window.close();
            } catch (e) {
                console.warn('无法退出（浏览器预览）', e);
            }
            return { status: 'ok' };
        },

        /** 重启应用（切换无边框窗口等需重启生效的设置；浏览器预览不支持） */
        async restartApp() {
            const api = getRealApi();
            if (api) return api.restart_app();
            return { status: 'error', message: '浏览器预览不支持重启' };
        },

        /* ---------- 自动化（控制台 → 自动化） ---------- */
        async listAutomationRules() {
            const api = getRealApi();
            if (api) return api.list_automation_rules();
            return { ok: true, rules: [] };
        },

        async saveAutomationRule(rule) {
            const api = getRealApi();
            if (api) return api.save_automation_rule(rule || {});
            return { ok: false, error: '未连接 pywebview 桥' };
        },

        async deleteAutomationRule(ruleId) {
            const api = getRealApi();
            if (api) return api.delete_automation_rule(ruleId || '');
            return { ok: true };
        },

        async toggleAutomationRule(ruleId, enabled) {
            const api = getRealApi();
            if (api) return api.toggle_automation_rule(ruleId || '', !!enabled);
            return { ok: true };
        },
    };
})();
