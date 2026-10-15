/* ============================================================
   ui.js - 公共 UI 工具（消息气泡 / 滚动 / 系统提示）
   供 chat.js 与 im.js 复用，避免重复实现。
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};

    iChen.UI = {
        /** 重排后重新触发淡入动画（配合 shell.css 的 .fade-in） */
        animateIn(el) {
            if (!el) return;
            el.classList.remove('fade-in');
            void el.offsetWidth; // 强制重排，确保动画可重启
            el.classList.add('fade-in');
        },

        /** 创建消息气泡元素（msg: {sender: ai|user, sender_name, content}） */
        createMsgEl(msg) {
            const side = msg.sender === 'user' ? 'right' : 'left';
            const wrap = document.createElement('div');
            wrap.className = 'msg ' + (side === 'right' ? 'msg-right' : 'msg-left');
            const senderEl = document.createElement('div');
            senderEl.className = 'msg-sender';
            senderEl.textContent = msg.sender_name || (side === 'right' ? '我' : '对方');
            const textEl = document.createElement('div');
            textEl.className = 'msg-content';
            textEl.textContent = msg.content;
            wrap.appendChild(senderEl);
            wrap.appendChild(textEl);
            return wrap;
        },

        /** 滚动容器到底部 */
        scrollToBottom(container) {
            if (container) container.scrollTop = container.scrollHeight;
        },

        /** 运行时长的人性化显示（后台列表 / 程序面板共用）；openedAt 为打开时间戳(ms) */
        fmtDuration(openedAt) {
            const s = Math.max(1, Math.floor((Date.now() - (openedAt || Date.now())) / 1000));
            if (s < 60) return s + ' 秒';
            if (s < 3600) return Math.floor(s / 60) + ' 分钟';
            if (s < 86400) return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分';
            return Math.floor(s / 86400) + ' 天';
        },

        /** 追加系统提示消息（居中胶囊） */
        showSystemMsg(container, text) {
            if (!container) return;
            const el = document.createElement('div');
            el.className = 'msg-system';
            el.textContent = text;
            container.appendChild(el);
            this.scrollToBottom(container);
        },

        /** 轻量 toast 提示（底部居中，自动消失） */
        showToast(msg) {
            let el = document.getElementById('toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'toast';
                el.className = 'toast';
                document.body.appendChild(el);
            }
            el.textContent = msg;
            el.classList.add('show');
            clearTimeout(el._timer);
            el._timer = setTimeout(() => el.classList.remove('show'), 2200);
        },

        /** 上下文菜单（支持嵌套子菜单）。
         *  items: [{label, action?, danger?, submenu?: [...]}]
         *  sourceEl（可选）：触发右键的行元素——菜单存续期间给它挂 .ctx-anchor 保持高亮，
         *  菜单关闭即移除；不影响鼠标悬停其他行的 hover 高亮。
         *  子菜单 hover 打开，鼠标移走（含子菜单区）延时关闭，来回滑动不会残留或叠加阴影。
         *  点击项 / 点外部 / Esc 关闭全部。 */
        showContextMenu(items, x, y, sourceEl) {
            const HOVER_DELAY = 150;
            const allMenus = [];
            if (sourceEl && sourceEl.classList) sourceEl.classList.add('ctx-anchor');

            const buildMenu = (itemsList, anchorEl, parentMenu, onDestroy) => {
                const menu = document.createElement('div');
                menu.className = 'ctx-menu';
                if (!anchorEl) menu.id = 'ctx-menu';
                allMenus.push(menu);

                let openSub = null;
                let closeTimer = null;

                const cancelTimer = () => {
                    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
                };
                // 销毁自己这一级及其所有子孙
                const destroy = () => {
                    cancelTimer();
                    if (openSub) { openSub._destroy(); openSub = null; }
                    const i = allMenus.indexOf(menu);
                    if (i >= 0) allMenus.splice(i, 1);
                    if (menu.parentNode) menu.parentNode.removeChild(menu);
                    if (typeof onDestroy === 'function') onDestroy();
                };
                menu._destroy = destroy;
                menu._cancelClose = cancelTimer;
                menu._parentMenu = parentMenu || null;

                (itemsList || []).forEach((it) => {
                    const row = document.createElement('div');
                    row.className = 'ctx-item' + (it.danger ? ' ctx-danger' : '') + (it.submenu ? ' ctx-has-sub' : '');
                    const label = document.createElement('span');
                    label.className = 'ctx-label';
                    label.textContent = it.label;
                    row.appendChild(label);
                    row.addEventListener('mouseenter', () => {
                        cancelTimer();
                        // 同级切项：先关掉已开的子菜单
                        if (openSub) { openSub._destroy(); openSub = null; }
                        if (it.submenu) {
                            const sub = buildMenu(it.submenu, row, menu, () => { openSub = null; });
                            openSub = sub;
                        }
                    });
                    if (it.submenu) {
                        // 从父项移向子菜单有 2px 间隙，延时关闭；进入子菜单会取消
                        row.addEventListener('mouseleave', () => {
                            cancelTimer();
                            closeTimer = setTimeout(() => {
                                if (openSub) { openSub._destroy(); openSub = null; }
                            }, HOVER_DELAY);
                        });
                    }
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (it.submenu) return; // 父项只负责展开
                        rootDestroy();
                        if (typeof it.action === 'function') it.action();
                    });
                    menu.appendChild(row);
                });
                document.body.appendChild(menu);

                // 鼠标进入子菜单本体时，取消父级的延时关闭
                menu.addEventListener('mouseenter', () => {
                    if (parentMenu) parentMenu._cancelClose();
                });
                // 离开子菜单（非移向父行）时，延时关闭自己这一支
                if (parentMenu) {
                    menu.addEventListener('mouseleave', () => {
                        cancelTimer();
                        closeTimer = setTimeout(() => {
                            if (openSub) { openSub._destroy(); openSub = null; }
                            // 通知父级也清掉它的引用与定时器
                            if (parentMenu._cancelClose) parentMenu._cancelClose();
                            destroy();
                        }, HOVER_DELAY);
                    });
                }

                // 定位：根菜单按 (x,y)；子菜单贴父项右侧
                if (anchorEl) {
                    const ar = anchorEl.getBoundingClientRect();
                    menu.style.left = ar.right + 2 + 'px';
                    menu.style.top = ar.top + 'px';
                } else {
                    menu.style.left = x + 'px';
                    menu.style.top = y + 'px';
                }
                // 防溢出
                const r = menu.getBoundingClientRect();
                const vw = window.innerWidth, vh = window.innerHeight;
                if (r.right > vw - 4) {
                    if (anchorEl) {
                        const ar = anchorEl.getBoundingClientRect();
                        menu.style.left = (ar.left - r.width - 2) + 'px';
                    } else {
                        menu.style.left = (vw - r.width - 4) + 'px';
                    }
                }
                if (r.bottom > vh - 4) menu.style.top = Math.max(4, vh - r.height - 4) + 'px';
                return menu;
            };

            const root = buildMenu(items, null, null);
            const rootDestroy = () => {
                document.removeEventListener('mousedown', onDown);
                document.removeEventListener('contextmenu', onDown);
                window.removeEventListener('blur', onBlur);
                document.removeEventListener('keydown', onKey);
                if (sourceEl && sourceEl.classList) sourceEl.classList.remove('ctx-anchor');
                root._destroy();
            };

            const onDown = (e) => {
                if (!allMenus.some((m) => m.contains(e.target))) rootDestroy();
            };
            const onKey = (e) => { if (e.key === 'Escape') rootDestroy(); };
            const onBlur = () => rootDestroy();
            setTimeout(() => {
                document.addEventListener('mousedown', onDown);
                document.addEventListener('contextmenu', onDown);
                window.addEventListener('blur', onBlur);
                document.addEventListener('keydown', onKey);
            }, 0);
            return root;
        },
    };

    /** 界面内对话框（与右键菜单同款玻璃材质，纯前端自绘，不依赖系统控件）。
     *  alert   → Promise<true>
     *  confirm → Promise<boolean>（确定 true / 取消或关闭 false）
     *  prompt  → Promise<string|null>（确定返回文本；取消或关闭返回 null）
     */
    iChen.Dialog = {
        alert(message, title) { return showModal('alert', message, title, ''); },
        confirm(message, title) { return showModal('confirm', message, title, ''); },
        prompt(message, title, defaultVal) { return showModal('prompt', message, title, defaultVal); },
        textarea(message, title, defaultVal) { return showModal('textarea', message, title, defaultVal); },
    };

    function showModal(mode, message, title, defaultVal) {
        return new Promise((resolve) => {
            let settled = false;
            const overlay = document.createElement('div');
            overlay.className = 'dlg-overlay';
            const box = document.createElement('div');
            box.className = 'dlg';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');

            const close = (v) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(v);
            };

            if (title) {
                const t = document.createElement('div');
                t.className = 'dlg-title';
                t.textContent = title;
                box.appendChild(t);
            }
            if (message) {
                const m = document.createElement('div');
                m.className = 'dlg-msg';
                m.textContent = message; // 安全：文本节点，不解析 HTML（换行由 white-space:pre-wrap 呈现）
                box.appendChild(m);
            }
            let input;
            if (mode === 'prompt') {
                input = document.createElement('input');
                input.className = 'dlg-input';
                input.value = defaultVal || '';
                box.appendChild(input);
            } else if (mode === 'textarea') {
                input = document.createElement('textarea');
                input.className = 'dlg-input dlg-textarea';
                input.rows = 14;
                input.wrap = 'off';
                input.spellcheck = false;
                input.value = defaultVal || '';
                box.appendChild(input);
            }
            const actions = document.createElement('div');
            actions.className = 'dlg-actions';
            const mkBtn = (label, primary, danger, onClick) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn' + (primary ? ' btn-primary' : '') + (danger ? ' btn-danger' : '');
                b.textContent = label;
                b.addEventListener('click', onClick);
                return b;
            };
            const isInput = mode === 'prompt' || mode === 'textarea';
            const cancelVal = mode === 'alert' ? true : (isInput ? null : false);
            const okVal = () => (isInput ? input.value : true);

            if (mode === 'alert') {
                actions.appendChild(mkBtn('确定', true, false, () => close(true)));
            } else {
                actions.appendChild(mkBtn('取消', false, false, () => close(cancelVal)));
                actions.appendChild(mkBtn('确定', true, false, () => close(okVal())));
            }
            box.appendChild(actions);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            function onKey(e) {
                if (e.key === 'Escape') {
                    close(cancelVal);
                } else if (e.key === 'Enter') {
                    if (mode === 'prompt') {
                        e.preventDefault();
                        close(input.value);
                    } else if (mode === 'textarea' && (e.ctrlKey || e.metaKey)) {
                        // 多行输入框：Ctrl/⌘ + Enter 提交
                        e.preventDefault();
                        close(input.value);
                    }
                }
                // alert / confirm 的 Enter 由当前聚焦按钮（默认「确定」）原生触发 click
            }
            document.addEventListener('keydown', onKey);
            // 点遮罩 = 取消（alert 视为关闭）
            overlay.addEventListener('mousedown', (e) => {
                if (e.target === overlay) close(cancelVal);
            });

            if (input) {
                input.focus();
                if (mode === 'prompt') input.select();
            } else {
                box.querySelector('.btn-primary').focus();
            }
        });
    }

    // 禁用浏览器 / WebView2 默认右键菜单：中枢内右键一律走自绘菜单（树行 / 空白处），
    // 不应弹出系统网页菜单。捕获阶段挂在 document 上，覆盖所有元素（含输入框）；
    // 只 preventDefault、不 stopPropagation，自绘菜单的处理器照常收到事件。
    // 输入框文字编辑仍可用键盘快捷键（Ctrl+C / V / X / A）；调试仍可用 F12。
    document.addEventListener('contextmenu', (e) => e.preventDefault(), true);
})();
