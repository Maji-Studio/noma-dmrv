"""Offline CLI tests: python3 -I -m unittest discover -s scripts/pr-evidence -v."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


DIRECTORY = Path(__file__).resolve().parent
SCRIPT = DIRECTORY / "set-evidence.py"
HEAD = "abcdef01" * 5
OTHER_HEAD = "12345678" * 5
BEFORE = "https://raw.githubusercontent.com/Maji-Studio/noma-dmrv/issue-assets/prs/1/before-form.png"
AFTER = "https://raw.githubusercontent.com/Maji-Studio/noma-dmrv/issue-assets/prs/1/after-form.png"
ROW = f"Form at the same viewport and state|{BEFORE}|{AFTER}|400"


class SetEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix=".test-evidence-", dir=DIRECTORY)
        self.addCleanup(self.directory.cleanup)
        self.body = Path(self.directory.name) / "body.md"

    def run_script(self, *entries, head=HEAD, success=True):
        result = subprocess.run(
            [sys.executable, "-I", str(SCRIPT), str(self.body), head, *entries],
            capture_output=True,
            text=True,
            check=False,
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("error:", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
        return self.body.read_text(encoding="utf-8"), result

    def test_marked_block_is_replaced_in_place(self):
        self.body.write_text("## Summary\nKeep this.\n\n## Evidence\nTest output\n\n## Tests\nKeep tests.\n")
        self.run_script(ROW)
        output, _ = self.run_script(ROW, head=OTHER_HEAD)
        self.assertEqual(output.count("<!-- pr-evidence:start -->"), 1)
        self.assertIn("**Screenshots (head 1234567)**", output)
        self.assertNotIn("head abcdef0", output)
        self.assertIn("## Evidence\n\n<!-- pr-evidence:start -->", output)
        self.assertIn("Test output", output)
        self.assertTrue(output.endswith("## Tests\nKeep tests.\n"))

    def test_existing_evidence_content_is_kept(self):
        for heading in ("## Evidence", "## Evidence (head 9999999)"):
            with self.subTest(heading=heading):
                self.body.write_text(f"## Summary\nKeep this.\n\n{heading}\nTest output\n\n## Tests\nKeep tests.\n")
                output, _ = self.run_script(ROW)
                self.assertEqual(output.count("## Evidence"), 1)
                self.assertIn("Test output", output)
                self.assertLess(output.index(heading), output.index("<!-- pr-evidence:start -->"))
                self.assertLess(output.index("<!-- pr-evidence:start -->"), output.index("Test output"))
                self.assertIn("## Summary\nKeep this.", output)
                self.assertTrue(output.endswith("## Tests\nKeep tests.\n"))

    def test_insert_before_robot_line(self):
        footer = "🤖 Generated with Codex"
        self.body.write_text(f"## Summary\nKeep this.\n\n{footer}\n\n", encoding="utf-8")
        output, _ = self.run_script(ROW)
        self.assertLess(output.index("## Evidence"), output.index(footer))
        self.assertTrue(output.endswith(footer + "\n"))

    def test_no_section_yet(self):
        self.body.write_text("## Summary\nKeep this.\n")
        output, _ = self.run_script(ROW)
        self.assertTrue(output.startswith("## Summary\nKeep this.\n\n## Evidence\n\n<!-- pr-evidence:start -->\n**Screenshots (head abcdef0)**\n"))
        self.assertIn("**Form at the same viewport and state**", output)
        self.assertIn("| Before | After |\n| --- | --- |", output)
        self.assertIn(f'<img src="{BEFORE}"', output)
        self.assertIn(f'<img src="{AFTER}"', output)
        self.assertEqual(output.count('width="400"'), 2)

    def test_double_run_is_idempotent(self):
        self.body.write_text("Summary\n\n## Evidence\nTest output\n\n🤖 Generated with Codex\n", encoding="utf-8")
        first, _ = self.run_script(ROW)
        second, _ = self.run_script(ROW)
        self.assertEqual(first, second)

    def test_two_heads_keep_one_block(self):
        self.body.write_text("Summary\n")
        self.run_script(ROW)
        output, _ = self.run_script(ROW, head=OTHER_HEAD)
        self.assertEqual(output.count("## Evidence"), 1)
        self.assertEqual(output.count("pr-evidence:end"), 1)

    def test_unclosed_marker_fails(self):
        self.body.write_text("<!-- pr-evidence:start -->\nx\n")
        output, _ = self.run_script(ROW, success=False)
        self.assertEqual(output, "<!-- pr-evidence:start -->\nx\n")

    def test_gifs_and_empty_cells(self):
        self.body.write_text("")
        output, _ = self.run_script(f"After only||{AFTER}|400", "--gif", f"Walkthrough|{AFTER}|320", ROW)
        self.assertIn(f'|  | <img src="{AFTER}"', output)
        self.assertIn("**Walkthrough**", output)
        self.assertIn('width="320"', output)
        self.assertLess(output.index("**Walkthrough**"), output.index("**Form"))

    def test_escapes_html_attributes(self):
        self.body.write_text("")
        output, _ = self.run_script('A "caption"||https://example.com/image.png?a=1&b=2|400')
        self.assertIn('alt="A &quot;caption&quot;"', output)
        self.assertIn("?a=1&amp;b=2", output)

    def test_fenced_example_heading_is_ignored(self):
        example = "```markdown\n## Evidence\nAn example\n```"
        self.body.write_text(example + "\n\n## Evidence\nTest output\n")
        output, _ = self.run_script(ROW)
        self.assertIn(example + "\n\n## Evidence\n\n<!-- pr-evidence:start -->", output)
        self.assertIn("Test output", output)

    def test_bad_input_does_not_modify_body(self):
        cases = [
            ((), HEAD),
            ((ROW,), "not-a-sha"),
            ((ROW,), "abcdef01" * 6),
            (("bad row",), HEAD),
            (("Caption|||400",), HEAD),
            ((f"Caption||{AFTER}|0",), HEAD),
            ((f"Caption||{AFTER}|wide",), HEAD),
            (("Caption||javascript:alert(1)|400",), HEAD),
            ((f"||{AFTER}|400",), HEAD),
            (("--gif",), HEAD),
            ((ROW, "--unknown"), HEAD),
        ]
        for entries, head in cases:
            with self.subTest(entries=entries, head=head):
                self.body.write_text("Unchanged\n")
                output, _ = self.run_script(*entries, head=head, success=False)
                self.assertEqual(output, "Unchanged\n")


if __name__ == "__main__":
    unittest.main()
