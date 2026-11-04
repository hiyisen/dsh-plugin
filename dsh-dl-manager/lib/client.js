/* 客户端模块（dsh-dl-manager）—— 左栏「下载管理器」面板。
 *
 * 手写 __ModuleLoader__ 格式（与构建产物一致），因此不需要打包步骤。
 * react 由运行时基线表提供（require("react")），不随包体携带。
 *
 * 注册两处 slot：
 *   sidebar.panellist → 左栏导航行（图标 + 名称「下载」）
 *   main             → 面板主体（iframe 指向同源路由 /dsh-dl-manager/）
 */
window.__ModuleLoader__.load({
  id: "dsh-dl-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var PANEL_ID = "dsh-dl-manager";
    var inject = ["slots"];

    function PanelIcon() {
      return React.createElement(
        "svg",
        { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6 },
        React.createElement("path", { d: "M8 2v8", strokeLinecap: "round" }),
        React.createElement("path", { d: "M5 7.5L8 10.5l3-3", strokeLinecap: "round", strokeLinejoin: "round" }),
        React.createElement("path", { d: "M2.5 13h11", strokeLinecap: "round" })
      );
    }

    function PanelBody() {
      return React.createElement("iframe", {
        src: "/dsh-dl-manager/",
        title: "资源下载",
        style: { width: "100%", height: "100%", border: "none", background: "transparent", display: "block" }
      });
    }

    function apply(ctx) {
      ctx.slots.inject("sidebar.panellist", function () {
        return ctx.slots.register({
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 60,
          label: function () {
            return "资源下载";
          }
        }, PanelIcon);
      });
      ctx.slots.inject("main", function* () {
        yield ctx.slots.register({
          name: "main",
          key: PANEL_ID,
          inject: function () {
            return {};
          }
        }, PanelBody);
        yield function () {};
      });
    }

    exports.PANEL_ID = PANEL_ID;
    exports.apply = apply;
    exports.inject = inject;

    // 数据代理：面板 iframe 内部的 fetch 在本环境走不通，改由主程序代发（与能用的 node-flow 面板同法）。
    // 面板用 postMessage 把请求发到主程序，主程序用自身 fetch 取数后回传。
    (function () {
      if (window.__DLM_PROXY__) return;
      window.__DLM_PROXY__ = 1;
      window.addEventListener('message', async function (e) {
        var d = e.data;
        if (!d || !d.type) return;
        if (d.type === 'dlm-theme') {
          // 把宿主 DSH 设计 token 转给面板 iframe（CSS 变量不跨 iframe）
          try {
            var cs = getComputedStyle(document.body);
            var g = function (n) { var v = cs.getPropertyValue(n); return v ? v.trim() : ''; };
            var map = {
              '--dsw-alias-bg-base': '--bg', '--dsw-alias-bg-layer-1': '--card', '--dsw-alias-bg-layer-2': '--card2',
              '--dsw-alias-border-l2': '--line', '--dsw-alias-border-l4': '--line2',
              '--dsw-alias-label-primary': '--fg', '--dsw-alias-label-tertiary': '--dim', '--dsw-alias-label-secondary': '--dim2',
              '--dsw-static-deepseek-450': '--acc', '--dsw-static-green-500': '--ok',
              '--dsw-static-amber-500': '--warn', '--dsw-static-red-400': '--err',
              '--dsw-radius-md': '--r', '--dsw-radius-sm': '--r-sm',
              '--dsw-alias-markdown-code-block': '--code'
            };
            var vars = {};
            for (var src in map) { var v2 = g(src); if (v2) vars[map[src]] = v2; }
            if (e.source) e.source.postMessage({ type: 'dlm-theme-resp', vars: vars }, '*');
          } catch (err) {}
          return;
        }
        if (d.type !== 'dlm-fetch') return;
        try {
          var init = { method: d.method, credentials: 'include', headers: d.headers || {} };
          if (d.body != null) init.body = d.body;
          var resp = await fetch('/dsh-dl-manager/' + d.path, init);
          var body = await resp.text();
          if (e.source) e.source.postMessage({ type: 'dlm-fetch-resp', id: d.id, ok: resp.ok, status: resp.status, body: body }, '*');
        } catch (err) {
          if (e.source) e.source.postMessage({ type: 'dlm-fetch-resp', id: d.id, error: String((err && err.message) || err) }, '*');
        }
      });
    })();

    return module.exports;
  }
});
