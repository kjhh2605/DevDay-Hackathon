import { describe, expect, it } from 'vitest';
import { deploymentProcessEnvironment } from '../../scripts/deploy/environment.js';
import {
  apiParameters,
  assertMigrationSucceeded,
  migrationRequest,
  webInvalidationPaths,
  webUploadCommands,
} from '../../scripts/deploy/operations.js';

describe('AWS deployment boundaries', () => {
  it('rejects missing or invalid locally verified model and speech settings', () => {
    expect(() => apiParameters({}, 0)).toThrow('OPENAI_TEXT_MODEL');
    const record = {
      models: {
        OPENAI_TEXT_MODEL: 'text',
        OPENAI_LIVE_TRANSCRIBE_MODEL: 'live',
        OPENAI_CORRECTION_MODEL: 'correction',
        OPENAI_IMAGE_MODEL: 'image',
        OPENAI_DECISION_MODEL: 'decision',
      },
      runtime: {
        SPEECH_DECISION_TIMEOUT_MS: '2000',
        CHAT_DECISION_TIMEOUT_MS: '10000',
        SPEECH_DECISION_CONFIDENCE: '0.85',
      },
    };
    expect(apiParameters(record, 0)).toContain('StudyApiStack:AppDesiredCount=0');
    expect(apiParameters(record, 1)).toContain('StudyApiStack:OpenAiDecisionModel=decision');
    expect(() =>
      apiParameters(
        { ...record, runtime: { ...record.runtime, SPEECH_DECISION_CONFIDENCE: 'NaN' } },
        0,
      ),
    ).toThrow('SPEECH_DECISION_CONFIDENCE');
  });
  it('runs migrations using the deployed image, secrets and network, without starting the API', () => {
    const request = migrationRequest(
      { PublicSubnetIds: 'subnet-a,subnet-b', TaskSecurityGroupId: 'sg-task' },
      { ClusterArn: 'cluster-arn', TaskDefinitionArn: 'task-revision:42' },
    );
    expect(request.taskDefinition).toBe('task-revision:42');
    expect(request.count).toBe(1);
    expect(request.networkConfiguration.awsvpcConfiguration).toEqual({
      subnets: ['subnet-a', 'subnet-b'],
      securityGroups: ['sg-task'],
      assignPublicIp: 'ENABLED',
    });
    expect(request.overrides.containerOverrides).toEqual([
      { name: 'api', command: ['node', 'apps/api/dist/db/migrate.js'] },
    ]);
    expect(JSON.stringify(request)).not.toContain('environment');
  });
  it('does not treat a stopped or partially placed migration task as successful', () => {
    for (const result of [
      {},
      { tasks: [{ lastStatus: 'STOPPED' }] },
      { tasks: [{ lastStatus: 'STOPPED', containers: [{ name: 'api', exitCode: 1 }] }] },
      {
        failures: [{}],
        tasks: [{ lastStatus: 'STOPPED', containers: [{ name: 'api', exitCode: 0 }] }],
      },
    ])
      expect(() => assertMigrationSucceeded(result)).toThrow();
    expect(() =>
      assertMigrationSucceeded({
        tasks: [{ lastStatus: 'STOPPED', containers: [{ name: 'api', exitCode: 0 }] }],
      }),
    ).not.toThrow();
  });
  it('publishes immutable assets before index and never deletes old assets or invalidates private responses', () => {
    const commands = webUploadCommands('/tmp/dist', 'web-bucket');
    expect(commands[0]).toContain('public,max-age=31536000,immutable');
    expect(commands.at(-1)).toContain('/tmp/dist/index.html');
    expect(commands.at(-1)).toContain('no-cache');
    expect(commands.flat()).not.toContain('--delete');
    expect(webInvalidationPaths).not.toContain('/*');
    expect(
      webInvalidationPaths.some((path) => path.startsWith('/api') || path.startsWith('/ws')),
    ).toBe(false);
  });
  it('isolates the explicit profile from inherited credential environment variables', () => {
    const original = process.env.AWS_ACCESS_KEY_ID;
    process.env.AWS_ACCESS_KEY_ID = 'test-inherited-key';
    try {
      const env = deploymentProcessEnvironment({
        profile: 'chosen',
        account: '123456789012',
        region: 'ap-northeast-2',
      });
      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(env.AWS_PROFILE).toBe('chosen');
      expect(env.STUDY_AWS_ACCOUNT_ID).toBe('123456789012');
    } finally {
      if (original === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = original;
    }
  });
});
