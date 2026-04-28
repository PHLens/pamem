import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"


class MemoryLintCommandsTest(unittest.TestCase):
    def run_lint(self, memory_root, *args, check=True):
        command = [str(SCRIPTS / "memory-lint.sh"), "--memory-root", str(memory_root)]
        command.extend(args)
        result = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(
                f"memory-lint failed with {result.returncode}\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        return result

    def write(self, root, rel_path, content):
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
        return path

    def write_memory_repo(self, root, *, entry_file="MEMORY.md", notes_dir="notes", profiles=True):
        profile_block = ""
        if profiles:
            profile_block = """

            [profiles.developer]
            description = "Developer profile."
            load = [
              "MEMORY.md",
              "notes/shared/preferences.md",
              "notes/shared/experience.md",
            ]
            stable_targets = [
              "notes/shared/experience.md",
            ]
            """
        self.write(
            root,
            ".pamem/config.toml",
            f"""
            schema_version = "0.1"
            kind = "memory-repo"
            name = "agent-memory"
            entry_file = "{entry_file}"
            notes_dir = "{notes_dir}"

            [requests]
            inbox_dir = "requests/inbox"
            {profile_block}
            """,
        )
        self.write(root, entry_file, "# Memory\n\n- See notes/shared/experience.md\n")
        self.write(root, "notes/shared/preferences.md", "# Preferences\n")
        self.write(
            root,
            "notes/shared/experience.md",
            "## Test workflow\n\ntype: finding\n\nWhen working in this repo, run unittest before commit.\n",
        )
        (root / "requests" / "inbox").mkdir(parents=True, exist_ok=True)

    def report(self, result):
        return json.loads(result.stdout)

    def rules(self, report):
        return {finding["rule"] for finding in report["findings"]}

    def find_report_finding(self, report, *, rule, path=None, evidence_contains=None):
        for finding in report["findings"]:
            if finding["rule"] != rule:
                continue
            if path is not None and finding["path"] != path:
                continue
            if evidence_contains is not None and evidence_contains not in finding["evidence"]:
                continue
            return finding
        self.fail(f"missing finding rule={rule!r} path={path!r} evidence_contains={evidence_contains!r}")

    def test_wrapper_help(self):
        result = subprocess.run(
            [str(SCRIPTS / "memory-lint.sh"), "--help"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage:", result.stdout.lower())

    def test_help_does_not_require_site_packages(self):
        result = subprocess.run(
            [sys.executable, "-S", str(SCRIPTS / "memory_lint.py"), "--help"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage:", result.stdout.lower())

    def test_missing_config_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# Memory\n")
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("config.toml", result.stderr)

    def test_source_config_is_invalid_lint_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../memory"
                """,
            )
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("kind 'memory-repo'", result.stderr)

    def test_invalid_config_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, ".pamem/config.toml", "schema_version = [")
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("TOML parse error", result.stderr)

    def test_invalid_default_profile_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "MEMORY.md"
                notes_dir = "notes"
                default_profile = "reviewer"

                [profiles.developer]
                description = "Developer profile."
                load = ["MEMORY.md"]
                stable_targets = ["notes/shared/experience.md"]
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            self.write(root, "notes/shared/experience.md", "## Test workflow\n\ntype: finding\n\nReusable.\n")
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("default_profile", result.stderr)

    def test_clean_configured_memory_repo_passes_and_reports_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["summary"], {"error_count": 0, "warning_count": 0, "info_count": 0})
            self.assertEqual(report["memory_root"], str(root.resolve()))
            self.assertEqual(report["config"]["kind"], "memory-repo")
            self.assertEqual(report["config"]["name"], "agent-memory")
            self.assertEqual(report["config"]["entry_file"], "MEMORY.md")
            self.assertEqual(report["config"]["notes_dir"], "notes")
            self.assertEqual(report["config"]["requests_inbox_dir"], "requests/inbox")
            self.assertEqual(report["config"]["profiles"], ["developer"])
            self.assertEqual(report["config"]["stable_targets"], ["notes/shared/experience.md"])
            self.assertEqual(
                report["config"]["load_paths"],
                ["MEMORY.md", "notes/shared/preferences.md", "notes/shared/experience.md"],
            )

    def test_removed_workspace_and_intent_options_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            result = self.run_lint(
                root,
                "--workspace",
                str(root),
                "--intent",
                "legacy-intent.json",
                "--json",
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("unrecognized arguments", result.stderr)

    def test_custom_entry_file_pointer_check_uses_config_entry_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, entry_file="INDEX.md")
            self.write(root, "MEMORY.md", "- See notes/missing.md\n")
            self.write(root, "INDEX.md", "- See notes/shared/missing.md\n")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML007", self.rules(report))
            self.find_report_finding(
                report,
                rule="ML007",
                path="INDEX.md",
                evidence_contains="notes/shared/missing.md",
            )

    def test_entry_file_pointer_check_normalizes_notes_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, notes_dir="./notes")
            self.write(root, "MEMORY.md", "- See notes/shared/missing.md\n")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.find_report_finding(
                report,
                rule="ML007",
                path="MEMORY.md",
                evidence_contains="notes/shared/missing.md",
            )

    def test_entry_file_pointer_escape_reports_missing_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "outside.md", "# Outside\n")
            self.write(root, "MEMORY.md", "- See notes/shared/../../outside.md\n")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.find_report_finding(
                report,
                rule="ML007",
                path="MEMORY.md",
                evidence_contains="notes/shared/../../outside.md",
            )

    def test_entry_file_domain_explanation_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "MEMORY.md", "DTensor is PyTorch's distributed tensor abstraction.\n")
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML006", self.rules(report))

    def test_entry_file_size_warning_uses_config_entry_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, entry_file="INDEX.md")
            self.write(root, "INDEX.md", "\n".join(f"- item {index}" for index in range(85)))
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML006", self.rules(report))
            self.find_report_finding(report, rule="ML006", path="INDEX.md")

    def test_entry_file_transient_metadata_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "MEMORY.md", "category: transient\n\nTemporary command output.\n")
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML004", self.rules(report))

    def test_no_stable_targets_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, profiles=False)
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML011", self.rules(report))
            self.assertIn("No stable targets", report["findings"][0]["title"])

    def test_missing_stable_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "notes" / "shared" / "experience.md").unlink()
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML011", self.rules(report))
            self.assertEqual(report["summary"]["error_count"], 1)

    def test_stable_target_outside_notes_dir_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "outside.md", "## Outside\n\ntype: finding\n\nStable content.\n")
            config = (root / ".pamem" / "config.toml").read_text(encoding="utf-8")
            config = config.replace('"notes/shared/experience.md"', '"outside.md"')
            (root / ".pamem" / "config.toml").write_text(config, encoding="utf-8")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            finding = report["findings"][0]
            self.assertEqual(finding["rule"], "ML011")
            self.assertIn("under notes_dir", finding["message"])

    def test_stable_target_directory_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "notes" / "shared" / "archive").mkdir()
            config = (root / ".pamem" / "config.toml").read_text(encoding="utf-8")
            config = config.replace('"notes/shared/experience.md"', '"notes/shared/archive"')
            (root / ".pamem" / "config.toml").write_text(config, encoding="utf-8")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            finding = report["findings"][0]
            self.assertEqual(finding["rule"], "ML011")
            self.assertIn("not a file", finding["title"])
            self.assertIn("must be files", finding["message"])

    def test_stable_target_equal_to_entry_file_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            config = (root / ".pamem" / "config.toml").read_text(encoding="utf-8")
            config = config.replace('"notes/shared/experience.md"', '"MEMORY.md"')
            (root / ".pamem" / "config.toml").write_text(config, encoding="utf-8")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            finding = report["findings"][0]
            self.assertEqual(finding["rule"], "ML011")
            self.assertIn("entry_file", finding["message"])

    def test_missing_requests_inbox_is_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "requests" / "inbox").rmdir()
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML012", self.rules(report))
            self.assertEqual(report["summary"]["warning_count"], 1)

    def test_missing_load_path_is_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "notes" / "shared" / "preferences.md").unlink()
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML013", self.rules(report))
            self.assertEqual(report["summary"]["warning_count"], 1)

    def test_strict_fails_when_config_warning_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "requests" / "inbox").rmdir()
            result = self.run_lint(root, "--json", "--strict", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML012", self.rules(report))

    def test_domain_content_in_stable_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                "## DTensor note\n\ntype: finding\n\nDTensor is PyTorch's distributed tensor abstraction.\n",
            )
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML001", self.rules(report))

    def test_domain_content_in_non_stable_note_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/background.md",
                "## DTensor note\n\ntype: finding\n\nDTensor is PyTorch's distributed tensor abstraction.\n",
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertNotIn("ML001", self.rules(report))

    def test_mixed_content_in_stable_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                (
                    "## DTensor workflow\n\n"
                    "type: finding\n\n"
                    "DTensor is PyTorch's distributed tensor abstraction, and the agent should stage it in wiki.\n"
                ),
            )
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML002", self.rules(report))

    def test_pending_split_review_stable_target_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                (
                    "## Pending split review\n\n"
                    "type: meta\n"
                    "category: mixed\n"
                    "destination: split\n"
                    "review_status: pending\n\n"
                    "Pending split decision for reviewer.\n"
                ),
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["summary"], {"error_count": 0, "warning_count": 0, "info_count": 0})
            self.assertNotIn("ML002", self.rules(report))

    def test_transient_content_in_stable_target_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                "## Temporary output\n\ntype: finding\ncategory: transient\n\nTemporary command output.\n",
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML004", self.rules(report))

    def test_stable_target_entry_missing_type_warns_and_strict_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "notes/shared/experience.md", "## Plugin behavior\n\nReusable finding.\n")
            result = self.run_lint(root, "--json", "--strict", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML008", self.rules(report))

    def test_duplicate_stable_memory_is_info(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/roles/developer.md",
                "## Plugin behavior\n\ntype: finding\n\n- Refresh plugin marketplace before plugin updates.\n",
            )
            config = (root / ".pamem" / "config.toml").read_text(encoding="utf-8")
            config = config.replace(
                'stable_targets = [\n  "notes/shared/experience.md",\n]',
                'stable_targets = [\n  "notes/shared/experience.md",\n  "notes/roles/developer.md",\n]',
            )
            (root / ".pamem" / "config.toml").write_text(config, encoding="utf-8")
            self.write(
                root,
                "notes/shared/experience.md",
                "## Plugin behavior\n\ntype: finding\n\n- Refresh plugin marketplace before plugin updates.\n",
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML009", self.rules(report))


if __name__ == "__main__":
    unittest.main()
