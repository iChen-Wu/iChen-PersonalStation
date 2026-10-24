/* ============================================================
   programs.js - 控制台"调度"面板：运行中的程序实例（手机后台式任务卡）
   - 数据来自 AppFrame 的实例表（打开即常驻，切走挂调度）
   - 操作：放到前台 / 终止（销毁实例）/ 勾选后批量终止
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};
    const $ = (id) => document.getElementById(id);

    const DEFAULT_ICON = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + '<rect x="8" y="8" width="48" height="48" rx="12" fill="#dbe7fb"/></svg>')));

    // 批量终止的勾选集（运行时记忆；实例消失时自动清理）
    const selected = new Set();

    function syncBatchBar(listLen) {
        const killBtn = $('btn-programs-kill-selected');
        const allBtn = $('btn-programs-select-all');
        if (killBtn) {
            killBtn.disabled = selected.size === 0;
            killBtn.textContent = selected.size ? '终止选中 (' + selected.size + ')' : '终止选中';
        }
        if (allBtn) {
            allBtn.textContent = (listLen > 0 && selected.size === listLen) ? '取消全选' : '全选';
            allBtn.disabled = listLen === 0;
        }
    }

    function render() {
        const box = $('program-cards');
        if (!box) return;
        const list = (iChen.AppFrame && iChen.AppFrame.list) ? iChen.AppFrame.list() : [];
        const empty = $('programs-empty');
        if (empty) empty.hidden = list.length > 0;

        // 清理已终止实例的勾选残留
        const alive = new Set(list.map((p) => p.id));
        Array.from(selected).forEach((id) => { if (!alive.has(id)) selected.delete(id); });

        box.innerHTML = '';
        list.forEach((p) => {
            const card = document.createElement('div');
            card.className = 'program-card' + (p.active ? ' active' : '');

            const head = document.createElement('div');
            head.className = 'pc-head';
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'pc-check';
            check.title = '勾选后可批量终止';
            check.checked = selected.has(p.id);
            check.addEventListener('change', () => {
                if (check.checked) selected.add(p.id); else selected.delete(p.id);
                syncBatchBar(list.length);
            });
            const img = document.createElement('img');
            img.className = 'pc-icon';
            img.src = p.icon || DEFAULT_ICON;
            img.alt = '';
            const meta = document.createElement('div');
            meta.className = 'pc-meta';
            const name = document.createElement('div');
            name.className = 'pc-name';
            name.textContent = p.name;
            const sub = document.createElement('div');
            sub.className = 'pc-sub';
            sub.textContent = (p.zone ? p.zone + ' · ' : '') + '已运行 '
                + iChen.UI.fmtDuration(p.opened_at)
                + (p.active ? ' · 前台' : ' · 后台');
            meta.appendChild(name);
            meta.appendChild(sub);
            head.appendChild(check);
            head.appendChild(img);
            head.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'pc-actions';

            const front = document.createElement('button');
            front.className = 'btn';
            front.textContent = p.active ? '已在前台' : '放到前台';
            front.disabled = !!p.active;
            front.addEventListener('click', () => {
                // 先切到该 App 所属分区（Tab 同步、面板让位），再把它加进前台
                if (iChen.Shell && p.zone) iChen.Shell.activate(p.zone);
                if (iChen.AppFrame) iChen.AppFrame.addToStage(p.id);
            });

            const kill = document.createElement('button');
            kill.className = 'btn btn-danger';
            kill.textContent = '终止';
            kill.addEventListener('click', async () => {
                if (!await iChen.Dialog.confirm('终止「' + p.name + '」？该程序将结束运行，未保存的数据会丢失。', '确认终止')) return;
                kill.disabled = true;
                kill.textContent = '终止中…';
                if (iChen.AppFrame) await iChen.AppFrame.terminate(p.id);
                if (iChen.UI) iChen.UI.showToast('已终止：' + p.name);
                render();
            });

            actions.appendChild(front);
            actions.appendChild(kill);
            card.appendChild(head);
            card.appendChild(actions);
            box.appendChild(card);
        });
        syncBatchBar(list.length);
    }

    async function killSelected() {
        const ids = Array.from(selected);
        if (!ids.length) return;
        if (!await iChen.Dialog.confirm(
            '批量终止 ' + ids.length + ' 个程序？它们将结束运行，未保存的数据会丢失。', '确认批量终止')) return;
        let done = 0;
        for (const id of ids) {
            if (iChen.AppFrame && await iChen.AppFrame.terminate(id)) done += 1;
        }
        selected.clear();
        if (iChen.UI) iChen.UI.showToast('已批量终止 ' + done + ' 个程序');
        render();
    }

    function toggleSelectAll() {
        const list = (iChen.AppFrame && iChen.AppFrame.list) ? iChen.AppFrame.list() : [];
        if (!list.length) return;
        if (selected.size === list.length) selected.clear();
        else list.forEach((p) => selected.add(p.id));
        render();
    }

    iChen.Programs = {
        init() {
            const b = $('btn-programs-refresh');
            if (b) b.addEventListener('click', render);
            const allBtn = $('btn-programs-select-all');
            if (allBtn) allBtn.addEventListener('click', toggleSelectAll);
            const killBtn = $('btn-programs-kill-selected');
            if (killBtn) killBtn.addEventListener('click', killSelected);
            // 实例增减 / 前后台变化时，若面板可见则刷新
            document.addEventListener('ichen:instances-changed', () => {
                const view = $('processes-view');
                if (view && !view.hidden) render();
            });
            document.addEventListener('ichen:instance-shown', () => {
                const view = $('processes-view');
                if (view && !view.hidden) render();
            });
        },
        render,
    };
})();
