import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { workspaceRoot } from '../local/environment.js';
import { requireG3 } from './gate.js';

export interface DeployEnvironment {
  profile: string;
  account: string;
  region: string;
}
export function loadDeployEnvironment(): DeployEnvironment {
  requireG3();
  let file: Record<string, string>;
  try {
    file = parse(readFileSync(resolve(workspaceRoot, '.env.deploy.local')));
  } catch {
    throw new Error(
      'Prepare .env.deploy.local using docs/implementation/env/deploy.env.example after G3.',
    );
  }
  const values = { ...file, ...process.env };
  const profile = values.STUDY_AWS_PROFILE;
  const account = values.STUDY_AWS_ACCOUNT_ID;
  const region = values.AWS_REGION ?? 'ap-northeast-2';
  if (!profile || profile.startsWith('REPLACE_')) throw new Error('Set STUDY_AWS_PROFILE.');
  if (!account || !/^\d{12}$/.test(account))
    throw new Error('Set STUDY_AWS_ACCOUNT_ID to the expected 12-digit account.');
  if (region !== 'ap-northeast-2')
    throw new Error('The selected architecture requires AWS_REGION=ap-northeast-2.');
  return { profile, account, region };
}
export function aws(config: DeployEnvironment, args: string[]): unknown {
  const result = spawnSync(
    'aws',
    [
      ...args,
      '--profile',
      config.profile,
      '--region',
      config.region,
      '--output',
      'json',
      '--no-cli-pager',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0)
    throw new Error(
      `AWS read/action failed: ${args.slice(0, 2).join(' ')}. Check profile login, permissions and service state.`,
    );
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
export function verifyAccount(config: DeployEnvironment) {
  const identity = aws(config, ['sts', 'get-caller-identity']) as { Account?: string };
  if (identity.Account !== config.account)
    throw new Error('STS account does not match STUDY_AWS_ACCOUNT_ID.');
}
