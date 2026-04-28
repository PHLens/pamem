#!/usr/bin/env python3
import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    tomllib = None


SCHEMA_VERSION = "0.1"
CONFIG_RELATIVE_PATH = ".pamem/config.toml"
ALLOWED_CATEGORIES = {"meta", "domain", "mixed", "transient"}
ALLOWED_DESTINATIONS = {"pamem-experience", "wiki-stage", "split", "none"}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}
ALLOWED_ACTIONS = {"append-experience", "stage-wiki-note", "split-item", "discard", "request-review"}
ALLOWED_EXPERIENCE_TYPES = {"finding", "correction", "meta"}
KEY_VALUE_RE_TEMPLATE = r"(?mi)^\s*{key}\s*[:=]\s*(.+?)\s*$"
DOMAIN_KEYWORDS = [
    "DTensor",
    "distributed tensor",
    "PyTorch",
    "Triton",
    "GPU cache coherence",
    "source summary",
    "paper summary",
    "article summary",
    "concept card",
    "wiki concept",
    "MOC",
    "领域事实",
    "领域知识",
    "论文",
]
DOMAIN_EXPLANATION_PATTERNS = [
    re.compile(r"\b[A-Z][A-Za-z0-9_-]{2,}\s+(is|are|refers to|means)\b"),
    re.compile(r"\b[A-Z][A-Za-z0-9_-]{2,}\s+是"),
]
META_HINTS = [
    "agent should",
    "agent must",
    "workflow",
    "remember to",
    "when working",
    "操作经验",
    "工作流",
]


def note_pointer_re(notes_dir_raw):
    escaped = re.escape(notes_dir_raw.strip("/"))
    return re.compile(rf"(?<![\w./-])({escaped}/[A-Za-z0-9][A-Za-z0-9._/\- ]*?\.md)")


class MemoryLintError(Exception):
    pass


@dataclass(frozen=True)
class PathInfo:
    raw: str
    path: Path
    rel_path: str


@dataclass(frozen=True)
class ProfileInfo:
    name: str
    description: str
    load: list[PathInfo]
    stable_targets: list[PathInfo]


@dataclass(frozen=True)
class LintConfig:
    path: Path
    schema_version: str
    kind: str
    name: str
    entry_file: PathInfo
    notes_dir: PathInfo
    requests_inbox_dir: PathInfo
    profiles: list[ProfileInfo]
    default_profile: str | None = None


@dataclass
class MemoryFile:
    path: Path
    rel_path: str
    text: str
    kind: str


@dataclass
class Finding:
    rule: str
    severity: str
    path: str
    line: int | None
    title: str
    message: str
    evidence: str
    suggested_action: str
    source_refs: list[dict] = field(default_factory=list)


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    return 2


def path_display(path, base):
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return str(path)


def load_toml(path):
    if tomllib is None:
        raise MemoryLintError("memory lint requires Python 3.11+ to parse .pamem/config.toml")
    try:
        with path.open("rb") as handle:
            data = tomllib.load(handle)
    except tomllib.TOMLDecodeError as exc:
        raise MemoryLintError(f"TOML parse error in {path}: {exc}") from exc
    except OSError as exc:
        raise MemoryLintError(f"failed to read {path}: {exc.strerror}") from exc
    if not isinstance(data, dict):
        raise MemoryLintError(f"{path} must contain a TOML table")
    return data


def require_string(table, key, context):
    if key not in table:
        raise MemoryLintError(f"{context}.{key} is required")
    value = table[key]
    if not isinstance(value, str) or not value.strip():
        raise MemoryLintError(f"{context}.{key} must be a non-empty string")
    return value


def string_list(table, key, context):
    if key not in table:
        raise MemoryLintError(f"{context}.{key} is required")
    value = table[key]
    if not isinstance(value, list):
        raise MemoryLintError(f"{context}.{key} must be a list of strings")
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise MemoryLintError(f"{context}.{key}[{index}] must be a non-empty string")
    return value


def repo_path(memory_root, raw_path, context):
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise MemoryLintError(f"{context} must be a non-empty string")
    path_value = raw_path.strip()
    path = Path(path_value)
    if path.is_absolute():
        raise MemoryLintError(f"{context} must be a relative path inside the memory repo")
    root = memory_root.resolve()
    resolved = (root / path).resolve()
    try:
        rel_path = resolved.relative_to(root).as_posix()
    except ValueError as exc:
        raise MemoryLintError(f"{context} must stay inside the memory repo") from exc
    if rel_path == ".":
        raise MemoryLintError(f"{context} must name a file or directory inside the memory repo")
    return PathInfo(raw=raw_path, path=resolved, rel_path=rel_path)


def load_lint_config(memory_root):
    config_path = memory_root / CONFIG_RELATIVE_PATH
    if not config_path.exists():
        raise MemoryLintError(f"missing required config.toml: {config_path}")
    data = load_toml(config_path)
    context = str(config_path)
    schema_version = require_string(data, "schema_version", context)
    if schema_version != SCHEMA_VERSION:
        raise MemoryLintError(
            f"{CONFIG_RELATIVE_PATH}: unsupported schema_version {schema_version!r}; expected {SCHEMA_VERSION!r}"
        )
    kind = require_string(data, "kind", context)
    if kind != "memory-repo":
        raise MemoryLintError(f"{CONFIG_RELATIVE_PATH} must declare kind 'memory-repo' (found {kind!r})")

    name = require_string(data, "name", context)
    entry_file = repo_path(memory_root, require_string(data, "entry_file", context), "entry_file")
    notes_dir = repo_path(memory_root, require_string(data, "notes_dir", context), "notes_dir")

    requests_data = data.get("requests", {})
    if not isinstance(requests_data, dict):
        raise MemoryLintError(f"{CONFIG_RELATIVE_PATH} [requests] must be a table")
    inbox_raw = requests_data.get("inbox_dir", "requests/inbox")
    if not isinstance(inbox_raw, str) or not inbox_raw.strip():
        raise MemoryLintError(f"{CONFIG_RELATIVE_PATH}.requests.inbox_dir must be a non-empty string")
    requests_inbox_dir = repo_path(
        memory_root,
        inbox_raw,
        "requests.inbox_dir",
    )

    profiles_data = data.get("profiles", {})
    if not isinstance(profiles_data, dict):
        raise MemoryLintError(f"{CONFIG_RELATIVE_PATH} [profiles] must be a table")
    profiles = []
    for profile_name, profile_data in profiles_data.items():
        profile_context = f"profiles.{profile_name}"
        if not isinstance(profile_data, dict):
            raise MemoryLintError(f"{profile_context} must be a table")
        description = require_string(profile_data, "description", profile_context)
        load = [
            repo_path(memory_root, path, f"{profile_context}.load[{index}]")
            for index, path in enumerate(string_list(profile_data, "load", profile_context))
        ]
        stable_targets = [
            repo_path(memory_root, path, f"{profile_context}.stable_targets[{index}]")
            for index, path in enumerate(string_list(profile_data, "stable_targets", profile_context))
        ]
        profiles.append(
            ProfileInfo(
                name=profile_name,
                description=description,
                load=load,
                stable_targets=stable_targets,
            )
        )

    default_profile = data.get("default_profile")
    if default_profile is not None:
        if not isinstance(default_profile, str) or not default_profile.strip():
            raise MemoryLintError(f"{CONFIG_RELATIVE_PATH}.default_profile must be a non-empty string")
        if default_profile not in {profile.name for profile in profiles}:
            raise MemoryLintError(
                f"{CONFIG_RELATIVE_PATH}.default_profile {default_profile!r} does not match a configured profile"
            )

    return LintConfig(
        path=config_path.resolve(),
        schema_version=schema_version,
        kind=kind,
        name=name,
        entry_file=entry_file,
        notes_dir=notes_dir,
        requests_inbox_dir=requests_inbox_dir,
        profiles=profiles,
        default_profile=default_profile,
    )


def is_stable_note(memory_file):
    return memory_file.kind == "stable-target"


def is_memory_index(memory_file):
    return memory_file.kind == "entry-file"


def line_for_offset(text, offset):
    if offset < 0:
        return None
    return text.count("\n", 0, offset) + 1


def line_for_substring(text, needle):
    return line_for_offset(text, text.find(needle))


def short_evidence(text, limit=160):
    one_line = " ".join(text.strip().split())
    if len(one_line) <= limit:
        return one_line
    return one_line[: limit - 3].rstrip() + "..."


def paragraph_spans(text):
    offset = 0
    for match in re.finditer(r"\n\s*\n", text):
        paragraph = text[offset : match.start()]
        if paragraph.strip():
            yield offset, paragraph
        offset = match.end()
    tail = text[offset:]
    if tail.strip():
        yield offset, tail


def has_domain_keyword(text):
    lowered = text.lower()
    for keyword in DOMAIN_KEYWORDS:
        if keyword.lower() in lowered:
            return keyword
    return None


def domain_evidence(text):
    for offset, paragraph in paragraph_spans(text):
        keyword = has_domain_keyword(paragraph)
        if keyword:
            explanatory = any(pattern.search(paragraph) for pattern in DOMAIN_EXPLANATION_PATTERNS)
            direct_boundary = keyword.lower() in {
                "source summary",
                "paper summary",
                "article summary",
                "concept card",
                "wiki concept",
                "moc",
                "领域事实",
                "领域知识",
                "论文",
            }
            if explanatory or direct_boundary:
                return offset, paragraph
    return None


def mixed_evidence(text):
    for offset, paragraph in paragraph_spans(text):
        if not has_domain_keyword(paragraph):
            continue
        lowered = paragraph.lower()
        if any(hint in lowered for hint in META_HINTS):
            return offset, paragraph
    return None


def metadata_value(text, key):
    pattern = re.compile(KEY_VALUE_RE_TEMPLATE.format(key=re.escape(key)))
    match = pattern.search(text)
    if not match:
        return None
    value = match.group(1).strip().strip("'\"")
    return value


def bool_metadata_value(text, key):
    value = metadata_value(text, key)
    if value is None:
        return None
    return value.lower() in {"true", "yes", "1"}


def iter_entry_blocks(text):
    headings = list(re.finditer(r"(?m)^#{1,6}\s+.+?$", text))
    if headings:
        for index, heading in enumerate(headings):
            end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
            yield heading.start(), text[heading.start() : end]
        return
    for offset, paragraph in paragraph_spans(text):
        yield offset, paragraph


def pending_split_review_note(text):
    review_status = metadata_value(text, "review_status")
    category = metadata_value(text, "category")
    destination = metadata_value(text, "destination")
    return review_status == "pending" and (
        category == "mixed" or destination == "split" or "pending split" in text.lower()
    )


def finding(rule, severity, path, line, title, message, evidence, suggested_action, source_refs=None):
    return Finding(
        rule=rule,
        severity=severity,
        path=path,
        line=line,
        title=title,
        message=message,
        evidence=short_evidence(evidence),
        suggested_action=suggested_action,
        source_refs=source_refs or [],
    )


def read_text(path):
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise MemoryLintError(f"failed to read {path}: {exc.strerror}") from exc


def collect_memory_files(memory_root, lint_config):
    files = []
    entry_file = lint_config.entry_file
    files.append(MemoryFile(entry_file.path, entry_file.rel_path, read_text(entry_file.path), "entry-file"))
    for target in stable_target_infos(lint_config):
        if target.path.exists() and target.path.is_file():
            files.append(MemoryFile(target.path, target.rel_path, read_text(target.path), "stable-target"))
    return files


def lint_note_boundaries(memory_files):
    findings = []
    for memory_file in memory_files:
        domain_hit = domain_evidence(memory_file.text)
        mixed_hit = mixed_evidence(memory_file.text)
        if is_stable_note(memory_file) and domain_hit:
            offset, evidence = domain_hit
            findings.append(
                finding(
                    "ML001",
                    "error",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, offset),
                    "Domain content appears in a pamem note",
                    "Stable pamem notes must hold agent operating memory, not domain knowledge.",
                    evidence,
                    "stage-wiki-note",
                )
            )
        if is_stable_note(memory_file) and mixed_hit:
            offset, evidence = mixed_hit
            findings.append(
                finding(
                    "ML002",
                    "error",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, offset),
                    "Mixed domain and operating memory content appears in a pamem note",
                    "Mixed content should be split before stable memory persistence.",
                    evidence,
                    "split-item",
                )
            )
    return findings


def lint_entry_metadata(memory_files):
    findings = []
    for memory_file in memory_files:
        if not is_stable_note(memory_file):
            continue
        for offset, entry_text in iter_entry_blocks(memory_file.text):
            category = metadata_value(entry_text, "category")
            destination = metadata_value(entry_text, "destination")
            if category == "domain" or destination == "wiki-stage":
                evidence = f"category: {category}" if category == "domain" else f"destination: {destination}"
                findings.append(
                    finding(
                        "ML001",
                        "error",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, offset),
                        "Domain-routed memory entry appears in a pamem note",
                        "Stable pamem entries marked domain/wiki-stage must be staged through an external knowledge store.",
                        evidence,
                        "stage-wiki-note",
                    )
                )
            if category == "mixed" or destination == "split":
                if not pending_split_review_note(entry_text):
                    evidence = f"category: {category}" if category == "mixed" else f"destination: {destination}"
                    findings.append(
                        finding(
                            "ML002",
                            "error",
                            memory_file.rel_path,
                            line_for_offset(memory_file.text, offset),
                            "Mixed-routed memory entry appears in a pamem note",
                            "Mixed entries must be split or kept as pending review notes before stable memory persistence.",
                            evidence,
                            "request-review",
                        )
                    )
            if category == "transient" or destination == "none":
                evidence = f"category: {category}" if category == "transient" else f"destination: {destination}"
                findings.append(
                    finding(
                        "ML004",
                        "warning",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, offset),
                        "Transient-routed memory entry appears in a pamem note",
                        "Transient or discard-routed entries should not be persisted in stable memory.",
                        evidence,
                        "discard",
                    )
                )
            confidence = metadata_value(entry_text, "confidence")
            if confidence == "low" and bool_metadata_value(entry_text, "review_required") is not True:
                findings.append(
                    finding(
                        "ML005",
                        "error",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, offset),
                        "Low-confidence memory entry lacks review requirement",
                        "Low-confidence entries must require review before stable memory persistence.",
                        "confidence: low",
                        "request-review",
                    )
                )
    return findings


def lint_entry_file(memory_files, memory_root, lint_config, line_threshold, max_code_blocks, max_paragraph_chars):
    findings = []
    memory_file = next((item for item in memory_files if is_memory_index(item)), None)
    if not memory_file:
        return findings
    entry_path = memory_file.rel_path
    lines = memory_file.text.splitlines()
    if len(lines) > line_threshold:
        findings.append(
            finding(
                "ML006",
                "warning",
                entry_path,
                line_threshold + 1,
                "Entry file exceeds line threshold",
                "The configured entry file should remain a compact pointer and governance entry point.",
                f"{len(lines)} lines",
                "request-review",
            )
        )
    code_blocks = len(re.findall(r"(?m)^```", memory_file.text)) // 2
    if code_blocks > max_code_blocks:
        findings.append(
            finding(
                "ML006",
                "warning",
                entry_path,
                None,
                "Entry file contains too many fenced code blocks",
                "Command output or detailed examples should live outside the startup index.",
                f"{code_blocks} fenced code blocks",
                "request-review",
            )
        )
    for offset, paragraph in paragraph_spans(memory_file.text):
        if len(paragraph) > max_paragraph_chars:
            findings.append(
                finding(
                    "ML006",
                    "warning",
                    entry_path,
                    line_for_offset(memory_file.text, offset),
                    "Entry file contains an oversized paragraph",
                    "Long explanatory blocks should move to an appropriate note with a pointer.",
                    paragraph,
                    "request-review",
                )
            )
            break
    if len(re.findall(r"(?mi)^\s*(user|assistant|agent)\s*:", memory_file.text)) >= 4:
        findings.append(
            finding(
                "ML006",
                "warning",
                entry_path,
                None,
                "Entry file appears to contain transcript text",
                "Full transcripts should not be stored in the configured entry file.",
                "Repeated speaker labels detected.",
                "request-review",
            )
        )
    domain_hit = domain_evidence(memory_file.text)
    if domain_hit:
        offset, evidence = domain_hit
        findings.append(
            finding(
                "ML006",
                "warning",
                entry_path,
                line_for_offset(memory_file.text, offset),
                "Entry file contains domain explanation",
                "Domain explanations should move to an appropriate note with a pointer from the entry file.",
                evidence,
                "stage-wiki-note",
            )
        )
    missing_configured_targets = {
        path_info.rel_path
        for path_info in stable_target_infos(lint_config)
        if not path_info.path.exists()
    }
    notes_dir_prefix = lint_config.notes_dir.rel_path
    for match in note_pointer_re(notes_dir_prefix).finditer(memory_file.text):
        note_rel = match.group(1).strip()
        note_path = (memory_root / note_rel).resolve()
        if note_rel not in missing_configured_targets and (
            not note_path.exists() or not path_under(note_path, lint_config.notes_dir.path)
        ):
            findings.append(
                finding(
                    "ML007",
                    "error",
                    entry_path,
                    line_for_offset(memory_file.text, match.start()),
                    "Entry file points to a missing note",
                    "Local note pointers in the configured entry file must resolve under the memory root.",
                    note_rel,
                    "request-review",
                )
            )
    for offset, entry_text in iter_entry_blocks(memory_file.text):
        category = metadata_value(entry_text, "category")
        destination = metadata_value(entry_text, "destination")
        if category == "transient" or destination == "none":
            evidence = f"category: {category}" if category == "transient" else f"destination: {destination}"
            findings.append(
                finding(
                    "ML004",
                    "warning",
                    entry_path,
                    line_for_offset(memory_file.text, offset),
                    "Transient-routed entry appears in entry file",
                    "Transient or discard-routed entries should not be persisted in the memory entry file.",
                    evidence,
                    "discard",
                )
            )
    return findings


def lint_stable_entry_types(memory_files):
    findings = []
    for memory_file in memory_files:
        if not is_stable_note(memory_file):
            continue
        headings = [
            match for match in re.finditer(r"(?m)^(#{2,6})\s+(.+?)\s*$", memory_file.text)
        ]
        if not headings:
            continue
        for index, heading in enumerate(headings):
            end = headings[index + 1].start() if index + 1 < len(headings) else len(memory_file.text)
            section = memory_file.text[heading.start() : end]
            if not section.strip():
                continue
            type_match = re.search(r"(?mi)^\s*type\s*[:=]\s*([A-Za-z_-]+)\s*$", section)
            if not type_match:
                findings.append(
                    finding(
                        "ML008",
                        "warning",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, heading.start()),
                        "Stable memory entry lacks type marker",
                        "Stable memory entries should declare type: finding, correction, or meta.",
                        heading.group(2),
                        "request-review",
                    )
                )
            elif type_match.group(1) not in ALLOWED_EXPERIENCE_TYPES:
                findings.append(
                    finding(
                        "ML008",
                        "warning",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, type_match.start()),
                        "Stable memory entry has invalid type marker",
                        "Stable memory entry type should be finding, correction, or meta.",
                        type_match.group(0),
                        "request-review",
                    )
                )
    return findings


def duplicate_key(line):
    clean = re.sub(r"`[^`]+`", "", line)
    clean = re.sub(r"^[#*\-\s0-9.]+", "", clean).strip().lower()
    clean = re.sub(r"[^a-z0-9 ]+", " ", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    if len(clean) < 24 or len(clean.split()) < 4:
        return None
    return clean


def lint_duplicates(memory_files):
    findings = []
    seen = {}
    for memory_file in memory_files:
        if not is_stable_note(memory_file):
            continue
        lines = memory_file.text.splitlines()
        supersession_marker = "supersed" in memory_file.text.lower()
        for line_number, line in enumerate(lines, start=1):
            if not re.match(r"^\s*(#{2,6}\s+|[-*]\s+)", line):
                continue
            key = duplicate_key(line)
            if not key:
                continue
            if key in seen and not supersession_marker and not seen[key]["supersession_marker"]:
                first = seen[key]
                findings.append(
                    finding(
                        "ML009",
                        "info",
                        memory_file.rel_path,
                        line_number,
                        "Possible duplicate stable memory entry",
                        f"This entry resembles {first['path']}:{first['line']} and may need consolidation.",
                        line,
                        "request-review",
                    )
                )
            else:
                seen[key] = {
                    "path": memory_file.rel_path,
                    "line": line_number,
                    "supersession_marker": supersession_marker,
                }
    return findings


def unique_path_infos(path_infos):
    unique = []
    seen = set()
    for path_info in path_infos:
        if path_info.rel_path in seen:
            continue
        seen.add(path_info.rel_path)
        unique.append(path_info)
    return unique


def stable_target_infos(lint_config):
    return unique_path_infos(
        target
        for profile in lint_config.profiles
        for target in profile.stable_targets
    )


def load_path_infos(lint_config):
    return unique_path_infos(
        load_path
        for profile in lint_config.profiles
        for load_path in profile.load
    )


def config_report(lint_config):
    return {
        "path": str(lint_config.path),
        "schema_version": lint_config.schema_version,
        "kind": lint_config.kind,
        "name": lint_config.name,
        "entry_file": lint_config.entry_file.rel_path,
        "notes_dir": lint_config.notes_dir.rel_path,
        "requests_inbox_dir": lint_config.requests_inbox_dir.rel_path,
        "profiles": [profile.name for profile in lint_config.profiles],
        "stable_targets": [path_info.rel_path for path_info in stable_target_infos(lint_config)],
        "load_paths": [path_info.rel_path for path_info in load_path_infos(lint_config)],
    }


def path_under(child, parent):
    try:
        child.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def lint_config_model(lint_config):
    findings = []
    stable_targets = stable_target_infos(lint_config)
    if not stable_targets:
        findings.append(
            finding(
                "ML011",
                "error",
                CONFIG_RELATIVE_PATH,
                None,
                "No stable targets configured",
                "At least one profile must configure a stable_targets path for persistent memory.",
                "profiles.*.stable_targets",
                "request-review",
            )
        )

    for path_info in stable_targets:
        if path_info.path == lint_config.entry_file.path:
            findings.append(
                finding(
                    "ML011",
                    "error",
                    path_info.rel_path,
                    None,
                    "Stable target points at entry_file",
                    "Stable target paths must not equal the configured entry_file.",
                    path_info.raw,
                    "request-review",
                )
            )
            continue
        if not path_under(path_info.path, lint_config.notes_dir.path):
            findings.append(
                finding(
                    "ML011",
                    "error",
                    path_info.rel_path,
                    None,
                    "Stable target is outside notes_dir",
                    "Stable target paths must be files under notes_dir.",
                    path_info.raw,
                    "request-review",
                )
            )
            continue
        if not path_info.path.exists():
            findings.append(
                finding(
                    "ML011",
                    "error",
                    path_info.rel_path,
                    None,
                    "Stable target is missing",
                    "Configured stable target paths must exist.",
                    path_info.raw,
                    "request-review",
                )
            )
            continue
        if not path_info.path.is_file():
            findings.append(
                finding(
                    "ML011",
                    "error",
                    path_info.rel_path,
                    None,
                    "Stable target is not a file",
                    "Configured stable target paths must be files, not directories or other file types.",
                    path_info.raw,
                    "request-review",
                )
            )

    if not lint_config.requests_inbox_dir.path.is_dir():
        findings.append(
            finding(
                "ML012",
                "warning",
                lint_config.requests_inbox_dir.rel_path,
                None,
                "Requests inbox is missing",
                "Configured requests.inbox_dir must exist and be a directory.",
                lint_config.requests_inbox_dir.raw,
                "request-review",
            )
        )

    for path_info in load_path_infos(lint_config):
        if not path_info.path.exists():
            findings.append(
                finding(
                    "ML013",
                    "warning",
                    path_info.rel_path,
                    None,
                    "Load path is missing",
                    "Configured profile load paths should exist so startup memory is complete.",
                    path_info.raw,
                    "request-review",
                )
            )

    return findings


def build_report(findings, memory_root, lint_config):
    summary = {
        "error_count": sum(1 for item in findings if item.severity == "error"),
        "warning_count": sum(1 for item in findings if item.severity == "warning"),
        "info_count": sum(1 for item in findings if item.severity == "info"),
    }
    serialized = []
    for index, item in enumerate(findings, start=1):
        data = {
            "id": f"finding-{index}",
            "rule": item.rule,
            "severity": item.severity,
            "path": item.path,
            "line": item.line,
            "title": item.title,
            "message": item.message,
            "evidence": item.evidence,
            "suggested_action": item.suggested_action,
        }
        if item.source_refs:
            data["source_refs"] = item.source_refs
        serialized.append(data)
    created_at = now_utc()
    return {
        "schema_version": SCHEMA_VERSION,
        "lint_id": f"{created_at.replace(':', '-')}__memory_lint",
        "created_at": created_at,
        "memory_root": str(memory_root),
        "config": config_report(lint_config),
        "summary": summary,
        "findings": serialized,
    }


def print_human(report):
    summary = report["summary"]
    if not report["findings"]:
        print("No memory lint findings.")
        return
    print(
        "Memory lint findings: "
        f"{summary['error_count']} error(s), "
        f"{summary['warning_count']} warning(s), "
        f"{summary['info_count']} info."
    )
    for item in report["findings"]:
        location = item["path"]
        if item.get("line") is not None:
            location = f"{location}:{item['line']}"
        print(f"{item['id']} {item['severity']} {item['rule']} {location}")
        print(f"  {item['title']}: {item['message']}")
        if item.get("evidence"):
            print(f"  evidence: {item['evidence']}")
        print(f"  suggested_action: {item['suggested_action']}")


def run_lint(args):
    memory_root = Path(args.memory_root).expanduser().resolve()
    if not memory_root.exists() or not memory_root.is_dir():
        raise MemoryLintError(f"memory root does not exist or is not a directory: {memory_root}")
    lint_config = load_lint_config(memory_root)
    memory_files = collect_memory_files(memory_root, lint_config)
    findings = []
    findings.extend(lint_config_model(lint_config))
    findings.extend(lint_note_boundaries(memory_files))
    findings.extend(lint_entry_metadata(memory_files))
    findings.extend(lint_stable_entry_types(memory_files))
    findings.extend(lint_duplicates(memory_files))
    findings.extend(
        lint_entry_file(
            memory_files,
            memory_root,
            lint_config,
            args.line_threshold,
            args.max_code_blocks,
            args.max_paragraph_chars,
        )
    )
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    findings.sort(
        key=lambda item: (
            severity_rank.get(item.severity, 99),
            item.path,
            item.line if item.line is not None else 0,
            item.rule,
        )
    )
    return build_report(findings, memory_root, lint_config)


def build_parser():
    parser = argparse.ArgumentParser(
        prog="memory-lint",
        description="Report-only lint for configured pamem memory repositories.",
    )
    parser.add_argument("--memory-root", required=True, help="Path to the configured memory repository")
    parser.add_argument("--json", action="store_true", help="Emit JSON report")
    parser.add_argument("--strict", action="store_true", help="Return 1 when warnings are present")
    parser.add_argument("--line-threshold", type=int, default=80)
    parser.add_argument("--max-code-blocks", type=int, default=2)
    parser.add_argument("--max-paragraph-chars", type=int, default=1200)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        report = run_lint(args)
    except MemoryLintError as exc:
        return fail(str(exc))
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_human(report)
    summary = report["summary"]
    if summary["error_count"] > 0:
        return 1
    if args.strict and summary["warning_count"] > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
