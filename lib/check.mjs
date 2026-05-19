import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveRuntimeState } from './runtime.mjs';

const SUPPORTED_SCHEMA_VERSION = '0.1';
const PROPOSAL_TYPES = new Set(['memory_proposal']);
const PROPOSAL_STATUSES = new Set(['pending_review', 'approved']);
const CANDIDATE_KINDS = new Set(['memory', 'mixed']);
const TARGET_SURFACES = new Set(['pamem', 'unknown']);
const RISKS = new Set(['low', 'medium', 'high']);
const SOURCE_REF_KINDS = new Set([
  'slock_message',
  'slock_thread',
  'task',
  'test',
  'pr',
  'doc',
  'file',
  'url',
  'manual_note',
]);
const TRANSCRIPT_KEYS = new Set([
  'transcript',
  'transcripts',
  'raw_transcript',
  'raw_transcripts',
  'raw_log',
  'raw_logs',
  'message_log',
  'message_logs',
  'messages',
  'chat_log',
  'chat_logs',
  'tool_output',
  'tool_outputs',
]);
const PRIVATE_PATH_PATTERNS = [
  new RegExp(`/${'root'}/`),
  new RegExp(`/${'home'}/`),
  new RegExp(`~/${['.slock', 'agents'].join('/')}/`),
];

export function runCheckCommand(tokens, context) {
  if (tokens[0] === '-h' || tokens[0] === '--help' || tokens[0] === 'help') {
    printCheckUsage();
    return 0;
  }
  const args = parseCheckArgs(tokens);
  if (args.help) return 0;

  const state = resolveRuntimeState(runtimeArgs(args), context, { command: 'status' });
  const report = checkMemoryProposal(args.proposalPath, state);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printProposalCheckHuman(report);
  }
  return report.summary.error_count > 0 ? 1 : 0;
}

export class CheckCommandError extends Error {}

function parseCheckArgs(tokens) {
  const args = {
    json: false,
    workspace: '',
    agentId: '',
    proposalPath: '',
    help: false,
  };
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      printCheckUsage();
      args.help = true;
      return args;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--workspace') {
      args.workspace = requireValue(tokens, ++index, '--workspace');
      continue;
    }
    if (token.startsWith('--workspace=')) {
      args.workspace = token.slice('--workspace='.length);
      continue;
    }
    if (token === '--agent-id') {
      args.agentId = requireValue(tokens, ++index, '--agent-id');
      continue;
    }
    if (token.startsWith('--agent-id=')) {
      args.agentId = token.slice('--agent-id='.length);
      continue;
    }
    if (token.startsWith('-')) {
      throw new CheckCommandError(`unknown option: ${token}`);
    }
    positionals.push(token);
  }

  if (positionals.length !== 1) {
    throw new CheckCommandError('usage: pamem check <artifact-file>');
  }
  args.proposalPath = positionals[0];
  return args;
}

function requireValue(tokens, index, option) {
  const value = tokens[index];
  if (!value || value.startsWith('-')) {
    throw new CheckCommandError(`missing value for ${option}`);
  }
  return value;
}

function runtimeArgs(args) {
  const result = [];
  if (args.workspace) result.push('--workspace', args.workspace);
  if (args.agentId) result.push('--agent-id', args.agentId);
  return result;
}

function checkMemoryProposal(proposalPathArg, state) {
  const proposalPath = resolve(proposalPathArg);
  const checks = [];
  const proposal = readProposal(proposalPath, checks);
  if (proposal) validateProposal(proposal, checks);
  validateComponentState(state, checks);

  const summary = countChecks(checks);
  return {
    command: 'check',
    component: 'pamem',
    contract_version: SUPPORTED_SCHEMA_VERSION,
    status: reportStatus(summary),
    schema_version: SUPPORTED_SCHEMA_VERSION,
    proposal_path: proposalPath,
    proposal_id: stringValue(proposal?.proposal_id),
    proposal_type: stringValue(proposal?.proposal_type),
    target_owner: stringValue(proposal?.target_owner),
    target_surface: stringValue(proposal?.target_surface),
    workspace: state.workspace,
    config: state.configFile,
    memory_repo: state.memoryRepoRoot,
    memory_entry: state.memoryRepoRoot && state.memoryEntryFile ? join(state.memoryRepoRoot, state.memoryEntryFile) : '',
    downstream_execution: 'not-run',
    writes: [],
    owner_next_step: 'review the proposal, then create a pamem-owned memory PR or request if the durable change is accepted',
    summary,
    checks,
  };
}

function readProposal(proposalPath, checks) {
  if (!existsSync(proposalPath)) {
    checks.push(check('proposal.exists', 'error', false, 'memory proposal file is missing', { path: proposalPath }));
    return null;
  }
  checks.push(check('proposal.exists', 'info', true, 'memory proposal file exists', { path: proposalPath }));

  let text;
  try {
    text = readFileSync(proposalPath, 'utf8');
  } catch (error) {
    checks.push(check('proposal.read', 'error', false, `failed to read memory proposal file: ${error.message}`, { path: proposalPath }));
    return null;
  }

  if (text.length > 64 * 1024) {
    checks.push(check('proposal.size', 'warning', false, 'memory proposal file is large; keep artifacts compact and reference external evidence'));
  } else {
    checks.push(check('proposal.size', 'info', true, 'memory proposal file size is compact'));
  }

  try {
    const proposal = JSON.parse(text);
    checks.push(check('proposal.parse', 'info', true, 'memory proposal JSON parses'));
    return proposal;
  } catch (error) {
    checks.push(check('proposal.parse', 'error', false, `memory proposal file is not valid JSON: ${error.message}`, { path: proposalPath }));
    return null;
  }
}

function validateProposal(proposal, checks) {
  if (!isPlainObject(proposal)) {
    checks.push(check('proposal.shape', 'error', false, 'memory proposal root must be a JSON object'));
    return;
  }

  stringField(proposal, 'schema_version', 'proposal.schema_version', checks, { exact: SUPPORTED_SCHEMA_VERSION });
  stringField(proposal, 'proposal_id', 'proposal.proposal_id', checks);
  enumField(proposal, 'proposal_type', 'proposal.proposal_type', checks, PROPOSAL_TYPES);
  enumField(proposal, 'status', 'proposal.status', checks, PROPOSAL_STATUSES, {
    message: 'status must be pending_review or approved before pamem owner handoff',
  });
  stringField(proposal, 'created_at', 'proposal.created_at', checks);
  stringField(proposal, 'request_id', 'proposal.request_id', checks);
  stringField(proposal, 'request_path', 'proposal.request_path', checks);
  validateSourceRefs(proposal.source_refs, checks, 'proposal.source_refs');
  objectField(proposal, 'trigger', 'proposal.trigger', checks);
  stringField(proposal, 'target_owner', 'proposal.target_owner', checks, { exact: 'pamem' });
  stringField(proposal, 'target_surface', 'proposal.target_surface', checks, { exact: 'pamem' });
  booleanField(proposal, 'review_required', 'proposal.review_required', checks, { exact: true });
  enumField(proposal, 'risk', 'proposal.risk', checks, RISKS);
  stringField(proposal, 'summary', 'proposal.summary', checks);
  stringField(proposal, 'rationale', 'proposal.rationale', checks);
  validateCandidateItems(proposal.candidate_items, checks);
  validateRequestedOutput(proposal.requested_output, checks);
  validateAcceptanceChecks(proposal.acceptance_checks, checks);
  validateAutomationBoundary(proposal.automation_boundary, checks);
  validateOutcome(proposal.outcome, checks);
  rejectTranscriptLikeFields(proposal, checks);
}

function validateSourceRefs(sourceRefs, checks, prefix) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    checks.push(check(prefix, 'error', false, 'source_refs must be a non-empty array'));
    return;
  }
  checks.push(check(prefix, 'info', true, 'source_refs are present'));
  sourceRefs.forEach((sourceRef, index) => {
    const itemPrefix = `${prefix}[${index}]`;
    if (!isPlainObject(sourceRef)) {
      checks.push(check(itemPrefix, 'error', false, 'source ref must be an object'));
      return;
    }
    enumField(sourceRef, 'kind', `${itemPrefix}.kind`, checks, SOURCE_REF_KINDS);
    stringField(sourceRef, 'ref', `${itemPrefix}.ref`, checks);
    stringField(sourceRef, 'summary', `${itemPrefix}.summary`, checks);
    warnPrivatePath(sourceRef.ref, checks, `${itemPrefix}.ref`);
  });
}

function validateCandidateItems(candidateItems, checks) {
  if (!Array.isArray(candidateItems) || candidateItems.length === 0) {
    checks.push(check('proposal.candidate_items', 'error', false, 'candidate_items must be a non-empty array'));
    return;
  }
  checks.push(check('proposal.candidate_items', 'info', true, 'candidate_items are present'));

  let memoryCandidateCount = 0;
  candidateItems.forEach((item, index) => {
    const prefix = `proposal.candidate_items[${index}]`;
    if (!isPlainObject(item)) {
      checks.push(check(prefix, 'error', false, 'candidate item must be an object'));
      return;
    }
    stringField(item, 'id', `${prefix}.id`, checks);
    stringField(item, 'summary', `${prefix}.summary`, checks);
    stringField(item, 'evidence', `${prefix}.evidence`, checks);
    enumField(item, 'candidate_kind', `${prefix}.candidate_kind`, checks, CANDIDATE_KINDS, {
      message: 'candidate_kind must be memory or mixed for a pamem memory proposal',
    });
    if (CANDIDATE_KINDS.has(item.candidate_kind)) memoryCandidateCount += 1;
    enumField(item, 'target_surface', `${prefix}.target_surface`, checks, TARGET_SURFACES, {
      message: 'target_surface must be pamem or unknown for a pamem memory proposal',
    });
    if (item.target_surface === 'unknown') {
      checks.push(check(`${prefix}.target_surface.unknown`, 'warning', false, 'candidate target surface is unknown; clarify before memory PR creation'));
    }
    enumField(item, 'risk', `${prefix}.risk`, checks, RISKS);
    booleanField(item, 'review_required', `${prefix}.review_required`, checks);
    if (item.review_required !== true) {
      checks.push(check(`${prefix}.review_required.boundary`, 'error', false, 'memory proposal candidates must require owner review'));
    }
    stringField(item, 'reason', `${prefix}.reason`, checks);
    if (item.source_refs !== undefined) {
      if (!Array.isArray(item.source_refs) || item.source_refs.length === 0) {
        checks.push(check(`${prefix}.source_refs.empty`, 'warning', false, 'candidate-level source_refs are optional; omit the field when there are no item-specific refs'));
      } else {
        validateSourceRefs(item.source_refs, checks, `${prefix}.source_refs`);
      }
    }
  });

  if (memoryCandidateCount === 0) {
    checks.push(check('proposal.candidate_items.memory_candidate', 'error', false, 'memory proposal must contain at least one memory or mixed candidate'));
  }
}

function validateRequestedOutput(requestedOutput, checks) {
  const prefix = 'proposal.requested_output';
  if (!isPlainObject(requestedOutput)) {
    checks.push(check(prefix, 'error', false, 'requested_output must be an object'));
    return;
  }
  stringField(requestedOutput, 'kind', `${prefix}.kind`, checks, { exact: 'memory_proposal' });
  stringField(requestedOutput, 'target_owner', `${prefix}.target_owner`, checks, { exact: 'pamem' });
  booleanField(requestedOutput, 'review_required', `${prefix}.review_required`, checks, { exact: true });
}

function validateAcceptanceChecks(acceptanceChecks, checks) {
  if (!Array.isArray(acceptanceChecks) || acceptanceChecks.length === 0) {
    checks.push(check('proposal.acceptance_checks', 'warning', false, 'acceptance_checks should reference the Noesis gate or a regression check'));
    return;
  }
  checks.push(check('proposal.acceptance_checks', 'info', true, 'acceptance_checks are present'));
}

function validateAutomationBoundary(boundary, checks) {
  const prefix = 'proposal.automation_boundary';
  if (!isPlainObject(boundary)) {
    checks.push(check(prefix, 'error', false, 'automation_boundary must be an object'));
    return;
  }
  stringField(boundary, 'mode', `${prefix}.mode`, checks, { exact: 'proposal_only' });
  booleanField(boundary, 'allow_apply', `${prefix}.allow_apply`, checks, { exact: false });
  stringField(boundary, 'downstream_execution', `${prefix}.downstream_execution`, checks, { exact: 'not-run' });
  booleanField(boundary, 'owner_apply_required', `${prefix}.owner_apply_required`, checks, { exact: true });
}

function validateOutcome(outcome, checks) {
  const prefix = 'proposal.outcome';
  if (!isPlainObject(outcome)) {
    checks.push(check(prefix, 'error', false, 'outcome must be an object'));
    return;
  }
  stringField(outcome, 'status', `${prefix}.status`, checks, { exact: 'not_applied' });
}

function validateComponentState(state, checks) {
  if (!existsSync(state.memoryRepoRoot)) {
    checks.push(check('component.memory_repo.exists', 'error', false, 'configured memory repo is missing', { path: state.memoryRepoRoot }));
    return;
  }
  checks.push(check('component.memory_repo.exists', 'info', true, 'configured memory repo exists', { path: state.memoryRepoRoot }));
}

function rejectTranscriptLikeFields(value, checks, pointer = 'proposal') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectTranscriptLikeFields(item, checks, `${pointer}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) {
    if (typeof value === 'string') {
      warnPrivatePath(value, checks, pointer);
      if (value.length > 2000) {
        checks.push(check(`${pointer}.size`, 'warning', false, 'long string may contain raw evidence; prefer compact references'));
      }
    }
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPointer = `${pointer}.${key}`;
    if (TRANSCRIPT_KEYS.has(key.toLowerCase())) {
      checks.push(check(`${nestedPointer}.raw_evidence`, 'error', false, 'proposal must not embed transcripts, message arrays, raw logs, or tool output'));
      continue;
    }
    rejectTranscriptLikeFields(nested, checks, nestedPointer);
  }
}

function warnPrivatePath(value, checks, pointer) {
  if (typeof value !== 'string') return;
  if (PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    checks.push(check(`${pointer}.private_path`, 'warning', false, 'value appears to contain a private machine-local path; prefer a short source ref'));
  }
}

function stringField(object, field, id, checks, options = {}) {
  if (typeof object[field] !== 'string' || object[field].trim() === '') {
    checks.push(check(id, 'error', false, `${field} must be a non-empty string`));
    return;
  }
  if (options.exact !== undefined && object[field] !== options.exact) {
    checks.push(check(id, 'error', false, `${field} must be ${options.exact}`));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is valid`));
}

function enumField(object, field, id, checks, allowed, options = {}) {
  if (typeof object[field] !== 'string' || !allowed.has(object[field])) {
    checks.push(check(id, 'error', false, options.message || `${field} has an unsupported value`));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is valid`));
}

function booleanField(object, field, id, checks, options = {}) {
  if (typeof object[field] !== 'boolean') {
    checks.push(check(id, 'error', false, `${field} must be boolean`));
    return;
  }
  if (options.exact !== undefined && object[field] !== options.exact) {
    checks.push(check(id, 'error', false, `${field} must be ${options.exact}`));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is valid`));
}

function objectField(object, field, id, checks) {
  if (!isPlainObject(object[field])) {
    checks.push(check(id, 'error', false, `${field} must be an object`));
    return;
  }
  checks.push(check(id, 'info', true, `${field} is present`));
}

function check(id, severity, ok, message, extra = {}) {
  return { id, severity, ok, message, ...extra };
}

function countChecks(checks) {
  const summary = { error_count: 0, warning_count: 0, info_count: 0 };
  for (const item of checks) {
    if (item.severity === 'error') summary.error_count += 1;
    else if (item.severity === 'warning') summary.warning_count += 1;
    else summary.info_count += 1;
  }
  return summary;
}

function reportStatus(summary) {
  if (summary.error_count > 0) return 'error';
  if (summary.warning_count > 0) return 'warning';
  return 'ok';
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function printProposalCheckHuman(report) {
  console.log(`pamem check: ${report.status}`);
  console.log(`proposal_id=${report.proposal_id}`);
  console.log(`proposal_type=${report.proposal_type}`);
  console.log(`target_owner=${report.target_owner}`);
  console.log(`memory_repo=${report.memory_repo}`);
  console.log(`downstream_execution=${report.downstream_execution}`);
  console.log(`writes=${report.writes.length}`);
  console.log(`summary=errors:${report.summary.error_count} warnings:${report.summary.warning_count} info:${report.summary.info_count}`);
  for (const item of report.checks.filter((entry) => entry.severity !== 'info')) {
    console.log(`${item.severity}: ${item.id}: ${item.message}`);
  }
}

function printCheckUsage() {
  console.log(`Usage: pamem check <artifact-file> [--workspace <path>] [--agent-id <id>] [--json]

Read-only owner gate for Noesis memory_proposal artifacts. It validates that the
artifact targets pamem, preserves the proposal-only boundary, contains compact
source references, and embeds no transcripts or raw logs. It does not apply,
rewrite, propagate, or stage memory changes.

Examples:
  pamem check .noesis/proposals/example__01__memory_proposal.json --workspace <workspace> --json`);
}
