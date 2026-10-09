import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudyStacks } from '../src/stacks.js';
import { spaRewriteCode } from '../src/spa-rewrite.js';

type Resource = {
  Type: string;
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};
type CloudTemplate = { Resources: Record<string, Resource>; Outputs: Record<string, unknown> };

describe('the selected three-stack AWS architecture (offline synth)', () => {
  const outdir = mkdtempSync(join(tmpdir(), 'devday-infra-'));
  const app = new App({ outdir, context: { 'aws:cdk:asset-staging': false } });
  let stacks: ReturnType<typeof createStudyStacks>;
  let foundation: Template;
  let api: Template;
  let edge: Template;

  beforeAll(() => {
    stacks = createStudyStacks(app, { env: { region: 'ap-northeast-2' } });
    const assembly = app.synth();
    expect(assembly.manifest.missing ?? []).toEqual([]);
    foundation = Template.fromStack(stacks.foundation);
    api = Template.fromStack(stacks.api);
    edge = Template.fromStack(stacks.edge);
  });

  afterAll(() => rmSync(outdir, { recursive: true, force: true }));

  it('uses two public and two isolated subnets, an IGW, and no NAT', () => {
    foundation.resourceCountIs('AWS::EC2::Subnet', 4);
    foundation.resourceCountIs('AWS::EC2::InternetGateway', 1);
    foundation.resourceCountIs('AWS::EC2::NatGateway', 0);
    foundation.resourceCountIs('AWS::EC2::Route', 2);
    const subnets = Object.values(foundation.findResources('AWS::EC2::Subnet'));
    expect(subnets.filter((subnet) => subnet.Properties.MapPublicIpOnLaunch === true)).toHaveLength(
      2,
    );
    expect(
      subnets.filter((subnet) => subnet.Properties.MapPublicIpOnLaunch === false),
    ).toHaveLength(2);
  });

  it('only accepts CloudFront at the ALB, ALB at the task, and tasks at RDS', () => {
    foundation.hasParameter('CloudFrontPrefixListId', { AllowedPattern: '^pl-[a-f0-9]+$' });
    const resources = (foundation.toJSON() as CloudTemplate).Resources;
    const groups = Object.entries(resources).filter(
      ([, r]) => r.Type === 'AWS::EC2::SecurityGroup',
    );
    const albGroupId = groups.find(([id]) => id.startsWith('AlbSecurityGroup'))![0];
    const taskGroupId = groups.find(([id]) => id.startsWith('TaskSecurityGroup'))![0];
    const dbGroupId = groups.find(([id]) => id.startsWith('DatabaseSecurityGroup'))![0];
    // CDK emits SG-to-SG rules separately to avoid circular resource references.
    const allRules = Object.values(resources).filter(
      (r) => r.Type === 'AWS::EC2::SecurityGroupIngress',
    );
    expect(allRules).toHaveLength(3);
    expect(allRules).toContainEqual(
      expect.objectContaining({
        Properties: expect.objectContaining({
          GroupId: { 'Fn::GetAtt': [albGroupId, 'GroupId'] },
          FromPort: 80,
          ToPort: 80,
          SourcePrefixListId: { Ref: 'CloudFrontPrefixListId' },
        }),
      }),
    );
    const ruleFor = (targetId: string, sourceId: string, port: number) =>
      expect(allRules).toContainEqual(
        expect.objectContaining({
          Properties: expect.objectContaining({
            GroupId: { 'Fn::GetAtt': [targetId, 'GroupId'] },
            SourceSecurityGroupId: { 'Fn::GetAtt': [sourceId, 'GroupId'] },
            FromPort: port,
            ToPort: port,
          }),
        }),
      );
    ruleFor(taskGroupId, albGroupId, 3000);
    ruleFor(dbGroupId, taskGroupId, 5432);
    for (const rule of allRules) expect(rule.Properties.CidrIp).toBeUndefined();
  });

  it('retains private PostgreSQL 17, buckets and secrets independently of API replacement', () => {
    foundation.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: { Ref: 'PostgresVersion' },
      DBInstanceClass: 'db.t4g.micro',
      AllocatedStorage: '20',
      StorageType: 'gp3',
      MultiAZ: false,
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DeletionProtection: true,
    });
    foundation.hasParameter('PostgresVersion', {
      Default: '17',
      AllowedPattern: '^17(?:\\.[0-9]+)?$',
    });
    for (const type of ['AWS::RDS::DBInstance', 'AWS::S3::Bucket', 'AWS::SecretsManager::Secret']) {
      for (const resource of Object.values(foundation.findResources(type))) {
        expect(resource.DeletionPolicy).toBe('Retain');
        expect(resource.UpdateReplacePolicy).toBe('Retain');
      }
    }
    foundation.resourceCountIs('AWS::S3::Bucket', 2);
    for (const bucket of Object.values(foundation.findResources('AWS::S3::Bucket'))) {
      expect(bucket.Properties.WebsiteConfiguration).toBeUndefined();
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
    expect(stacks.foundation.terminationProtection).toBe(true);
  });

  it('keeps a single Linux AMD64 task, replaces it without overlap and allows initial migration', () => {
    api.hasParameter('AppDesiredCount', { Default: 1, AllowedValues: ['0', '1'] });
    api.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: { Ref: 'AppDesiredCount' },
      DeploymentConfiguration: Match.objectLike({ MinimumHealthyPercent: 0, MaximumPercent: 100 }),
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }),
      },
    });
    api.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '512',
      Memory: '1024',
      NetworkMode: 'awsvpc',
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'X86_64', OperatingSystemFamily: 'LINUX' },
    });
    api.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
    const definition = Object.values(api.findResources('AWS::ECS::TaskDefinition'))[0].Properties;
    expect(definition.ContainerDefinitions).toHaveLength(1);
    const assetManifest = JSON.parse(
      readFileSync(join(outdir, 'StudyApiStack.assets.json'), 'utf8'),
    );
    expect(Object.values(assetManifest.dockerImages)).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ platform: 'linux/amd64', dockerFile: 'Dockerfile' }),
      }),
    ]);
  });

  it('injects live AWS runtime values and secret references, without embedding keys', () => {
    const container = Object.values(api.findResources('AWS::ECS::TaskDefinition'))[0].Properties
      .ContainerDefinitions[0];
    expect(container.Environment).toEqual(
      expect.arrayContaining([
        { Name: 'APP_ENV', Value: 'aws' },
        { Name: 'AI_MODE', Value: 'live' },
        { Name: 'API_HOST', Value: '0.0.0.0' },
        { Name: 'PORT', Value: '3000' },
        { Name: 'DB_SSL_MODE', Value: 'verify-full' },
        { Name: 'DB_SSL_CA_PATH', Value: '/app/certs/global-bundle.pem' },
        { Name: 'MEDIA_DRIVER', Value: 's3' },
        { Name: 'SESSION_COOKIE_SECURE', Value: 'true' },
        { Name: 'OPENAI_TEXT_MODEL', Value: { Ref: 'OpenAiTextModel' } },
        { Name: 'OPENAI_LIVE_TRANSCRIBE_MODEL', Value: { Ref: 'OpenAiLiveTranscribeModel' } },
        { Name: 'OPENAI_CORRECTION_MODEL', Value: { Ref: 'OpenAiCorrectionModel' } },
        { Name: 'OPENAI_IMAGE_MODEL', Value: { Ref: 'OpenAiImageModel' } },
      ]),
    );
    api.hasParameter('OpenAiTextModel', { Default: 'gpt-6-luna' });
    api.hasParameter('OpenAiLiveTranscribeModel', { Default: 'gpt-live-transcribe' });
    api.hasParameter('OpenAiCorrectionModel', { Default: 'gpt-transcribe' });
    api.hasParameter('OpenAiImageModel', { Default: 'gpt-image-2.5-flare-2026-09-08' });
    expect(container.Secrets.map((secret: { Name: string }) => secret.Name).sort()).toEqual([
      'DB_PASSWORD',
      'DB_USER',
      'OPENAI_API_KEY',
    ]);
    expect(container.Environment.map((env: { Name: string }) => env.Name)).not.toEqual(
      expect.arrayContaining(['DB_PASSWORD', 'OPENAI_API_KEY']),
    );
    expect(JSON.stringify(api.toJSON())).not.toContain('AWS_ACCESS_KEY_ID');
    const policies = Object.values(api.findResources('AWS::IAM::Policy'));
    const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const media = statements.find(
      (statement) => Array.isArray(statement.Action) && statement.Action.includes('s3:PutObject'),
    );
    expect(media.Action).toEqual(['s3:GetObject', 's3:PutObject', 's3:DeleteObject']);
    expect(JSON.stringify(media.Resource)).toContain('/*');
  });

  it('routes private ALB HTTP to IP targets, with process-only health checks and WS timeout', () => {
    api.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal',
      Type: 'application',
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'idle_timeout.timeout_seconds', Value: '120' },
      ]),
    });
    api.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
    });
    api.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 3000,
      Protocol: 'HTTP',
      TargetType: 'ip',
      HealthCheckPath: '/healthz',
    });
    edge.hasResourceProperties('AWS::CloudFront::VpcOrigin', {
      VpcOriginEndpointConfig: Match.objectLike({
        HTTPPort: 80,
        OriginProtocolPolicy: 'http-only',
      }),
    });
  });

  it('keeps private API/WS cookies and errors out of CDN caches and the SPA rewrite', () => {
    const config = Object.values(edge.findResources('AWS::CloudFront::Distribution'))[0].Properties
      .DistributionConfig;
    expect(config.CustomErrorResponses).toBeUndefined();
    expect(config.CacheBehaviors).toHaveLength(2);
    for (const behavior of config.CacheBehaviors) {
      expect(['/api/*', '/ws/*']).toContain(behavior.PathPattern);
      expect(behavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
      expect(behavior.OriginRequestPolicyId).toBe('216adef6-5c7f-47e4-b989-5492eafa07d3');
      expect(behavior.AllowedMethods).toHaveLength(7);
      expect(behavior.FunctionAssociations).toBeUndefined();
    }
    expect(config.DefaultCacheBehavior.FunctionAssociations).toHaveLength(1);
    edge.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        MinTTL: 0,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          CookiesConfig: { CookieBehavior: 'none' },
        }),
      }),
    });
    edge.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    edge.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: 's3:GetObject',
          }),
        ]),
      }),
    });
  });

  it('has one-way stack dependencies and required deployment outputs', () => {
    expect(JSON.stringify(foundation.toJSON())).not.toContain('Fn::ImportValue');
    expect(JSON.stringify(api.toJSON())).not.toContain('StudyEdgeStack');
    const manifest = JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf8'));
    expect(manifest.artifacts.StudyEdgeStack.dependencies).toContain('StudyApiStack');
    expect(manifest.artifacts.StudyFoundationStack.dependencies ?? []).not.toContain(
      'StudyEdgeStack',
    );
    for (const name of [
      'WebBucketName',
      'MediaBucketName',
      'RdsSecretArn',
      'OpenAiSecretArn',
      'PublicSubnetIds',
      'TaskSecurityGroupId',
    ])
      foundation.hasOutput(name, {});
    for (const name of ['ClusterArn', 'ServiceArn', 'TaskDefinitionArn']) api.hasOutput(name, {});
    for (const name of ['AppUrl', 'DistributionId']) edge.hasOutput(name, {});
  });
});

describe('SPA entry rewrite', () => {
  const rewrite = (uri: string) =>
    runInNewContext(`${spaRewriteCode}; handler({ request: { uri } }).uri`, { uri });
  it('serves the app on known navigation routes', () => {
    for (const uri of ['/', '/study', '/study/123', '/study/123/', '/experiences', '/learning']) {
      expect(rewrite(uri)).toBe('/index.html');
    }
  });
  it('preserves API/WS paths, static files and unknown paths', () => {
    for (const uri of [
      '/api/v1/me',
      '/ws/events',
      '/ws/audio',
      '/assets/missing.js',
      '/study/missing.js',
      '/study/id/missing',
      '/experiences/missing',
      '/unknown',
    ]) {
      expect(rewrite(uri)).toBe(uri);
    }
  });
});
