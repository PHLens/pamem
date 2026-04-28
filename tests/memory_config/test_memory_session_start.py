import json
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SESSION_START = REPO_ROOT / "scripts" / "memory-session-start.sh"


class MemorySessionStartConfigTest(unittest.TestCase):
    def run_hook(self, cwd):
        result = subprocess.run(
            [str(SESSION_START)],
            input=json.dumps({"cwd": str(cwd)}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            self.fail(f"session start failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        return json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]

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
        self.write(root, "MEMORY.md", f"# {name}\n")
        (root / "notes").mkdir(parents=True, exist_ok=True)

    def test_absent_config_keeps_v0_memory_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# V0 Memory\n")
            context = self.run_hook(root)
            self.assertIn("Memory config: absent, using V0 layout", context)
            self.assertIn("# V0 Memory", context)

    def test_direct_memory_repo_adds_config_diagnostic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, name="direct-memory")
            context = self.run_hook(root)
            self.assertIn("Memory config: memory-repo direct-memory, schema 0.1", context)
            self.assertIn("# direct-memory", context)

    def test_local_source_loads_materialized_memory_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bootstrap = base / "bootstrap"
            memory = base / "memory"
            bootstrap.mkdir()
            memory.mkdir()
            self.write(bootstrap, "MEMORY.md", "# Bootstrap Memory\n")
            self.write_memory_repo(memory, name="local-memory")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../memory"
                """,
            )
            context = self.run_hook(bootstrap)
            self.assertIn(f"Memory source: local -> {memory.resolve()}", context)
            self.assertIn("# local-memory", context)
            self.assertNotIn("# Bootstrap Memory", context)

    def test_invalid_config_falls_back_to_current_v0_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# Fallback Memory\n")
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "bad-memory"
                entry_file = "../MEMORY.md"
                notes_dir = "notes"
                """,
            )
            context = self.run_hook(root)
            self.assertIn("Memory config error:", context)
            self.assertIn("# Fallback Memory", context)
