import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"


class MemoryConfigCommandsTest(unittest.TestCase):
    def run_config(self, root, *args, check=True):
        command = [str(SCRIPTS / "memory-config.sh"), "--root", str(root), "--json"]
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
                f"memory-config failed with {result.returncode}\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        return result

    def write(self, root, rel_path, content):
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
        return path

    def write_memory_repo(self, root, name="agent-memory"):
        self.write(
            root,
            ".pamem/config.toml",
            f"""
            schema_version = "0.1"
            kind = "memory-repo"
            name = "{name}"
            entry_file = "MEMORY.md"
            notes_dir = "notes"
            """,
        )
        self.write(root, "MEMORY.md", "# Memory\n")
        (root / "notes").mkdir(parents=True, exist_ok=True)

    def git(self, cwd, *args):
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            self.fail(f"git {' '.join(args)} failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        return result

    def make_remote_memory_repo(self, base):
        remote = base / "remote-memory"
        remote.mkdir()
        self.write_memory_repo(remote, name="remote-memory")
        self.write(remote, "notes/.gitkeep", "")
        self.git(remote, "init", "-b", "main")
        self.git(remote, "config", "user.email", "test@example.com")
        self.git(remote, "config", "user.name", "Test User")
        self.git(remote, "add", ".")
        self.git(remote, "commit", "-m", "seed memory repo")
        return remote

    def report(self, result):
        return json.loads(result.stdout)

    def test_absent_config_reports_v0(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# Memory\n")
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["status"], "absent")
            self.assertEqual(report["layout"], "v0")
            self.assertEqual(report["memory_root"], str(root.resolve()))
            self.assertEqual(report["diagnostic"], "Memory config: absent, using V0 layout")

    def test_direct_memory_repo_config_reports_memory_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["status"], "valid")
            self.assertEqual(report["config_kind"], "memory-repo")
            self.assertEqual(report["name"], "agent-memory")
            self.assertEqual(report["memory_root"], str(root.resolve()))
            self.assertEqual(report["diagnostic"], "Memory config: memory-repo agent-memory, schema 0.1")

    def test_memory_repo_missing_required_field_is_error(self):
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
                """,
            )
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(report["status"], "error")
            self.assertIn("notes_dir", report["errors"][0])

    def test_absolute_memory_repo_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "/tmp/MEMORY.md"
                notes_dir = "notes"
                """,
            )
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("must be relative", report["errors"][0])

    def test_escaping_memory_repo_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "../MEMORY.md"
                notes_dir = "notes"
                """,
            )
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("must stay inside memory repo", report["errors"][0])

    def test_requests_inbox_defaults_and_custom_path_reports_warning_when_missing(self):
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

                [requests]
                inbox_dir = "requests/custom-inbox"
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            (root / "notes").mkdir()
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(report["requests"]["inbox_dir"]["raw"], "requests/custom-inbox")
            self.assertEqual(report["summary"]["warning_count"], 1)
            self.assertIn("requests inbox path does not exist yet", report["warnings"][0])

    def test_profiles_are_validated_and_reported(self):
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
                default_profile = "developer"

                [profiles.developer]
                description = "Developer profile."
                load = ["MEMORY.md", "notes/shared/workflow.md"]
                stable_targets = ["notes/shared/experience.md"]
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            (root / "notes" / "shared").mkdir(parents=True)
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(report["default_profile"], "developer")
            self.assertEqual(report["profiles"][0]["name"], "developer")
            self.assertEqual(report["summary"]["warning_count"], 2)

    def test_invalid_default_profile_is_error(self):
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
                stable_targets = ["notes/experience.md"]
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            (root / "notes").mkdir()
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("default_profile", report["errors"][0])

    def test_local_source_resolves_memory_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bootstrap = base / "bootstrap"
            memory = base / "agent-memory"
            bootstrap.mkdir()
            memory.mkdir()
            self.write_memory_repo(memory, name="shared-memory")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../agent-memory"
                """,
            )
            result = self.run_config(bootstrap)
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["status"], "valid")
            self.assertEqual(report["config_kind"], "source")
            self.assertEqual(report["source"]["type"], "local")
            self.assertEqual(report["memory_root"], str(memory.resolve()))
            self.assertEqual(report["memory_repo"]["name"], "shared-memory")
            self.assertEqual(report["diagnostic"], f"Memory source: local -> {memory.resolve()}")

    def test_local_source_absolute_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp)
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "/tmp/agent-memory"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("source.path must be relative", report["errors"][0])

    def test_source_type_must_be_string(self):
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp)
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = []
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(report["status"], "error")
            self.assertIn("source.type", report["errors"][0])
            self.assertNotIn("Traceback", result.stderr)

    def test_local_source_missing_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp)
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../missing-memory"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("local source target does not exist", report["errors"][0])

    def test_git_source_clones_missing_local_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            bootstrap = base / "bootstrap"
            bootstrap.mkdir()
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                ref = "main"
                """,
            )
            result = self.run_config(bootstrap)
            report = self.report(result)
            expected_memory = bootstrap / ".pamem" / "memory"
            self.assertEqual(result.returncode, 0)
            self.assertTrue((expected_memory / ".git").exists())
            self.assertEqual(report["source"]["local_path"]["raw"], ".pamem/memory")
            self.assertEqual(report["memory_root"], str(expected_memory.resolve()))
            self.assertEqual(report["memory_repo"]["name"], "remote-memory")

    def test_git_source_existing_repo_does_not_pull(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            bootstrap = base / "bootstrap"
            bootstrap.mkdir()
            local = bootstrap / ".pamem" / "memory"
            local.parent.mkdir(parents=True)
            self.git(bootstrap, "clone", "--branch", "main", str(remote), str(local))
            before = self.git(local, "rev-parse", "HEAD").stdout.strip()
            self.write(remote, "notes/new.md", "new remote content\n")
            self.git(remote, "add", ".")
            self.git(remote, "commit", "-m", "remote update")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                ref = "main"
                """,
            )
            result = self.run_config(bootstrap)
            after = self.git(local, "rev-parse", "HEAD").stdout.strip()
            self.assertEqual(result.returncode, 0)
            self.assertEqual(after, before)

    def test_git_source_existing_non_git_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            bootstrap = base / "bootstrap"
            bootstrap.mkdir()
            self.write(bootstrap, ".pamem/memory/file.txt", "not a repo\n")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("exists but is not a git repository", report["errors"][0])

    def test_git_source_fake_git_marker_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            bootstrap = base / "bootstrap"
            bootstrap.mkdir()
            local = bootstrap / ".pamem" / "memory"
            self.write_memory_repo(local, name="fake-memory")
            (local / ".git").mkdir()
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("not a git repository/work tree", report["errors"][0])

    def test_git_source_plain_dir_inside_parent_repo_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            parent = base / "parent"
            parent.mkdir()
            self.git(parent, "init", "-b", "main")
            bootstrap = parent / "bootstrap"
            bootstrap.mkdir()
            local = bootstrap / ".pamem" / "memory"
            self.write_memory_repo(local, name="plain-memory")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("not the git repository root", report["errors"][0])

    def test_git_source_local_path_must_stay_under_pamem(self):
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp)
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "../remote-memory"
                local_path = "../memory"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("source.local_path must stay under .pamem", report["errors"][0])
