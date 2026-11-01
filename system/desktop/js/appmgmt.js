/* ============================================================
   appmgmt.js - 控制台 → App 管理
   - 扫描 apps/ 整树：分区 / 分类文件夹 / App 分组列出
   - 文件夹：改名（目录名）、描述、图标
   - App：改名、图标、移动、打开目录、卸载
   - 新建：粘贴 HTML / URL / 导入文件夹 / 新建分类
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};
    const $ = (id) => document.getElementById(id);

    const b64 = (svg) => 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    const DEFAULT_FOLDER = b64(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + '<path d="M8 14 L30 14 L36 20 L56 20 L56 50 L8 50 Z" fill="#e8edf5"/></svg>');
    const DEFAULT_APP = b64(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + '<rect x="8" y="8" width="48" height="48" rx="12" fill="#dbe7fb"/></svg>');

    function toast(ok, okMsg, errPrefix, r) {
        const err = (r && r.error) ? String(r.error) : '未知错误';
        // 后端错误通常自带动作前缀（如"改名失败"），前端只在缺失时补前缀，避免"改名失败：改名失败:…"
        const msg = ok ? okMsg : (errPrefix && err.indexOf(errPrefix) < 0 ? (errPrefix + '：' + err) : err);
        if (ok) {
            if (iChen.UI) iChen.UI.showToast(msg);
        } else if (iChen.Notify) {
            // 失败走通知中心：Notify.error 会自己弹 toast + 写入历史（设置 → 最近通知）
            iChen.Notify.error(msg);
        } else if (iChen.UI) {
            iChen.UI.showToast(msg);
        }
    }

    /* ---------- 图标选择（预设弹窗优先，兜底直接选文件） ---------- */
    async function chooseIcon(opts) {
        if (iChen.IconPicker) return iChen.IconPicker.pick(opts || {});
        const picked = await iChen.PyAPI.pickFiles('open', false, 'svg', '');
        if (!picked || !picked.ok || !(picked.paths || []).length) return null;
        return { kind: 'file', path: picked.paths[0] };
    }

    /** 把一次图标选择落到目标上：kind = 'app'（target=appId）/ 'folder'（target=相对路径） */
    async function applyIconChoice(choice, kind, target) {
        if (!choice || choice.kind === 'none') return { ok: true, skipped: true };
        if (choice.kind === 'preset') {
            return iChen.PyAPI.applyIconPreset(kind, target, choice.presetId);
        }
        if (choice.kind === 'file') {
            return kind === 'app'
                ? iChen.PyAPI.setAppIcon(target, choice.path)
                : iChen.PyAPI.setFolderIcon(target, choice.path);
        }
        return { ok: false, error: '未知的图标选择' };
    }

    async function applyAppIcon(app, onChange) {
        const choice = await chooseIcon({ title: '修改 App 图标' });
        if (!choice) return;
        const r = await applyIconChoice(choice, 'app', app.id);
        toast(r && r.ok, '已更新图标', '图标更新失败', r);
        if (r && r.ok) (onChange || afterChange)();
    }

    async function applyFolderIcon(node, onChange) {
        const choice = await chooseIcon({ title: '修改文件夹图标' });
        if (!choice) return;
        const r = await applyIconChoice(choice, 'folder', node.path);
        toast(r && r.ok, '已更新图标', '图标更新失败', r);
        if (r && r.ok) (onChange || afterChange)();
    }

    /** 新建后套用图标选择（失败只提示，不回滚已创建的内容） */
    async function applyNewIcon(choice, kind, target) {
        if (!choice || choice.kind === 'none') return;
        const r = await applyIconChoice(choice, kind, target);
        if (!(r && r.ok)) toast(false, '', '图标设置失败', r);
    }

    /* ---------- 同父级排序（上移 / 下移） ---------- */
    function makeMove(nodes, node, parentPath, onChange) {
        const list = nodes || [];
        const i = list.findIndex((n) => n.path === node.path);
        const move = async (delta) => {
            if (i < 0) return;
            const j = i + delta;
            if (j < 0 || j >= list.length) {
                if (iChen.UI) iChen.UI.showToast(delta < 0 ? '已经在最前面' : '已经在最后面');
                return;
            }
            const arr = list.map((n) => n.path);
            arr.splice(i, 1);
            arr.splice(j, 0, list[i].path);
            const r = await iChen.PyAPI.reorderNodes(parentPath, arr);
            if (r && r.ok) {
                if (iChen.UI) iChen.UI.showToast('排序已更新');
                (onChange || afterChange)();
            } else {
                toast(false, '', '排序失败', r);
            }
        };
        return { up: () => move(-1), down: () => move(1) };
    }

    /* ---------- 拖拽排序 / 移动：拖动行时目标位置显示插入横线，松手落位 ----------
       - 同父级：纯排序，整表路径交给 reorder_nodes 写 order=1..N；
       - 任意层级进出：拖到文件夹行中部＝移入该文件夹；拖到任意行的上/下缘＝移到
         该行的父目录并落位。跨级一律走 move_node（连移带落位，两边目录的 order
         都重写）；apps/ 根层不接受 item 落位（会变成新分区）——跨分区走 Tab 落点
         （见 makeMoveTarget）；
       - 视觉跟随自绘（.drag-ghost，fixed 层）：拖出列表范围也照样按指针位置跟随，
         不受容器裁剪；但落点只在列表行区间内判定，悬在列表外时不出插入线；
       - 拖动时指针压到可滚动容器上/下缘（或越出范围），容器按纵坐标持续滚动。
       插入线宿主可单独指定——左侧树的文件夹行把线画在整个折叠盒的底缘，
       而不是文件夹行自身的下缘（后者在展开时看着像「插进文件夹内部」，语义不对）。 */
    let dragCtx = null;   // { node, siblings, parentPath, isZone, row, onChange, target, after, targetSiblings, targetParent, inside }
    let dropLine = null;
    let dropInsideEl = null;
    let ghostEl = null;

    function hideDropLine() {
        if (dropLine) { dropLine.remove(); dropLine = null; }
    }

    function hideInside() {
        if (dropInsideEl) { dropInsideEl.classList.remove('drop-inside'); dropInsideEl = null; }
    }

    /* 自绘拖拽跟随：fixed 层的小卡，纯视觉、不参与落点判定，故不受列表容器裁剪 */
    function moveGhost(x, y) {
        if (ghostEl) ghostEl.style.transform = 'translate(' + (x + 14) + 'px, ' + (y + 10) + 'px)';
    }

    function startGhost(row, x, y) {
        stopGhost();
        const g = document.createElement('div');
        g.className = 'drag-ghost';
        const img = row.querySelector('img');
        if (img) {
            const i2 = document.createElement('img');
            i2.src = img.src;
            g.appendChild(i2);
        }
        const s = document.createElement('span');
        const nameEl = row.querySelector('.trow-name, .ami-name');
        s.textContent = nameEl ? nameEl.textContent : (row.textContent || '').trim().slice(0, 20);
        g.appendChild(s);
        document.body.appendChild(g);
        ghostEl = g;
        moveGhost(x, y);
    }

    function stopGhost() {
        if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    }

    // 拖拽时隐藏浏览器原生残影（它会被列表容器裁剪），视觉改用自绘 ghost
    // setDragImage 需要一个在文档里的元素：惰性建一个屏幕外的 1×1 空 div
    let blankDragImg = null;
    function hideNativeDragImage(dt) {
        if (!blankDragImg) {
            blankDragImg = document.createElement('div');
            blankDragImg.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
            (document.body || document.documentElement).appendChild(blankDragImg);
        }
        try { dt.setDragImage(blankDragImg, 0, 0); } catch (err) { /* 不支持就退回原生残影 */ }
    }

    /* 拖拽边缘自动滚动 + ghost 跟随：dragover 在拖拽过程中持续触发（指针静止也触发），
       据此维持跟随与滚动 */
    const dragScroll = { timer: null, x: 0, y: 0 };
    document.addEventListener('dragover', (e) => {
        dragScroll.x = e.clientX; dragScroll.y = e.clientY;
        moveGhost(e.clientX, e.clientY);
        // 指针不在任何列表行上（含拖出容器）：只跟随，不参与排序判定
        if (dragCtx && !(e.target && e.target.closest && e.target.closest('.drop-anchor'))) {
            hideDropLine();
            hideInside();
        }
    }, true);

    function startDragScroll() {
        if (dragScroll.timer) return;
        dragScroll.timer = setInterval(() => {
            if (!dragCtx) { stopDragScroll(); return; }
            const edge = 36;
            document.querySelectorAll('.listpane-body, #zone-tabs, .appmgmt-view').forEach((el) => {
                if (el.scrollHeight <= el.clientHeight) return;
                const r = el.getBoundingClientRect();
                if (dragScroll.x < r.left || dragScroll.x > r.right) return;
                // 越出上缘为负、越出下缘为正，缘区内按距离加速，越出后封顶继续滚
                let dy = 0;
                if (dragScroll.y < r.top + edge) dy = dragScroll.y - (r.top + edge);
                else if (dragScroll.y > r.bottom - edge) dy = dragScroll.y - (r.bottom - edge);
                if (dy) el.scrollTop += Math.max(-16, Math.min(16, Math.round(dy / 3)));
            });
        }, 60);
    }

    function stopDragScroll() {
        if (dragScroll.timer) { clearInterval(dragScroll.timer); dragScroll.timer = null; }
    }

    function cleanupDrag() {
        hideDropLine();
        hideInside();
        stopGhost();
        stopDragScroll();
        if (dragCtx && dragCtx.row) dragCtx.row.classList.remove('drag-sort-source');
        document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
        dragCtx = null;
    }

    function _parentOf(p) {
        const i = (p || '').lastIndexOf('/');
        return i < 0 ? '' : p.slice(0, i);
    }

    /* 落点是否放行（任意层级）：
       - item 可落在任意目录（进多少层、出多少层都行），但不能落回 apps/ 根层
         （那会把 App 提成分区），也不能落进自身 / 自己的子孙目录；
       - 分区（apps/ 根层节点，isZone）只与同层节点互相重排。 */
    function acceptDrop(pp) {
        if (!dragCtx) return false;
        if (dragCtx.isZone) return pp === '';
        if (pp === '') return false;
        const self = dragCtx.node.path || '';
        if (!self) return false;
        if (pp === self || pp.indexOf(self + '/') === 0) return false;
        return true;
    }

    async function commitDrop(ctx) {
        if (!ctx || !ctx.target || ctx.target.path === ctx.node.path) return;
        if (ctx.inside) {
            // 移入文件夹（任意层级）：已在该文件夹里的不重复请求
            if (_parentOf(ctx.node.path) === ctx.target.path) return;
            const r = await iChen.PyAPI.moveNode(ctx.node.path, ctx.target.path, null);
            if (r && r.ok) {
                if (iChen.UI) iChen.UI.showToast('已移入「' + (ctx.target.name || ctx.target.path) + '」');
                (ctx.onChange || afterChange)();
            } else {
                toast(false, '', '移动失败', r);
            }
            return;
        }
        if ((ctx.targetParent || '') === (ctx.parentPath || '')) {
            // 同父级：整表重排
            const list = (ctx.siblings || []).slice();
            const from = list.findIndex((n) => n.path === ctx.node.path);
            if (from < 0) return;
            const before = list.map((n) => n.path).join('\n');
            const moved = list.splice(from, 1)[0];
            let to = list.findIndex((n) => n.path === ctx.target.path);
            if (to < 0) return;
            if (ctx.after) to += 1;
            list.splice(to, 0, moved);
            if (list.map((n) => n.path).join('\n') === before) return; // 位置没变，不发请求
            const r = await iChen.PyAPI.reorderNodes(ctx.parentPath, list.map((n) => n.path));
            if (r && r.ok) {
                if (iChen.UI) iChen.UI.showToast('排序已更新');
                (ctx.onChange || afterChange)();
            } else {
                toast(false, '', '排序失败', r);
            }
            return;
        }
        // 跨级：move_node 落位到目标父级；beforePath = 落点之后的那个兄弟
        const list = (ctx.targetSiblings || []).slice();
        let to = list.findIndex((n) => n.path === ctx.target.path);
        if (to < 0) return;
        if (ctx.after) to += 1;
        const r = await iChen.PyAPI.moveNode(ctx.node.path, ctx.targetParent, list[to] ? list[to].path : null);
        if (r && r.ok) {
            if (iChen.UI) iChen.UI.showToast('已移动');
            (ctx.onChange || afterChange)();
        } else {
            toast(false, '', '移动失败', r);
        }
    }

    function makeSortable(row, siblings, node, parentPath, onChange, opts) {
        const o = opts || {};
        const host = o.lineHost || row;
        const pp = parentPath || '';
        const ax = o.axis === 'x' ? 'x' : 'y';   // 横向容器（底部 Tab 栏）传 'x'：插入线为竖线
        const zoneTarget = !!o.isZone;           // 目标行是分区 Tab：item 拖拽交给 makeMoveTarget
        row.draggable = true;
        row.classList.add('drop-anchor');
        if (host !== row) host.classList.add('drop-anchor');
        // 行内 img 默认可单独拖（浏览器原生图片拖拽），禁掉，让整行作为拖拽源
        row.querySelectorAll('img').forEach((im) => { im.draggable = false; });
        row.addEventListener('dragstart', (e) => {
            cleanupDrag();
            dragCtx = { node, siblings: siblings || [], parentPath: pp, isZone: !pp, row, onChange };
            e.dataTransfer.effectAllowed = 'move';
            hideNativeDragImage(e.dataTransfer);
            try { e.dataTransfer.setData('text/plain', node.path || ''); } catch (err) { /* 兜底：不允许 setData 也照常拖 */ }
            // dragstart 里部分浏览器的 clientX/Y 为 0，退回行内坐标
            const r0 = row.getBoundingClientRect();
            startGhost(row, e.clientX || (r0.left + 40), e.clientY || (r0.top + r0.height / 2));
            startDragScroll();
            // 延迟半透明，避免影响 ghost 起始位置
            setTimeout(() => { if (dragCtx && dragCtx.row === row) row.classList.add('drag-sort-source'); }, 0);
        });
        row.addEventListener('dragover', (e) => {
            if (!acceptDrop(pp) || dragCtx.node === node) return;
            if (zoneTarget && !dragCtx.isZone) return; // 移到该分区由 makeMoveTarget 接管
            e.preventDefault(); // 只有 preventDefault 才允许 drop
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const dy = e.clientY - rect.top;
            // 文件夹行中部：移入该文件夹（任意层级都可进可出）
            const canInside = !zoneTarget && ax === 'y' && node.type === 'folder';
            if (canInside && dy > rect.height * 0.28 && dy < rect.height * 0.72) {
                hideDropLine();
                if (dropInsideEl !== row) { hideInside(); row.classList.add('drop-inside'); dropInsideEl = row; }
                dragCtx.target = node;
                dragCtx.inside = true;
                dragCtx.after = false;
                dragCtx.targetParent = node.path;
                dragCtx.targetSiblings = [];
                return;
            }
            hideInside();
            dragCtx.inside = false;
            const after = ax === 'x'
                ? (e.clientX - rect.left) > rect.width / 2
                : dy > rect.height / 2;
            dragCtx.target = node;
            dragCtx.after = after;
            dragCtx.targetSiblings = siblings || [];
            dragCtx.targetParent = pp;
            hideDropLine();
            const line = document.createElement('div');
            line.className = ax === 'x'
                ? 'drop-line drop-line-x ' + (after ? 'drop-line-right' : 'drop-line-left')
                : 'drop-line ' + (after ? 'drop-line-bottom' : 'drop-line-top');
            host.appendChild(line);
            dropLine = line;
        });
        row.addEventListener('drop', (e) => {
            if (!acceptDrop(pp) || dragCtx.node === node) return;
            if (zoneTarget && !dragCtx.isZone) return;
            e.preventDefault();
            e.stopPropagation();
            const ctx = dragCtx;
            cleanupDrag();
            commitDrop(ctx);
        });
        row.addEventListener('dragend', cleanupDrag);
    }

    /* 分区 Tab 作为「移动到该分区」的落点：整钮高亮，松手移到该分区末尾。
       分区 Tab 自身被拖动（重排分区）时归 makeSortable 管，这里直接放行。 */
    function makeMoveTarget(el, zone, onChange) {
        const accept = () => dragCtx && !dragCtx.isZone && (dragCtx.parentPath || '') !== zone.key;
        el.addEventListener('dragover', (e) => {
            if (!accept()) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            hideDropLine();
            hideInside();
            el.classList.add('drop-target');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', async (e) => {
            if (!accept()) return;
            e.preventDefault();
            e.stopPropagation();
            const ctx = dragCtx;
            cleanupDrag();
            const r = await iChen.PyAPI.moveNode(ctx.node.path, zone.key, null);
            if (r && r.ok) {
                if (iChen.UI) iChen.UI.showToast('已移动到「' + (zone.name || zone.key) + '」');
                (ctx.onChange || onChange || afterChange)();
            } else {
                toast(false, '', '移动失败', r);
            }
        });
    }

    async function afterChange() {
        if (iChen.Shell) await iChen.Shell.reload();
        render();
    }

    function addBtn(item, label, title, fn, danger) {
        const b = document.createElement('button');
        b.className = 'btn' + (danger ? ' btn-danger' : '');
        b.textContent = label;
        b.title = title || label;
        b.addEventListener('click', fn);
        item.appendChild(b);
        return b;
    }

    /* ---------- 文件夹删除（分区仅全部删除；分类有内容时提供全部/保留两种） ---------- */
    async function deleteFolder(node, isZone, onChange) {
        const done = onChange || afterChange;
        const hasContent = !!(node.children && node.children.length);
        const doFull = async () => {
            const tip = isZone
                ? '删除分区「' + node.name + '」将删除整个 Tab 及其下所有内容，不可恢复。'
                : '删除分类「' + node.name + '」及其全部内容，不可恢复。';
            if (!await iChen.Dialog.confirm(tip, '确认全部删除')) return;
            const r = await iChen.PyAPI.deleteFolder(node.path, true);
            toast(r && r.ok, '已删除：' + node.name, '删除失败', r);
            if (r && r.ok) done();
        };
        const doKeep = async () => {
            if (!await iChen.Dialog.confirm(
                '保留删除「' + node.name + '」：其中的 App 会移到上一级，子文件夹删除，不可恢复。', '确认保留删除')) return;
            const r = await iChen.PyAPI.deleteFolderKeepApps(node.path, true);
            if (r && r.failed && r.failed.length) {
                toast(true, '已删除（' + r.moved + ' 个 App 上移，' + r.failed.length + ' 个冲突未移动）', '完成（有冲突）');
            } else {
                toast(r && r.ok, '已保留删除（' + (r && r.moved) + ' 个 App 上移）', '删除失败', r);
            }
            if (r && r.ok) done();
        };
        if (isZone) {
            // 分区只能全部删除
            await doFull();
            return;
        }
        if (!hasContent) {
            // 空分类直接确认
            if (!await iChen.Dialog.confirm('删除空分类「' + node.name + '」？', '确认删除')) return;
            const r = await iChen.PyAPI.deleteFolder(node.path, true);
            toast(r && r.ok, '已删除：' + node.name, '删除失败', r);
            if (r && r.ok) done();
            return;
        }
        // 有内容的分类：弹菜单选模式
        const items = [
            { label: '全部删除（含内容）', danger: true, action: doFull },
            { label: '保留删除（App 上移）', action: doKeep },
        ];
        // 用屏幕中央偏上位置弹菜单（无锚点）
        iChen.UI.showContextMenu(items, window.innerWidth / 2 - 80, window.innerHeight / 2 - 40);
    }

    /* ---------- 文件夹（分区 / 分类）行 ---------- */
    function folderRow(node, depth, siblings, parentPath) {
        const item = document.createElement('div');
        item.className = 'app-manage-item app-manage-folder';
        item.style.paddingLeft = (6 + depth * 18) + 'px';

        const img = document.createElement('img');
        img.src = node.icon_data || DEFAULT_FOLDER;
        img.alt = '';
        const name = document.createElement('span');
        name.className = 'ami-name';
        name.textContent = node.name || node.path;
        const tag = document.createElement('span');
        tag.className = 'ami-tag';
        tag.textContent = depth === 0 ? '分区' : '分类';
        const desc = document.createElement('span');
        desc.className = 'ami-desc';
        desc.textContent = node.description || node.path || '';

        item.appendChild(img);
        item.appendChild(name);
        item.appendChild(tag);
        item.appendChild(desc);

        const isZone = depth === 0;
        const rename = async () => {
            const v = await iChen.Dialog.prompt(isZone ? '新的分区显示名' : '新的文件夹名', '改名', node.name);
            if (v == null || !v.trim()) return;
            const r = isZone
                ? await iChen.PyAPI.setFolderMeta(node.path, { name: v.trim() })
                : await iChen.PyAPI.renameFolder(node.path, v.trim());
            toast(r && r.ok, '已改名：' + v.trim(), '改名失败', r);
            if (r && r.ok) afterChange();
        };
        const editDesc = async () => {
            const v = await iChen.Dialog.prompt('描述信息', '编辑描述', node.description || '');
            if (v == null) return;
            const r = await iChen.PyAPI.setFolderMeta(node.path, { description: v.trim() });
            toast(r && r.ok, '已更新描述', '更新失败', r);
            if (r && r.ok) render();
        };
        const setIcon = () => applyFolderIcon(node, afterChange);
        const move = makeMove(siblings, node, parentPath, afterChange);
        makeSortable(item, siblings, node, parentPath, afterChange);

        // 右键菜单：新建 / 重命名 / 描述 / 图标 / 排序 / 删除
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            iChen.UI.showContextMenu([
                {
                    label: '新建 App',
                    submenu: [
                        { label: '导入文件夹', action: () => newApp('import', node.path) },
                        { label: '导入 miniapp 包', action: () => newApp('importMiniapp', node.path) },
                        { label: '导入 HTML 文件', action: () => newApp('importHtml', node.path) },
                        { label: '输入 HTML', action: () => newApp('html', node.path) },
                        { label: '输入 URL', action: () => newApp('url', node.path) },
                    ],
                },
                { label: '新建文件夹', action: () => newFolder(node.path) },
                { label: '重命名', action: rename },
                { label: '修改描述', action: editDesc },
                { label: '修改图标', action: setIcon },
                { label: '上移', action: move.up },
                { label: '下移', action: move.down },
                { label: '删除文件夹', danger: true, action: () => deleteFolder(node, isZone) },
            ], e.clientX, e.clientY, item);
        });
        return item;
    }

    /* ---------- App 动作（按钮 / 右键菜单共用） ---------- */
    function makeAppActions(app, afterChange) {
        return {
            rename: async () => {
                const v = await iChen.Dialog.prompt('新的显示名（同名目录已存在时只改显示名）', '改名', app.name || app.id);
                if (v == null || !v.trim()) return;
                const r = await iChen.PyAPI.renameApp(app.id, v.trim(), true);
                toast(r && r.ok, ('已改名' + (r.warning ? '（' + r.warning + '）' : '')), '改名失败', r);
                if (r && r.ok) afterChange();
            },
            setIcon: () => applyAppIcon(app, afterChange),
            move: async () => {
                const target = await pickFolder({ title: '移动到…' });
                if (target == null) return;
                const r = await iChen.PyAPI.moveApp(app.id, target);
                toast(r && r.ok, '已移动', '移动失败', r);
                if (r && r.ok) afterChange();
            },
            exportMiniapp: async () => {
                const picked = await iChen.PyAPI.pickFiles('save', false, 'miniapp', (app.name || app.id) + '.miniapp');
                if (!picked || !picked.ok || !(picked.paths || []).length) return;
                const r = await iChen.PyAPI.exportMiniapp(app.id, picked.paths[0]);
                let extra = '';
                if (r && r.ok && (r.pip_required || []).length) {
                    extra = '（需在线安装：' + r.pip_required.join('、') + '）';
                }
                toast(r && r.ok, '已导出' + extra, '导出失败', r);
            },
            openFolder: async () => {
                const r = await iChen.PyAPI.openAppFolder(app.id);
                toast(r && r.ok, '已打开文件夹', '打开失败', r);
            },
            uninstall: async () => {
                if (!await iChen.Dialog.confirm('卸载「' + (app.name || app.id) + '」？该目录会被删除，不可恢复。', '确认卸载')) return;
                const r = await iChen.PyAPI.deleteApp(app.id, true);
                toast(r && r.ok, '已卸载：' + (app.name || app.id), '卸载失败', r);
                if (r && r.ok) afterChange();
            },
        };
    }

    /* ---------- App 行 ---------- */
    function appRow(app, depth, siblings, parentPath) {
        const item = document.createElement('div');
        item.className = 'app-manage-item';
        item.style.paddingLeft = (6 + depth * 18) + 'px';

        const img = document.createElement('img');
        img.src = app.icon_data || DEFAULT_APP;
        img.alt = '';
        const name = document.createElement('span');
        name.className = 'ami-name';
        name.textContent = app.name || app.id;
        const desc = document.createElement('span');
        desc.className = 'ami-desc';
        desc.textContent = app.description || app.id;

        item.appendChild(img);
        item.appendChild(name);
        item.appendChild(desc);

        const a = makeAppActions(app, afterChange);
        addBtn(item, '改名', '改显示名（并尽量连文件夹一起改）', a.rename);
        addBtn(item, '图标', '选择一个 SVG 文件作为 App 图标', a.setIcon);
        addBtn(item, '移动', '移到 apps/ 下的另一个分区或分类', a.move);
        addBtn(item, '打开目录', '在资源管理器中打开', a.openFolder);
        addBtn(item, '卸载', '删除该 App 的目录', a.uninstall, true);

        const move = makeMove(siblings, app, parentPath, afterChange);
        makeSortable(item, siblings, app, parentPath, afterChange);

        // 右键菜单（与按钮同动作）
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            iChen.UI.showContextMenu([
                { label: '移动', action: a.move },
                { label: '重命名', action: a.rename },
                { label: '修改图标', action: a.setIcon },
                { label: '上移', action: move.up },
                { label: '下移', action: move.down },
                { label: '导出 miniapp', action: a.exportMiniapp },
                { label: '打开目录', action: a.openFolder },
                { label: '卸载', danger: true, action: a.uninstall },
            ], e.clientX, e.clientY, item);
        });
        return item;
    }

    function renderNodes(container, nodes, depth, parentPath) {
        (nodes || []).forEach((n) => {
            if (n.type === 'folder') {
                container.appendChild(folderRow(n, depth, nodes, parentPath));
                if (n.children && n.children.length) renderNodes(container, n.children, depth + 1, n.path);
            } else if (n.type === 'app') {
                container.appendChild(appRow(n, depth + 1, nodes, parentPath));
            }
        });
    }

    async function render() {
        const list = $('app-manage-list');
        if (!list) return;
        let r;
        try {
            r = await iChen.PyAPI.scanApps();
        } catch (e) {
            list.innerHTML = '<div class="app-manage-empty">扫描失败：' + e + '</div>';
            return;
        }
        if (!r || r.error) {
            list.innerHTML = '<div class="app-manage-empty">' + ((r && r.error) || '扫描不可用') + '</div>';
            return;
        }
        const tree = r.tree || [];
        list.innerHTML = '';
        if (!tree.length) {
            list.innerHTML = '<div class="app-manage-empty">apps/ 下暂无内容</div>';
            return;
        }
        renderNodes(list, tree, 0, '');
    }

    /** 文件夹选择器（点击导航式）：返回相对 apps/ 的路径，取消返回 null。
     *  opts.title：标题；opts.allowRoot：是否允许选 apps/ 根（新建 App/移动时必须 false，
     *  因为一级是 Tab、不能直接放 App）。 */
    function pickFolder(opts) {
        opts = opts || {};
        const allowRoot = !!opts.allowRoot;
        return new Promise(async (resolve) => {
            const r = await iChen.PyAPI.scanApps();
            const tree = (r && r.tree) || [];

            const overlay = document.createElement('div');
            overlay.className = 'dlg-overlay';
            const box = document.createElement('div');
            box.className = 'dlg';
            box.style.minWidth = '380px';
            box.setAttribute('role', 'dialog');

            const header = document.createElement('div');
            header.className = 'dlg-title';
            header.textContent = opts.title || '选择文件夹';
            box.appendChild(header);

            const crumb = document.createElement('div');
            crumb.className = 'dlg-msg';
            crumb.style.marginBottom = '10px';
            box.appendChild(crumb);

            const hint = document.createElement('div');
            hint.className = 'dlg-msg';
            hint.style.cssText = 'font-size:11px; color:var(--color-text-muted); margin-top:-6px; margin-bottom:10px;';
            box.appendChild(hint);

            const listEl = document.createElement('div');
            listEl.style.cssText = 'max-height: 280px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--bg-input);';
            box.appendChild(listEl);

            const actions = document.createElement('div');
            actions.className = 'dlg-actions';
            box.appendChild(actions);

            const close = (val) => {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(val);
            };

            const mkBtn = (label, primary, danger, onClick) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn' + (primary ? ' btn-primary' : '') + (danger ? ' btn-danger' : '');
                b.textContent = label;
                b.addEventListener('click', onClick);
                return b;
            };
            actions.appendChild(mkBtn('取消', false, false, () => close(null)));
            const confirmBtn = mkBtn('确认放在此处', true, false, () => close(currentPath));
            actions.appendChild(confirmBtn);

            // 状态：stack[i] = {name(显示名), path(相对 apps/), children}
            let stack = [{ name: 'apps', path: '', children: tree }];
            let currentPath = '';

            const render = () => {
                const top = stack[stack.length - 1];
                currentPath = top.path;
                crumb.textContent = '当前位置：' + stack.map((s) => s.name).join(' / ');
                const atRoot = stack.length === 1;
                const canConfirm = allowRoot || !atRoot;
                confirmBtn.disabled = !canConfirm;
                confirmBtn.style.opacity = canConfirm ? '' : '0.4';
                confirmBtn.style.cursor = canConfirm ? '' : 'not-allowed';
                hint.textContent = atRoot && !allowRoot
                    ? '一级目录是 Tab，不能直接放 App，请先进入一个分区'
                    : '';
                listEl.innerHTML = '';
                if (stack.length > 1) {
                    const up = document.createElement('div');
                    up.className = 'trow';
                    up.textContent = '.. 返回上一级';
                    up.style.cssText = 'padding:8px 10px; cursor:pointer; border-radius:var(--radius-sm);';
                    up.onmouseenter = () => up.style.background = 'var(--bg-active)';
                    up.onmouseleave = () => up.style.background = '';
                    up.addEventListener('click', () => { stack.pop(); render(); });
                    listEl.appendChild(up);
                }
                const folders = (top.children || []).filter((n) => n.type === 'folder');
                if (!folders.length) {
                    const empty = document.createElement('div');
                    empty.style.cssText = 'padding:16px; text-align:center; color:var(--color-text-muted); font-size:12px;';
                    empty.textContent = '（此目录下没有子文件夹）';
                    listEl.appendChild(empty);
                }
                folders.forEach((node) => {
                    const row = document.createElement('div');
                    row.className = 'trow';
                    row.textContent = node.name;
                    row.style.cssText = 'padding:8px 10px; cursor:pointer; border-radius:var(--radius-sm);';
                    row.onmouseenter = () => row.style.background = 'var(--bg-active)';
                    row.onmouseleave = () => row.style.background = '';
                    row.addEventListener('click', () => {
                        stack.push({ name: node.name, path: node.path, children: node.children || [] });
                        render();
                    });
                    listEl.appendChild(row);
                });
            };

            function onKey(e) {
                if (e.key === 'Escape') close(null);
                else if (e.key === 'Enter' && !confirmBtn.disabled) { e.preventDefault(); close(currentPath); }
            }
            document.addEventListener('keydown', onKey);
            overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });

            overlay.appendChild(box);
            document.body.appendChild(overlay);
            render();
        });
    }

    function bindCreators() {
        const btn = $('btn-new');
        if (btn) btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const r = btn.getBoundingClientRect();
            iChen.AppMgmt.showNewMenu(r.left, r.bottom + 4);
        });
    }

    /** 新建 App 的 5 种类型：import=导入文件夹 / importMiniapp=导入 miniapp 包 / importHtml=导入 HTML 文件
     *  / html=输入 HTML / url=输入 URL。defaultParent：若指定（如从文件夹右键新建），直接用该路径。 */
    async function newApp(type, defaultParent) {
        const parent = defaultParent != null ? defaultParent : await pickFolder({ title: '新建到…' });
        if (parent == null) return;
        if (type === 'import') {
            const picked = await iChen.PyAPI.pickFiles('folder', false, 'all', '');
            if (!picked || !picked.ok || !(picked.paths || []).length) {
                if (iChen.UI) iChen.UI.showToast((picked && picked.error) || '未选择文件夹');
                return;
            }
            const r = await iChen.PyAPI.importAppFolder(parent, picked.paths[0], '');
            toast(r && r.ok, '已导入', '导入失败', r);
            if (r && r.ok) afterChange();
            return;
        }
        if (type === 'importMiniapp') {
            const picked = await iChen.PyAPI.pickFiles('open', false, 'miniapp', '');
            if (!picked || !picked.ok || !(picked.paths || []).length) {
                if (iChen.UI) iChen.UI.showToast((picked && picked.error) || '未选择 miniapp 包');
                return;
            }
            const showResult = (r, isUpdate) => {
                if (!r || !r.ok) { toast(false, '', isUpdate ? '更新失败' : '导入失败', r); return; }
                let extra = '';
                if ((r.shared_skipped || []).length) extra += '；本地已有 shared 跳过：' + r.shared_skipped.join('、');
                if ((r.pip_failed || []).length) extra += '；pip 安装失败：' + r.pip_failed.join('、');
                toast(true, (isUpdate ? '已更新' : '已导入') + extra, '', r);
                afterChange();
            };
            const first = await iChen.PyAPI.importMiniapp(picked.paths[0], parent, '');
            if (first && first.conflict === 'app_exists') {
                // 同 id 不报错，引导「更新」：展示双方版本号，确认后覆盖
                const lv = first.local_version || '未知';
                const pv = first.pkg_version || '未知';
                if (!await iChen.Dialog.confirm(
                    '已存在同 id 的 App「' + first.app_id + '」（本地 ' + lv + ' → 包内 ' + pv + '）。\n'
                    + '用包内版本更新它？原 App 目录会被删除（中枢 data/appdata 里的数据不受影响）。',
                    '更新 App')) return;
                const r = await iChen.PyAPI.importMiniapp(picked.paths[0], parent, 'overwrite');
                // 覆盖后旧实例仍指向已删目录：若在运行，先终止（用户再打开即为新版）
                if (r && r.ok && iChen.AppFrame && iChen.AppFrame.list
                    && iChen.AppFrame.list().some((x) => x.id === first.app_id)) {
                    await iChen.AppFrame.terminate(first.app_id);
                }
                showResult(r, true);
            } else {
                showResult(first, false);
            }
            return;
        }
        const name = await iChen.Dialog.prompt('App 名称（同时作为目录名）', '新建 App', '');
        if (name == null || !name.trim()) return;
        const nameTrim = name.trim();
        // 新建先选图标（预设弹窗；可「使用默认图标」，取消也按默认处理）
        const choice = await chooseIcon({ title: '新建 App 的图标', allowDefault: true });
        if (type === 'importHtml') {
            const picked = await iChen.PyAPI.pickFiles('open', false, 'html', '');
            if (!picked || !picked.ok || !(picked.paths || []).length) {
                if (iChen.UI) iChen.UI.showToast((picked && picked.error) || '未选择 HTML 文件');
                return;
            }
            const f = await iChen.PyAPI.readTextFile(picked.paths[0]);
            if (!f || !f.ok) { if (iChen.UI) iChen.UI.showToast('读取文件失败：' + (f && f.error)); return; }
            const r = await iChen.PyAPI.createAppFromHtml(parent, nameTrim, f.content);
            toast(r && r.ok, '已创建：' + (r.id || nameTrim), '创建失败', r);
            if (r && r.ok) { await applyNewIcon(choice, 'app', r.id); afterChange(); }
            return;
        }
        if (type === 'html') {
            const html = await iChen.Dialog.textarea('粘贴或输入 HTML（可留空后自己编辑）', 'HTML 内容',
                '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><title>' + nameTrim
                + '</title></head><body><h2>' + nameTrim + '</h2></body></html>');
            if (html == null) return;
            const r = await iChen.PyAPI.createAppFromHtml(parent, nameTrim, html);
            toast(r && r.ok, '已创建：' + (r.id || nameTrim), '创建失败', r);
            if (r && r.ok) { await applyNewIcon(choice, 'app', r.id); afterChange(); }
            return;
        }
        if (type === 'url') {
            const url = await iChen.Dialog.prompt('目标地址（https://、http://，或裸地址如 192.168.3.78 / example.com）', '目标地址', '');
            if (url == null || !url.trim()) return;
            const r = await iChen.PyAPI.createUrlApp(parent, nameTrim, url.trim());
            toast(r && r.ok, '已创建：' + (r.id || nameTrim), '创建失败', r);
            if (r && r.ok) { await applyNewIcon(choice, 'app', r.id); afterChange(); }
            return;
        }
    }

    async function newFolder(defaultParent) {
        const parent = defaultParent != null ? defaultParent : await pickFolder({ title: '新建分类到…', allowRoot: true });
        if (parent == null) return;
        const name = await iChen.Dialog.prompt('分类名称', '新建分类', '');
        if (name == null || !name.trim()) return;
        const choice = await chooseIcon({ title: '新建文件夹的图标', allowDefault: true });
        const r = await iChen.PyAPI.createFolder(parent, name.trim(), {});
        toast(r && r.ok, '已创建分类', '创建失败', r);
        if (r && r.ok) { await applyNewIcon(choice, 'folder', r.path); afterChange(); }
    }

    /** 「新建」菜单：新建App（4 种类型子菜单）+ 新建文件夹 */
    function showNewMenu(x, y) {
        iChen.UI.showContextMenu([
            {
                label: '新建 App',
                submenu: [
                    { label: '导入文件夹', action: () => newApp('import') },
                    { label: '导入 miniapp 包', action: () => newApp('importMiniapp') },
                    { label: '导入 HTML 文件', action: () => newApp('importHtml') },
                    { label: '输入 HTML', action: () => newApp('html') },
                    { label: '输入 URL', action: () => newApp('url') },
                ],
            },
            { label: '新建文件夹', action: () => newFolder() },
        ], x, y);
    }

    iChen.AppMgmt = {
        init() { bindCreators(); },
        render,
        makeAppActions,    // 供左侧列表 App 右键菜单复用
        applyAppIcon,      // 图标预设弹窗 → App（左侧列表右键复用）
        applyFolderIcon,   // 图标预设弹窗 → 文件夹（左侧列表右键复用）
        makeMove,          // 同父级上移 / 下移（左侧列表右键复用）
        makeSortable,      // 拖拽排序：插入横线 + 松手落位（左侧列表行复用）
        makeMoveTarget,    // 分区 Tab 作为「移动到该分区」的拖拽落点（shell.js 复用）
        showNewMenu,       // 供 App 管理「新建」按钮 & 左侧空白处右键复用
        newApp,
        newFolder,
        deleteFolder,      // 供左侧列表文件夹右键复用
    };
})();
