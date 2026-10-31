/* ============================================================
   iconpicker.js - 图标预设弹窗
   - 新建 App / 文件夹、修改 App / 文件夹图标时统一先弹此弹窗
   - 内置预设 + 用户预设（可删除），可「从 SVG 添加预设」（预设可改）
   - 「自定义」= 选择本地 SVG 文件
   pick(opts) 返回：
     { kind: 'preset', presetId } / { kind: 'file', path } /
     { kind: 'none' }（opts.allowDefault 时）/ null（取消）
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};

    function fileName(p) {
        const s = String(p || '');
        return s.split('\\').pop().split('/').pop();
    }

    function pick(opts) {
        opts = opts || {};
        return new Promise(async (resolve) => {
            let presets = [];
            try {
                const r = await iChen.PyAPI.listIconPresets();
                presets = (r && r.presets) || [];
            } catch (e) { presets = []; }

            const overlay = document.createElement('div');
            overlay.className = 'dlg-overlay';
            const box = document.createElement('div');
            box.className = 'dlg';
            box.style.maxWidth = '520px';
            box.setAttribute('role', 'dialog');

            const title = document.createElement('div');
            title.className = 'dlg-title';
            title.textContent = opts.title || '选择图标';
            box.appendChild(title);

            const hint = document.createElement('div');
            hint.className = 'dlg-msg';
            hint.textContent = opts.hint || '从预设里选一个，或使用自定义 SVG；用户预设可删除。';
            box.appendChild(hint);

            const grid = document.createElement('div');
            grid.className = 'icon-grid';
            box.appendChild(grid);

            const tools = document.createElement('div');
            tools.className = 'icon-picker-tools';
            box.appendChild(tools);

            const actions = document.createElement('div');
            actions.className = 'dlg-actions';
            box.appendChild(actions);

            const close = (val) => {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(val);
            };

            const mkBtn = (label, cls) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn' + (cls ? ' ' + cls : '');
                b.textContent = label;
                return b;
            };

            const renderGrid = () => {
                grid.innerHTML = '';
                if (!presets.length) {
                    const empty = document.createElement('div');
                    empty.className = 'app-manage-empty';
                    empty.style.gridColumn = '1 / -1';
                    empty.textContent = '暂无预设（无桥预览模式）。仍可用自定义 SVG。';
                    grid.appendChild(empty);
                    return;
                }
                presets.forEach((p) => {
                    const cell = document.createElement('div');
                    cell.className = 'icon-cell';
                    cell.title = p.name || '';
                    const img = document.createElement('img');
                    img.src = p.data_uri;
                    img.alt = p.name || '';
                    cell.appendChild(img);
                    const cap = document.createElement('span');
                    cap.className = 'icon-cell-name';
                    cap.textContent = p.name || '';
                    cell.appendChild(cap);
                    if (!p.builtin) {
                        const del = document.createElement('button');
                        del.type = 'button';
                        del.className = 'icon-del';
                        del.title = '删除此预设';
                        del.textContent = '×';
                        del.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            if (!await iChen.Dialog.confirm('删除预设「' + (p.name || '') + '」？', '删除预设')) return;
                            const r = await iChen.PyAPI.deleteIconPreset(p.id);
                            if (r && r.ok) {
                                presets = presets.filter((x) => x.id !== p.id);
                                renderGrid();
                            } else if (iChen.Notify) {
                                iChen.Notify.error('删除失败：' + ((r && r.error) || ''));
                            }
                        });
                        cell.appendChild(del);
                    }
                    cell.addEventListener('click', () => close({ kind: 'preset', presetId: p.id }));
                    grid.appendChild(cell);
                });
            };
            renderGrid();

            // 自定义（选择本地 SVG 文件）
            const customBtn = mkBtn('自定义（选择 SVG 文件）');
            customBtn.addEventListener('click', async () => {
                const picked = await iChen.PyAPI.pickFiles('open', false, 'svg', '');
                if (!picked || !picked.ok || !(picked.paths || []).length) return;
                close({ kind: 'file', path: picked.paths[0] });
            });
            tools.appendChild(customBtn);

            // 从 SVG 添加为预设（预设可改）
            const addBtn = mkBtn('从 SVG 添加预设');
            addBtn.addEventListener('click', async () => {
                const picked = await iChen.PyAPI.pickFiles('open', false, 'svg', '');
                if (!picked || !picked.ok || !(picked.paths || []).length) return;
                const f = await iChen.PyAPI.readTextFile(picked.paths[0]);
                if (!f || !f.ok) {
                    if (iChen.Notify) iChen.Notify.error('读取 SVG 失败：' + ((f && f.error) || ''));
                    return;
                }
                const name = await iChen.Dialog.prompt('预设名称（默认用文件名）', '添加预设',
                    fileName(picked.paths[0]).replace(/\.svg$/i, ''));
                if (name == null) return;
                const r = await iChen.PyAPI.saveIconPreset(name.trim() || '我的图标', f.content);
                if (r && r.ok) {
                    presets.push(r.preset);
                    renderGrid();
                } else if (iChen.Notify) {
                    iChen.Notify.error('添加失败：' + ((r && r.error) || ''));
                }
            });
            tools.appendChild(addBtn);

            // 底部
            const cancelBtn = mkBtn('取消');
            cancelBtn.addEventListener('click', () => close(null));
            actions.appendChild(cancelBtn);
            if (opts.allowDefault) {
                const defBtn = mkBtn('使用默认图标', 'btn-primary');
                defBtn.addEventListener('click', () => close({ kind: 'none' }));
                actions.appendChild(defBtn);
            }

            function onKey(e) {
                if (e.key === 'Escape') close(null);
            }
            document.addEventListener('keydown', onKey);
            overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    iChen.IconPicker = {
        pick,
        fileName,
    };
})();
