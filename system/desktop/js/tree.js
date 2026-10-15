/* ============================================================
   tree.js - 目录树（分区内 apps 扫描渲染）
   - 由 Shell.activate(分区) 驱动：refreshForZone(zoneKey, zoneName)
   - 分类/App 图标用 data URI；无预置条目；空态提示当前分区无 App
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};
    const $ = (id) => document.getElementById(id);

    // 缺省图标（base64 data URI，渲染最稳）
    const b64 = (svg) => 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const DEFAULT_FOLDER = b64(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + '<path d="M8 14 L30 14 L36 20 L56 20 L56 50 L8 50 Z" fill="#e8edf5" stroke="#b6c6dd"/>'
        + '<path d="M8 20 L56 20" stroke="#b6c6dd"/></svg>');
    const DEFAULT_APP = b64(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + '<rect x="8" y="8" width="48" height="48" rx="12" fill="#dbe7fb" stroke="#8fb0e6"/>'
        + '<circle cx="32" cy="32" r="10" fill="#8fb0e6"/></svg>');

    const ARROW_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" style="display:block">'
        + '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    let currentZone = null;
    let currentZoneName = '';
    let currentTree = [];
    // 文件夹收起状态（运行时记忆，仅存于当前页面生命周期）：
    // key 为节点 path；默认全部展开，用户收起的记住，切分区/重渲染后恢复
    const collapsedFolders = new Set();

    /* ---------- 行元素 ---------- */
    function iconEl(node) {
        const img = document.createElement('img');
        img.className = 'trow-icon';
        img.src = node.icon_data || (node.type === 'folder' ? DEFAULT_FOLDER : DEFAULT_APP);
        img.alt = '';
        return img;
    }

    function folderRow(node, open) {
        const row = document.createElement('div');
        row.className = 'trow trow-folder' + (open ? ' open' : '');
        row.dataset.kind = 'folder';
        row.setAttribute('role', 'button');
        row.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.dataset.path = node.path || '';
        row._node = node;
        const arrow = document.createElement('span');
        arrow.className = 'fold-arrow';
        arrow.innerHTML = ARROW_SVG;
        const name = document.createElement('span');
        name.className = 'trow-name';
        name.textContent = node.name;
        row.appendChild(arrow);
        row.appendChild(iconEl(node));
        row.appendChild(name);
        return row;
    }

    function appRow(node) {
        const row = document.createElement('div');
        row.className = 'trow trow-app';
        row.dataset.kind = 'app';
        row._node = node; // 供点击时把完整节点交给 AppFrame
        const spacer = document.createElement('span');
        spacer.className = 'spacer-arrow';
        const name = document.createElement('span');
        name.className = 'trow-name';
        name.textContent = node.name;
        const open = document.createElement('span');
        open.className = 'trow-open';
        open.innerHTML = ARROW_SVG;
        row.appendChild(spacer);
        row.appendChild(iconEl(node));
        row.appendChild(name);
        row.appendChild(open);
        return row;
    }

    /* ---------- 递归渲染 ---------- */
    function renderList(container, nodes) {
        nodes.forEach((node) => {
            if (node.type === 'folder') {
                const key = node.path || node.name;
                const open = !collapsedFolders.has(key);
                const box = document.createElement('div');
                box.appendChild(folderRow(node, open));
                const childBox = document.createElement('div');
                childBox.className = 'trow-children';
                // 收起状态不仅恢复箭头（.open），子盒也要同步隐藏——否则重渲染后子项又全部露出
                if (!open) childBox.style.display = 'none';
                renderList(childBox, node.children || []);
                box.appendChild(childBox);
                container.appendChild(box);
            } else if (node.type === 'app') {
                container.appendChild(appRow(node));
            }
        });
    }

    function countApps(nodes) {
        let n = 0;
        (nodes || []).forEach((x) => {
            if (x.type === 'app') n += 1;
            else n += countApps(x.children);
        });
        return n;
    }

    function renderTree(tree) {
        currentTree = tree || [];
        const root = $('app-tree');
        root.innerHTML = '';
        const emptyEl = $('tree-empty');
        const hasApp = countApps(tree) > 0;
        emptyEl.hidden = hasApp;
        emptyEl.innerHTML = hasApp ? '' : (currentZoneName || currentZone || '该分区')
            + '暂无 App。<br>往 apps/' + (currentZone ? currentZone + '/' : '')
            + ' 放一个含 manifest.json 的文件夹即会出现；此列表只镜像目录，无预置内容。';
        renderList(root, tree || []);
        // 新列表替换旧列表时统一淡入；因不再先清空成"扫描中"占位，所以不会闪烁
        if (iChen.UI) iChen.UI.animateIn(root);
    }

    /* ---------- 按分区刷新 ---------- */
    async function refreshForZone(zoneKey, zoneName) {
        currentZone = zoneKey;
        currentZoneName = zoneName || zoneKey || '';
        const container = $('app-tree');
        // 关键：不清空、不显示"扫描中"占位。保留旧列表作为底图，
        // 扫描完成后 renderTree 直接替换并淡入，避免"清空→扫描中→内容"的闪烁。
        try {
            const r = await iChen.PyAPI.scanApps(zoneKey);
            if (r && r.error) {
                container.innerHTML = '<div class="tree-empty-note">' + r.error + '</div>';
                $('tree-empty').hidden = true;
                return;
            }
            renderTree(r.tree || []);
        } catch (e) {
            container.innerHTML = '<div class="tree-empty-note">扫描失败：' + e + '</div>';
        }
    }

    /* ---------- 点击处理（事件委托） ---------- */
    function onTreeClick(e) {
        const row = e.target.closest('.trow');
        if (!row) return;
        if (row.dataset.kind === 'folder') {
            row.classList.toggle('open');
            const open = row.classList.contains('open');
            row.setAttribute('aria-expanded', open ? 'true' : 'false');
            const node = row._node;
            const key = node ? (node.path || node.name) : row.dataset.path;
            if (key) {
                if (open) collapsedFolders.delete(key);
                else collapsedFolders.add(key);
            }
            const childBox = row.nextElementSibling;
            if (childBox && childBox.classList.contains('trow-children')) {
                childBox.style.display = childBox.style.display === 'none' ? '' : 'none';
            }
            e.stopPropagation();
            return;
        }
        if (row.dataset.kind === 'app') {
            document.querySelectorAll('#app-tree .trow-app').forEach((r) => r.classList.remove('active'));
            row.classList.add('active');
            if (iChen.AppFrame && row._node) iChen.AppFrame.open(row._node);
        }
    }

    /* ---------- 右键菜单 ---------- */
    function onContextMenu(e) {
        const appRow = e.target.closest('.trow-app');
        if (appRow && appRow._node) {
            e.preventDefault();
            const app = appRow._node;
            const afterChange = () => { if (iChen.Shell) iChen.Shell.reload(); };
            const a = iChen.AppMgmt.makeAppActions(app, afterChange);
            iChen.UI.showContextMenu([
                { label: '移动', action: a.move },
                { label: '重命名', action: a.rename },
                { label: '修改图标', action: a.setIcon },
                { label: '导出 miniapp', action: a.exportMiniapp },
                { label: '删除', action: a.uninstall, danger: true },
            ], e.clientX, e.clientY, appRow);
            return;
        }
        // 文件夹行右键（分类）：重命名 / 删除
        const folderRow = e.target.closest('.trow-folder');
        if (folderRow && folderRow._node) {
            e.preventDefault();
            const node = folderRow._node;
            const afterChange = () => { if (iChen.Shell) iChen.Shell.reload(); };
            const rename = async () => {
                const v = await iChen.Dialog.prompt('新的文件夹名', '改名', node.name);
                if (v == null || !v.trim()) return;
                const r = await iChen.PyAPI.renameFolder(node.path, v.trim());
                if (iChen.UI) iChen.UI.showToast(r && r.ok ? '已改名：' + v.trim() : ('改名失败：' + (r && r.error)));
                if (r && r.ok) afterChange();
            };
            const setIcon = async () => {
                const picked = await iChen.PyAPI.pickFiles('open', false, 'svg', '');
                if (!picked || !picked.ok || !(picked.paths || []).length) return;
                const r = await iChen.PyAPI.setFolderIcon(node.path, picked.paths[0]);
                if (iChen.UI) iChen.UI.showToast(r && r.ok ? '已更新图标' : ('图标更新失败：' + (r && r.error)));
                if (r && r.ok) afterChange();
            };
            iChen.UI.showContextMenu([
                {
                    label: '新建 App',
                    submenu: [
                        { label: '导入文件夹', action: () => iChen.AppMgmt.newApp('import', node.path) },
                        { label: '导入 miniapp 包', action: () => iChen.AppMgmt.newApp('importMiniapp', node.path) },
                        { label: '导入 HTML 文件', action: () => iChen.AppMgmt.newApp('importHtml', node.path) },
                        { label: '输入 HTML', action: () => iChen.AppMgmt.newApp('html', node.path) },
                        { label: '输入 URL', action: () => iChen.AppMgmt.newApp('url', node.path) },
                    ],
                },
                { label: '新建文件夹', action: () => iChen.AppMgmt.newFolder(node.path) },
                { label: '重命名', action: rename },
                { label: '修改图标', action: setIcon },
                { label: '删除文件夹', danger: true, action: () => iChen.AppMgmt.deleteFolder(node, false, afterChange) },
            ], e.clientX, e.clientY, folderRow);
            return;
        }
        // 空白处右键 → 新建菜单
        if (!e.target.closest('.trow')) {
            e.preventDefault();
            if (iChen.AppMgmt) iChen.AppMgmt.showNewMenu(e.clientX, e.clientY);
        }
    }

    /* ---------- 分区菜单（Tab 栏图标右键，v3.1.2 起从列表标题迁来） ---------- */
    function showZoneMenu(zoneKey, zoneName, x, y) {
        const zonePath = zoneKey;
        const afterChange = () => { if (iChen.Shell) iChen.Shell.reload(); };
        // 删除分区需要 children 提示"有内容"：仅当前展示的分区拿得到，其余传空
        const children = (zoneKey === currentZone) ? currentTree : null;
        iChen.UI.showContextMenu([
            {
                label: '新建 App',
                submenu: [
                    { label: '导入文件夹', action: () => iChen.AppMgmt.newApp('import', zonePath) },
                    { label: '导入 HTML 文件', action: () => iChen.AppMgmt.newApp('importHtml', zonePath) },
                    { label: '输入 HTML', action: () => iChen.AppMgmt.newApp('html', zonePath) },
                    { label: '输入 URL', action: () => iChen.AppMgmt.newApp('url', zonePath) },
                ],
            },
            { label: '新建文件夹', action: () => iChen.AppMgmt.newFolder(zonePath) },
            {
                label: '删除分区', danger: true,
                action: () => iChen.AppMgmt.deleteFolder(
                    { name: zoneName || zonePath, path: zonePath, children: children }, true, afterChange),
            },
        ], x, y);
    }

    /* ---------- 暴露 ---------- */
    iChen.Tree = {
        init() {
            $('app-tree').addEventListener('click', onTreeClick);
            $('app-tree').addEventListener('contextmenu', onContextMenu);
        },
        showZoneMenu,
        refreshForZone,
    };
})();
