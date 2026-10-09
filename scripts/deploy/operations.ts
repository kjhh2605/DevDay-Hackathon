import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceRoot } from '../local/environment.js';
import { aws, deploymentProcessEnvironment, type DeployEnvironment } from './environment.js';
import { requireG3, sourceFingerprint } from './gate.js';

export const stackNames = {
  foundation: 'StudyFoundationStack',
  api: 'StudyApiStack',
  edge: 'StudyEdgeStack',
} as const;
export const modelParameters = {
  OPENAI_TEXT_MODEL: 'OpenAiTextModel',
  OPENAI_LIVE_TRANSCRIBE_MODEL: 'OpenAiLiveTranscribeModel',
  OPENAI_CORRECTION_MODEL: 'OpenAiCorrectionModel',
  OPENAI_IMAGE_MODEL: 'OpenAiImageModel',
  OPENAI_DECISION_MODEL: 'OpenAiDecisionModel',
} as const;
export const runtimeParameters = {
  SPEECH_DECISION_TIMEOUT_MS: ['SpeechDecisionTimeoutMs', 1, 10000],
  CHAT_DECISION_TIMEOUT_MS: ['ChatDecisionTimeoutMs', 1, 60000],
  SPEECH_DECISION_CONFIDENCE: ['SpeechDecisionConfidence', 0, 1],
} as const;

export function apiParameters(record: Record<string, unknown>, desiredCount: 0 | 1): string[] {
  const models = record.models as Record<string, unknown> | undefined;
  const runtime = record.runtime as Record<string, unknown> | undefined;
  const parameters = [`${stackNames.api}:AppDesiredCount=${desiredCount}`];
  for (const [key, parameter] of Object.entries(modelParameters)) {
    const value = models?.[key];
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value))
      throw new Error(`Record the locally verified ${key} in G3 models.`);
    parameters.push(`${stackNames.api}:${parameter}=${value}`);
  }
  for (const [key, [parameter, min, max]] of Object.entries(runtimeParameters)) {
    const value = runtime?.[key];
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      String(value).trim() === '' ||
      !Number.isFinite(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new Error(`Record the locally verified ${key} in G3 runtime.`);
    parameters.push(`${stackNames.api}:${parameter}=${value}`);
  }
  return parameters.flatMap((value) => ['--parameters', value]);
}

export function stackOutputs(config: DeployEnvironment, stack: string): Record<string, string> {
  const result = aws(config, ['cloudformation', 'describe-stacks', '--stack-name', stack]) as {
    Stacks?: { StackStatus: string; Outputs?: { OutputKey: string; OutputValue: string }[] }[];
  };
  const deployed = result.Stacks?.[0];
  if (
    !deployed ||
    !['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(
      deployed.StackStatus,
    )
  )
    throw new Error(`${stack} must be deployed and stable.`);
  return Object.fromEntries(
    (deployed.Outputs ?? []).map((item) => [item.OutputKey, item.OutputValue]),
  );
}
export function output(outputs: Record<string, string>, key: string): string {
  const value = outputs[key];
  if (!value) throw new Error(`Missing CloudFormation output ${key}.`);
  return value;
}
export function receiptPath(config: DeployEnvironment, name: string): string {
  return resolve(
    workspaceRoot,
    '.local/deploy',
    `${config.account}-${config.region}`,
    `${name}.json`,
  );
}
export function writeReceipt(
  config: DeployEnvironment,
  name: string,
  result: Record<string, unknown>,
) {
  const path = receiptPath(config, name);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2) + '\n',
    { mode: 0o600 },
  );
}
export function run(
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = workspaceRoot,
): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${program} ${args[0]} failed (${code}).`)),
    );
  });
}
export async function cdk(config: DeployEnvironment, args: string[]) {
  await run(
    'pnpm',
    [
      '--filter',
      '@devday/infra',
      'exec',
      'cdk',
      ...args,
      '--profile',
      config.profile,
      '--region',
      config.region,
      '--strict',
      '--no-lookups',
    ],
    deploymentProcessEnvironment(config),
  );
}
export async function poll<T>(
  label: string,
  read: () => T,
  done: (value: T) => boolean,
  timeoutMs = 20 * 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (done(value)) return value;
    console.log(`WAIT ${label}`);
    await delay(10_000);
  }
  throw new Error(`${label} timed out; inspect AWS state before retrying.`);
}

export function migrationRequest(foundation: Record<string, string>, api: Record<string, string>) {
  return {
    cluster: output(api, 'ClusterArn'),
    taskDefinition: output(api, 'TaskDefinitionArn'),
    launchType: 'FARGATE',
    count: 1,
    clientToken: randomUUID(),
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: output(foundation, 'PublicSubnetIds').split(','),
        securityGroups: [output(foundation, 'TaskSecurityGroupId')],
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [{ name: 'api', command: ['node', 'apps/api/dist/db/migrate.js'] }],
    },
  };
}
export function assertMigrationSucceeded(result: {
  failures?: unknown[];
  tasks?: {
    lastStatus?: string;
    containers?: { name?: string; exitCode?: number }[];
  }[];
}) {
  const task = result.tasks?.[0];
  if (
    result.failures?.length ||
    result.tasks?.length !== 1 ||
    task?.lastStatus !== 'STOPPED' ||
    task.containers?.find((container) => container.name === 'api')?.exitCode !== 0
  )
    throw new Error(
      'Migration did not exit successfully. Inspect the migration task and CloudWatch logs; API startup is blocked.',
    );
}
export async function migrate(config: DeployEnvironment) {
  const foundation = stackOutputs(config, stackNames.foundation);
  const api = stackOutputs(config, stackNames.api);
  const request = migrationRequest(foundation, api);
  const result = aws(config, ['ecs', 'run-task', '--cli-input-json', JSON.stringify(request)]) as {
    tasks?: { taskArn?: string }[];
    failures?: unknown[];
  };
  const taskArn = result.tasks?.[0]?.taskArn;
  if (result.failures?.length || result.tasks?.length !== 1 || !taskArn)
    throw new Error(
      'ECS failed to start the migration task; no successful migration was recorded.',
    );
  console.log(`Migration task: ${taskArn}`);
  type TaskResult = Parameters<typeof assertMigrationSucceeded>[0];
  const stopped = await poll(
    'migration task',
    () =>
      aws(config, [
        'ecs',
        'describe-tasks',
        '--cluster',
        request.cluster,
        '--tasks',
        taskArn,
      ]) as TaskResult,
    (value) => value.tasks?.[0]?.lastStatus === 'STOPPED',
  );
  assertMigrationSucceeded(stopped);
  writeReceipt(config, 'migration', {
    taskArn,
    taskDefinition: request.taskDefinition,
    exitCode: 0,
    sourceSha256: sourceFingerprint(),
    parameters: apiParameters(requireG3(), 1),
  });
  console.log('PASS AWS migration');
}
export function requireMigration(config: DeployEnvironment, taskDefinition: string) {
  let receipt: {
    taskDefinition?: string;
    exitCode?: number;
    sourceSha256?: string;
    parameters?: string[];
  };
  try {
    receipt = JSON.parse(readFileSync(receiptPath(config, 'migration'), 'utf8'));
  } catch {
    throw new Error('Run pnpm db:migrate:aws before starting the staged API.');
  }
  if (receipt.taskDefinition !== taskDefinition || receipt.exitCode !== 0)
    throw new Error(
      'The staged task definition has no successful migration receipt. Run pnpm db:migrate:aws.',
    );
  if (
    receipt.sourceSha256 !== sourceFingerprint() ||
    JSON.stringify(receipt.parameters) !== JSON.stringify(apiParameters(requireG3(), 1))
  )
    throw new Error(
      'Code or model settings changed after migration. Stage the API image and migrate again.',
    );
}

export const webInvalidationPaths = [
  '/',
  '/index.html',
  '/study',
  '/study/*',
  '/experiences',
  '/experiences/',
  '/learning',
  '/learning/',
];
export function webUploadCommands(dist: string, bucket: string): string[][] {
  const target = `s3://${bucket}`;
  return [
    [
      's3',
      'cp',
      resolve(dist, 'assets'),
      `${target}/assets/`,
      '--recursive',
      '--cache-control',
      'public,max-age=31536000,immutable',
      '--only-show-errors',
    ],
    [
      's3',
      'cp',
      dist,
      `${target}/`,
      '--recursive',
      '--exclude',
      'assets/*',
      '--exclude',
      'index.html',
      '--cache-control',
      'no-cache',
      '--only-show-errors',
    ],
    [
      's3',
      'cp',
      resolve(dist, 'index.html'),
      `${target}/index.html`,
      '--content-type',
      'text/html',
      '--cache-control',
      'no-cache',
      '--only-show-errors',
    ],
  ];
}
