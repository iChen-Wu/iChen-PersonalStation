"""shell 前端资源一致性测试（环境无 node，做基础校验）。

覆盖：
1. `index.html` 里 `<script src>` / `<link href>` 引用的文件必须存在；
2. 每个 `shell/js/*.js` 的圆括号 / 花括号 / 方括号必须配对
   （先剥掉字符串与注释，再计数——能抓住大部分低级语法错误）。
"""
import re
import unittest
from pathlib import Path

SHELL = Path(__file__).resolve().parents[1] / "system" / "desktop"


def _strip_js_literals(src: str) -> str:
    """把字符串字面量与注释替换为空白，便于对括号做配对检查。"""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in "\"'`":
            quote = c
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            out.append(" ")
            continue
        out.append(c)
        i += 1
    return "".join(out)


def bracket_report(src: str):
    """返回 (是否配对, 说明)。"""
    s = _strip_js_literals(src)
    for open_ch, close_ch in (("{", "}"), ("(", ")"), ("[", "]")):
        a, b = s.count(open_ch), s.count(close_ch)
        if a != b:
            return False, f"{open_ch}{close_ch} 不配对: {a} 个 {open_ch} vs {b} 个 {close_ch}"
    return True, ""


class ShellAssetsTest(unittest.TestCase):

    def test_index_html_exists(self):
        self.assertTrue((SHELL / "index.html").is_file())

    def test_script_and_stylesheet_targets_exist(self):
        html = (SHELL / "index.html").read_text(encoding="utf-8")
        scripts = re.findall(r'<script\s+src="([^"]+)"', html)
        styles = re.findall(r'<link[^>]+href="([^"]+)"', html)
        self.assertTrue(scripts, "index.html 应至少引用一个 js")
        for rel in scripts + styles:
            self.assertTrue((SHELL / rel).is_file(), f"引用的资源不存在: {rel}")

    def test_console_has_backend_entry(self):
        """控制台应含「调度」条目。"""
        html = (SHELL / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="processes-view"', html)
        js = (SHELL / "js" / "shell.js").read_text(encoding="utf-8")
        self.assertIn("name: '调度'", js)

    def test_all_js_brackets_balanced(self):
        js_dir = SHELL / "js"
        files = sorted(js_dir.glob("*.js"))
        self.assertTrue(files, "shell/js 下应有 js 文件")
        for p in files:
            ok, msg = bracket_report(p.read_text(encoding="utf-8"))
            self.assertTrue(ok, f"{p.name}: {msg}")

    def test_index_html_has_no_embedded_html_document(self):
        """index.html 里不得内嵌另一份 HTML 文档。

        背景（真实问题）：曾把「完整开发规格」原文整段塞在 <textarea> 里，而那段文本
        含 </style> </script> </body> </html>。浏览器按 RCDATA 解析没事，但 VS Code 的
        HTML 语言服务会当成真实标签而报错。现已挪到 js/welcome-doc.js。
        这条断言防止有人再把长文档塞回来。
        """
        html = (SHELL / "index.html").read_text(encoding="utf-8")
        low = html.lower()
        self.assertEqual(low.count("<!doctype"), 1, "index.html 只应有一份文档声明")
        self.assertEqual(low.count("<html"), 1, "只应有一个 <html>")
        self.assertEqual(low.count("</html>"), 1, "只应有一个 </html>（内嵌文档会破坏解析）")
        self.assertEqual(low.count("</body>"), 1, "只应有一个 </body>")

    def test_welcome_doc_is_external_and_nonempty(self):
        """规格原文放在独立 js 里，且内容非空。"""
        js = (SHELL / "js" / "welcome-doc.js").read_text(encoding="utf-8")
        self.assertIn("window.__ICHEN_WELCOME_DOC__", js)
        self.assertGreater(len(js), 2000, "规格原文不应为空")
        html = (SHELL / "index.html").read_text(encoding="utf-8")
        self.assertIn("js/welcome-doc.js", html)
        # 且必须在 shell.js 之前加载（shell.js 会读它）
        self.assertLess(html.index("js/welcome-doc.js"), html.index("js/shell.js"))


if __name__ == "__main__":
    unittest.main()
