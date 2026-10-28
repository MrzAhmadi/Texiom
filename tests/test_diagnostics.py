"""Unit tests for the editor's TeX log parser (docker/editor/editor_app/diagnostics.py)."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

# editor_app.workspace uses the current directory as the project root and seeds it on import.
WORKDIR = Path(tempfile.mkdtemp(prefix="texiom-test-")).resolve()
os.chdir(WORKDIR)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "docker" / "editor"))

from editor_app.diagnostics import parse_log  # noqa: E402


class ParseLogTest(unittest.TestCase):
    def setUp(self):
        (WORKDIR / "chapters").mkdir(exist_ok=True)
        (WORKDIR / "chapters" / "a.tex").write_text("x")
        (WORKDIR / "main.tex").write_text("x")

    def parse(self, log):
        return parse_log(log, WORKDIR, "main.tex")

    def test_file_line_error_in_included_file(self):
        found = self.parse("./chapters/a.tex:2: Undefined control sequence.\nl.2 \\foo bar\n")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["file"], "chapters/a.tex")
        self.assertEqual(found[0]["line"], 2)
        self.assertEqual(found[0]["severity"], "error")
        self.assertIn("\\foo", found[0]["context"])

    def test_bang_error_uses_main_file_and_context_line(self):
        found = self.parse("! Emergency stop.\n<*> main.tex\nl.9 \\bar\n")
        self.assertEqual((found[0]["file"], found[0]["line"]), ("main.tex", 9))

    def test_warning_with_input_line(self):
        found = self.parse("LaTeX Warning: Citation `k' on page 1 undefined on input line 12.\n\n")
        self.assertEqual((found[0]["severity"], found[0]["line"]), ("warning", 12))
        self.assertNotIn("input line", found[0]["message"])

    def test_wrapped_package_warning(self):
        log = "Package hyperref Warning: Token not allowed:\n(hyperref)                removing `x' on input line 20.\n\n"
        found = self.parse(log)
        self.assertEqual(found[0]["line"], 20)
        self.assertIn("removing", found[0]["message"])

    def test_fatal_error_summary_is_dropped(self):
        log = "./main.tex:3: Undefined control sequence.\nl.3 \\x\n\n./main.tex:3: ==> Fatal error occurred, no output PDF file produced!\n"
        self.assertEqual([d["message"] for d in self.parse(log)], ["Undefined control sequence."])

    def test_system_files_are_not_navigable(self):
        found = self.parse("/usr/share/texlive/texmf-dist/tex/latex/foo/foo.sty:5: Boom.\nl.5 x\n")
        self.assertIsNone(found[0]["file"])

    def test_duplicates_collapse(self):
        log = "./main.tex:4: Oops.\nl.4 x\n\n./main.tex:4: Oops.\nl.4 x\n"
        self.assertEqual(len(self.parse(log)), 1)


if __name__ == "__main__":
    unittest.main()
