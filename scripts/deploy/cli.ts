import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  aws,
  deploymentProcessEnvironment,
  loadDeployEnvironment,
  verifyAccount,
} from './environment.js';
import { requireG3, verificationIdentity } from './gate.js';
import { workspaceRoot } from '../local/environment.js';
import { studyAvailabilityZones } from '../../infra/src/region.js';
import {
  apiParameters,
  cdk,
  migrate,
  output,
  poll,
  requireMigration,
  run,
  stackNames,
  stackOutputs,
  webInvalidationPaths,
  webUploadCommands,
  writeReceipt,
} from './operations.js';

const command = process.argv[2];
const supported = [
  'bootstrap',
  'diff',
  'foundation',
  'api-stage',
  'migrate',
  'api-start',
  'edge',
  'secret',
  'web',
  'status',
];
if (!command || !supported.includes(command))
  throw new Error(`Use one of: ${supported.join(', ')}.`);
const record = requireG3();
const config = loadDeployEnvironment();
verifyAccount(config);
const env = deploymentProcessEnvironment(config);

async function deploy(stack: string, parameters: string[] = []) {
  // Template diff is read-only and cannot publish an image or create a change set.
  // Exact deployment parameters are printed separately (CDK diff has no parameter option).
  await cdk(config, ['diff', stack, '--exclusively', '--method', 'template']);
  console.log(
    'Deployment parameters:',
    parameters.filter((value) => value !== '--parameters'),
  );
  await cdk(config, [
    'deploy',
    stack,
    '--exclusively',
    '--require-approval',
    'never',
    ...parameters,
  ]);
  writeReceipt(config, stack, { ...verificationIdentity(), outputs: stackOutputs(config, stack) });
}

switch (command) {
  case 'bootstrap':
    await cdk(config, ['bootstrap', `aws://${config.account}/${config.region}`]);
    break;
  case 'diff':
    await cdk(config, ['diff', '*', '--method', 'template']);
    break;
  case 'foundation': {
    const zones = aws(config, [
      'ec2',
      'describe-availability-zones',
      '--zone-names',
      ...studyAvailabilityZones,
    ]) as {
      AvailabilityZones?: { ZoneName: string; State: string }[];
    };
    if (
      !studyAvailabilityZones.every((name) =>
        zones.AvailabilityZones?.some(
          (zone) => zone.ZoneName === name && zone.State === 'available',
        ),
      )
    )
      throw new Error(
        'The two configured Seoul availability zones are not available in this account.',
      );
    const prefixes = aws(config, [
      'ec2',
      'describe-managed-prefix-lists',
      '--filters',
      'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing',
    ]) as {
      PrefixLists?: { PrefixListId: string }[];
    };
    const prefix = prefixes.PrefixLists?.[0]?.PrefixListId;
    if (!prefix || !/^pl-[a-f0-9]+$/.test(prefix))
      throw new Error('CloudFront prefix list unavailable.');
    const version = process.argv
      .find((value) => value.startsWith('--postgres-version='))
      ?.split('=')[1];
    if (!version || !/^17\.\d+$/.test(version))
      throw new Error('Specify --postgres-version=17.x from AWS preflight.');
    const options = aws(config, [
      'rds',
      'describe-orderable-db-instance-options',
      '--engine',
      'postgres',
      '--engine-version',
      version,
      '--db-instance-class',
      'db.t4g.micro',
    ]) as {
      OrderableDBInstanceOptions?: { StorageType: string }[];
    };
    if (!options.OrderableDBInstanceOptions?.some((option) => option.StorageType === 'gp3'))
      throw new Error(
        'The selected PostgreSQL minor/db.t4g.micro/gp3 combination is not orderable.',
      );
    await deploy(stackNames.foundation, [
      '--parameters',
      `${stackNames.foundation}:CloudFrontPrefixListId=${prefix}`,
      '--parameters',
      `${stackNames.foundation}:PostgresVersion=${version}`,
    ]);
    break;
  }
  case 'api-stage': {
    const foundation = stackOutputs(config, stackNames.foundation);
    const secret = aws(config, [
      'secretsmanager',
      'describe-secret',
      '--secret-id',
      output(foundation, 'OpenAiSecretArn'),
    ]) as {
      VersionIdsToStages?: Record<string, string[]>;
    };
    if (
      !Object.values(secret.VersionIdsToStages ?? {}).some((stages) =>
        stages.includes('AWSCURRENT'),
      )
    )
      throw new Error('Populate the OpenAI secret before staging the API.');
    await deploy(stackNames.api, apiParameters(record, 0));
    break;
  }
  case 'migrate':
    await migrate(config);
    break;
  case 'api-start': {
    const staged = stackOutputs(config, stackNames.api);
    requireMigration(config, output(staged, 'TaskDefinitionArn'));
    await deploy(stackNames.api, apiParameters(record, 1));
    const deployed = stackOutputs(config, stackNames.api);
    await poll(
      'ALB target health',
      () =>
        aws(config, [
          'elbv2',
          'describe-target-health',
          '--target-group-arn',
          output(deployed, 'TargetGroupArn'),
        ]) as {
          TargetHealthDescriptions?: { TargetHealth?: { State?: string } }[];
        },
      (result) =>
        result.TargetHealthDescriptions?.length === 1 &&
        result.TargetHealthDescriptions[0]?.TargetHealth?.State === 'healthy',
    );
    break;
  }
  case 'edge':
    await deploy(stackNames.edge);
    break;
  case 'secret': {
    if (process.stdin.isTTY)
      throw new Error('Pipe the OpenAI key on stdin. Never put it in command arguments.');
    const key = readFileSync(0, 'utf8').trim();
    if (!key || key.includes('\n') || key.length > 16384)
      throw new Error('Expected one nonempty OpenAI API key on stdin.');
    const foundation = stackOutputs(config, stackNames.foundation);
    // macOS child-process pipes are not reopenable as /dev/stdin by AWS CLI.
    // Keep the stdin interface while using a private, short-lived param file.
    const directory = mkdtempSync(resolve(tmpdir(), 'devday-secret-'));
    try {
      const path = resolve(directory, 'input.json');
      writeFileSync(
        path,
        JSON.stringify({ SecretId: output(foundation, 'OpenAiSecretArn'), SecretString: key }),
        { mode: 0o600 },
      );
      aws(config, ['secretsmanager', 'put-secret-value', '--cli-input-json', `file://${path}`]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    console.log('PASS OpenAI secret stored; value was not logged.');
    break;
  }
  case 'web': {
    const foundation = stackOutputs(config, stackNames.foundation);
    const edge = stackOutputs(config, stackNames.edge);
    const dist = resolve(workspaceRoot, 'apps/web/dist');
    await run('pnpm', ['--filter', '@devday/web', 'build'], { ...env, VITE_API_BASE: '/api/v1' });
    // Never delete earlier hashed assets: a browser may still have the previous index open.
    for (const args of webUploadCommands(dist, output(foundation, 'WebBucketName')))
      await run(
        'aws',
        [...args, '--profile', config.profile, '--region', config.region, '--no-cli-pager'],
        env,
      );
    const distributionId = output(edge, 'DistributionId');
    const invalidation = aws(config, [
      'cloudfront',
      'create-invalidation',
      '--distribution-id',
      distributionId,
      '--paths',
      ...webInvalidationPaths,
    ]) as { Invalidation?: { Id?: string } };
    const invalidationId = invalidation.Invalidation?.Id;
    if (!invalidationId) throw new Error('CloudFront did not return an invalidation ID.');
    await poll(
      'CloudFront invalidation',
      () =>
        aws(config, [
          'cloudfront',
          'get-invalidation',
          '--distribution-id',
          distributionId,
          '--id',
          invalidationId,
        ]) as { Invalidation?: { Status?: string } },
      (value) => value.Invalidation?.Status === 'Completed',
    );
    writeReceipt(config, 'web', {
      ...verificationIdentity(),
      appUrl: output(edge, 'AppUrl'),
      distributionId,
      invalidationId,
    });
    console.log(`Deployed web: ${output(edge, 'AppUrl')}`);
    break;
  }
  case 'status':
    for (const stack of Object.values(stackNames)) console.log(stack, stackOutputs(config, stack));
    break;
}
