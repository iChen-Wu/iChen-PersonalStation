/* ============================================================
   app.js - 入口 + 模块初始化聚合（动态主体壳，无待机层）
   启动即进入主壳（默认第一个分区）；后续待机将由某个程序承担
   模块：Shell（分区 Tab 状态机，自举加载 zones）/ Tree（分区目录树）
        / AppFrame（iframe 桥）/ Programs（后台）/ AppMgmt（App 管理）
        / Settings（设置页）
   ============================================================ */
(function () {
    const iChen = window.iChen = window.iChen || {};

    function init() {
        if (iChen.AppFrame) iChen.AppFrame.init();
        if (iChen.Tree) iChen.Tree.init();
        if (iChen.Programs) iChen.Programs.init();
        if (iChen.AppMgmt) iChen.AppMgmt.init();
        if (iChen.Automation) iChen.Automation.init();
        if (iChen.Settings) iChen.Settings.init();
        if (iChen.Titlebar) iChen.Titlebar.init();

        // 分区 Tab 与首个主体由 Shell 在 DOMContentLoaded 中自举激活
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
