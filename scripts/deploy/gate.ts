import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workspaceRoot } from '../local/environment.js';

export const requiredAcceptance = [
  ...Array.from({ length: 27 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 8 }, (_, index) => `E${String(index + 1).padStart(2, '0')}`),
];
export const requiredChecks = [
  'typecheck',
  'contracts',
  'unit',
  'integration',
  'e2e',
  'build',
  'infraSynth',
  'apiImage',
  'imageRestartPersistence',
  'liveOpenAi',
  'twoPhysicalLaptops',
  'trustedHttps',
  'realMicrophones',
];
export function sourceFingerprint(): string {
  const paths = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: workspaceRoot },
  )
    .toString()
    .split('\0')
    .filter((path) => path && !path.startsWith('docs/implementation/evidence/'))
    .sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path).update('\0');
    try {
      hash.update(readFileSync(resolve(workspaceRoot, path)));
    } catch {
      hash.update('DELETED');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}
export function verificationIdentity() {
  return {
    targetCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    }).trim(),
    lockfileSha256: createHash('sha256')
      .update(readFileSync(resolve(workspaceRoot, 'pnpm-lock.yaml')))
      .digest('hex'),
    sourceSha256: sourceFingerprint(),
  };
}
export function requireG3() {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(
      readFileSync(
        resolve(workspaceRoot, 'docs/implementation/evidence/local-validation.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
  } catch {
    throw new Error(
      'G3 is not verified. Complete local-validation.md and its local-validation.json execution record before AWS commands.',
    );
  }
  const acceptance = record.acceptance as Record<string, string> | undefined;
  const checks = record.checks as Record<string, string> | undefined;
  const missing = [
    ...requiredAcceptance.filter((key) => acceptance?.[key] !== 'pass'),
    ...requiredChecks.filter((key) => checks?.[key] !== 'pass'),
  ];
  if (record.gate !== 'pass' || missing.length)
    throw new Error(
      `G3 is not passed. Pending/failed: ${missing.join(', ') || 'gate'}. No AWS action was attempted.`,
    );
  const identity = verificationIdentity();
  for (const [key, value] of Object.entries(identity)) {
    if (key === 'targetCommit') continue;
    if (record[key] !== value)
      throw new Error(
        `G3 ${key} differs from current code. Revalidate affected local checks and record the verified source before AWS commands.`,
      );
  }
  // A follow-up evidence-only commit is normal: a commit cannot contain its own
  // SHA. Require the tested implementation commit to be an ancestor, with no
  // later code changes, and still compare the entire current source fingerprint.
  const testedCommit = record.targetCommit;
  if (
    typeof testedCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(testedCommit) ||
    spawnSync('git', ['merge-base', '--is-ancestor', testedCommit, 'HEAD'], { cwd: workspaceRoot })
      .status !== 0 ||
    spawnSync(
      'git',
      [
        'diff',
        '--quiet',
        testedCommit,
        'HEAD',
        '--',
        '.',
        ':(exclude)docs/implementation/evidence',
      ],
      { cwd: workspaceRoot },
    ).status !== 0
  ) {
    throw new Error(
      'G3 targetCommit does not match the current implementation. Only evidence-only follow-up commits are allowed without code revalidation.',
    );
  }
  if (
    record.aiMode !== 'live' ||
    !Array.isArray(record.physicalDevices) ||
    record.physicalDevices.length < 2
  )
    throw new Error('G3 requires live AI and evidence from two distinct physical laptops.');
  return record;
}
