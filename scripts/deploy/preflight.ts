import { aws, loadDeployEnvironment, verifyAccount } from './environment.js';

/** Read-only. The G3 guard runs before any AWS API call. */
export async function awsPreflight() {
  const config = loadDeployEnvironment();
  verifyAccount(config);
  console.log(`PASS AWS identity: expected account and ${config.region}.`);
  const engine = aws(config, [
    'rds',
    'describe-orderable-db-instance-options',
    '--engine',
    'postgres',
    '--db-instance-class',
    'db.t4g.micro',
  ]) as { OrderableDBInstanceOptions?: { EngineVersion: string; StorageType: string }[] };
  const versions = [
    ...new Set(
      engine.OrderableDBInstanceOptions?.filter(
        (item) => item.EngineVersion.startsWith('17.') && item.StorageType === 'gp3',
      ).map((item) => item.EngineVersion),
    ),
  ];
  if (!versions.length)
    throw new Error('No PostgreSQL 17/db.t4g.micro/gp3 orderable option found.');
  console.log(
    `PASS RDS orderable PostgreSQL 17: ${versions.join(', ')}. Select the verified minor for deployment.`,
  );
  const quota = aws(config, [
    'service-quotas',
    'get-service-quota',
    '--service-code',
    'fargate',
    '--quota-code',
    'L-3032A538',
  ]) as { Quota?: { Value: number } };
  if ((quota.Quota?.Value ?? 0) < 0.5)
    throw new Error('Fargate On-Demand vCPU quota is below the required 0.5 vCPU.');
  console.log(
    `PASS Fargate vCPU quota: ${quota.Quota?.Value}. Check existing usage before deployment.`,
  );
  const prefixes = aws(config, [
    'ec2',
    'describe-managed-prefix-lists',
    '--filters',
    'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing',
  ]) as { PrefixLists?: { PrefixListId: string }[] };
  if (!prefixes.PrefixLists?.length)
    throw new Error('CloudFront origin-facing managed prefix list unavailable.');
  console.log(`PASS CloudFront prefix list: ${prefixes.PrefixLists[0]!.PrefixListId}.`);
  const stacks = aws(config, [
    'cloudformation',
    'list-stacks',
    '--stack-status-filter',
    'CREATE_COMPLETE',
    'UPDATE_COMPLETE',
    'UPDATE_ROLLBACK_COMPLETE',
  ]) as { StackSummaries?: { StackName: string }[] };
  console.log(
    `INFO CDKToolkit: ${stacks.StackSummaries?.some((stack) => stack.StackName === 'CDKToolkit') ? 'present; validate version before deployment' : 'not present; bootstrap after preflight'}.`,
  );
  console.log(
    'PENDING deployment review: existing Fargate usage, SG prefix-list quota weight, current regional infrastructure/OpenAI cost estimate. No resources were created.',
  );
}
