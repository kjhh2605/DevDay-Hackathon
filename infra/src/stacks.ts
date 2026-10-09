import { fileURLToPath } from 'node:url';
import {
  Annotations,
  App,
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { spaRewriteCode } from './spa-rewrite.js';

export class StudyFoundationStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly albSecurityGroup: ec2.SecurityGroup;
  readonly taskSecurityGroup: ec2.SecurityGroup;
  readonly database: rds.DatabaseInstance;
  readonly webBucket: s3.Bucket;
  readonly mediaBucket: s3.Bucket;
  readonly openAiSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, { ...props, terminationProtection: true });
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.24.0.0/16'),
      availabilityZones: [Fn.select(0, Fn.getAzs()), Fn.select(1, Fn.getAzs())],
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'CloudFront VPC origin to the internal ALB',
      allowAllOutbound: false,
    });
    this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc: this.vpc,
      description: 'API and migration tasks; only ALB may enter',
      allowAllOutbound: true,
    });
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'PostgreSQL from the application task security group',
      allowAllOutbound: false,
    });
    // A deployment-time parameter avoids synth-time account/region lookups.
    const prefixList = new CfnParameter(this, 'CloudFrontPrefixListId', {
      type: 'String',
      allowedPattern: '^pl-[a-f0-9]+$',
      description:
        'Regional ID of com.amazonaws.global.cloudfront.origin-facing; resolve after G3 before deploying',
    });
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.prefixList(prefixList.valueAsString),
      ec2.Port.tcp(80),
      'CloudFront managed prefix list',
    );
    this.albSecurityGroup.addEgressRule(this.taskSecurityGroup, ec2.Port.tcp(3000), 'API target');
    this.taskSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(3000),
      'Internal ALB only',
    );
    databaseSecurityGroup.addIngressRule(
      this.taskSecurityGroup,
      ec2.Port.tcp(5432),
      'API and migration tasks only',
    );

    const bucketProps: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    };
    // Edge owns the web bucket policy so its Distribution ARN never points back
    // from Foundation to Edge. That policy also requires TLS.
    this.webBucket = new s3.Bucket(this, 'WebBucket', bucketProps);
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', { ...bucketProps, enforceSSL: true });
    const openAiSecret = new secretsmanager.CfnSecret(this, 'OpenAiSecret', {
      description:
        'OpenAI API key; populate securely after Foundation deployment and before API startup',
    });
    openAiSecret.applyRemovalPolicy(RemovalPolicy.RETAIN);
    this.openAiSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'OpenAiSecretReference',
      openAiSecret.ref,
    );

    const postgresVersion = new CfnParameter(this, 'PostgresVersion', {
      type: 'String',
      default: '17',
      allowedPattern: '^17(?:\\.[0-9]+)?$',
      description:
        'PostgreSQL 17 minor supported in the target account; major 17 selects its default minor',
    });
    const databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'devday_app' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.database = new rds.DatabaseInstance(this, 'Database', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of(postgresVersion.valueAsString, '17'),
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromSecret(databaseSecret, 'devday_app'),
      databaseName: 'devday_study',
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoMinorVersionUpgrade: true,
    });
    this.database.secret!.applyRemovalPolicy(RemovalPolicy.RETAIN);
    new CfnOutput(this, 'WebBucketName', { value: this.webBucket.bucketName });
    new CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
    new CfnOutput(this, 'RdsSecretArn', { value: this.database.secret!.secretArn });
    new CfnOutput(this, 'OpenAiSecretArn', { value: this.openAiSecret.secretArn });
    new CfnOutput(this, 'DatabaseHost', { value: this.database.dbInstanceEndpointAddress });
    new CfnOutput(this, 'PublicSubnetIds', {
      value: Fn.join(
        ',',
        this.vpc.publicSubnets.map((subnet) => subnet.subnetId),
      ),
    });
    new CfnOutput(this, 'TaskSecurityGroupId', { value: this.taskSecurityGroup.securityGroupId });
  }
}

interface ApiStackProps extends StackProps {
  foundation: StudyFoundationStack;
}

export class StudyApiStack extends Stack {
  readonly alb: elbv2.ApplicationLoadBalancer;
  readonly listener: elbv2.ApplicationListener;
  readonly cluster: ecs.Cluster;
  readonly service: ecs.FargateService;
  readonly task: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { foundation } = props;
    const desiredCount = new CfnParameter(this, 'AppDesiredCount', {
      type: 'Number',
      default: 1,
      allowedValues: ['0', '1'],
      description: 'Use 0 for the initial migration, then 1. Never run two app processes.',
    });
    const model = (id: string, defaultValue: string) =>
      new CfnParameter(this, id, {
        type: 'String',
        default: defaultValue,
        minLength: 1,
        allowedPattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$',
        description: 'Use the exact model ID from the passing G3 local validation evidence',
      }).valueAsString;
    const textModel = model('OpenAiTextModel', 'gpt-6-luna');
    const liveTranscribeModel = model('OpenAiLiveTranscribeModel', 'gpt-live-transcribe');
    const correctionModel = model('OpenAiCorrectionModel', 'gpt-transcribe');
    const imageModel = model('OpenAiImageModel', 'gpt-image-2.5-flare-2026-09-08');
    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc: foundation.vpc });
    this.task = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.task.addContainer('api', {
      image: ecs.ContainerImage.fromAsset(fileURLToPath(new URL('../../', import.meta.url)), {
        file: 'Dockerfile',
        platform: ecrAssets.Platform.LINUX_AMD64,
      }),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production',
        APP_ENV: 'aws',
        API_HOST: '0.0.0.0',
        PORT: '3000',
        AWS_REGION: this.region,
        DB_HOST: foundation.database.dbInstanceEndpointAddress,
        DB_PORT: foundation.database.dbInstanceEndpointPort,
        DB_NAME: 'devday_study',
        DB_SSL_MODE: 'verify-full',
        DB_SSL_CA_PATH: '/app/certs/global-bundle.pem',
        MEDIA_DRIVER: 's3',
        MEDIA_BUCKET: foundation.mediaBucket.bucketName,
        AI_MODE: 'live',
        SESSION_COOKIE_SECURE: 'true',
        OPENAI_TEXT_MODEL: textModel,
        OPENAI_LIVE_TRANSCRIBE_MODEL: liveTranscribeModel,
        OPENAI_CORRECTION_MODEL: correctionModel,
        OPENAI_IMAGE_MODEL: imageModel,
      },
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(foundation.database.secret!, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(foundation.database.secret!, 'password'),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(foundation.openAiSecret),
      },
    });
    // Object access only; DeleteObject cleans up an upload if metadata storage
    // fails. No bucket listing, bucket administration or embedded AWS keys.
    this.task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [foundation.mediaBucket.arnForObjects('*')],
      }),
    );
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: foundation.vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroup: foundation.albSecurityGroup,
      idleTimeout: Duration.seconds(120),
    });
    this.listener = this.alb.addListener('Http', { port: 80, open: false });
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition: this.task,
      desiredCount: desiredCount.valueAsNumber,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: false },
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [foundation.taskSecurityGroup],
      healthCheckGracePeriod: Duration.seconds(30),
    });
    const targets = new elbv2.ApplicationTargetGroup(this, 'ApiTargets', {
      vpc: foundation.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [this.service],
      healthCheck: { path: '/healthz', healthyHttpCodes: '200' },
      deregistrationDelay: Duration.seconds(30),
    });
    this.listener.addTargetGroups('Api', { targetGroups: [targets] });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'ClusterArn', { value: this.cluster.clusterArn });
    new CfnOutput(this, 'ServiceName', { value: this.service.serviceName });
    new CfnOutput(this, 'ServiceArn', { value: this.service.serviceArn });
    new CfnOutput(this, 'TaskDefinitionArn', { value: this.task.taskDefinitionArn });
    new CfnOutput(this, 'AlbArn', { value: this.alb.loadBalancerArn });
    new CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName });
  }
}

interface EdgeStackProps extends StackProps {
  foundation: StudyFoundationStack;
  api: StudyApiStack;
}

export class StudyEdgeStack extends Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { foundation, api } = props;
    // Imported in Edge so OAC does not put the Distribution ARN in Foundation.
    const webBucket = s3.Bucket.fromBucketAttributes(this, 'WebBucket', {
      bucketArn: foundation.webBucket.bucketArn,
      bucketName: foundation.webBucket.bucketName,
      bucketRegionalDomainName: foundation.webBucket.bucketRegionalDomainName,
    });
    const apiOrigin = origins.VpcOrigin.withApplicationLoadBalancer(api.alb, {
      httpPort: 80,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: Duration.seconds(120),
    });
    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(spaRewriteCode),
    });
    const staticCache = new cloudfront.CachePolicy(this, 'StaticCache', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.days(1),
      maxTtl: Duration.days(365),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
    });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
    };
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: staticCache,
        compress: true,
        functionAssociations: [
          { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: spaRewrite },
        ],
      },
      additionalBehaviors: { '/api/*': apiBehavior, '/ws/*': apiBehavior },
      // No distribution-wide error mapping: API 4xx must stay JSON.
    });
    Annotations.of(this.distribution).acknowledgeWarning(
      '@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac',
      'WebBucketPolicy in this Edge stack grants this distribution OAC access; template tests verify it. Keeping the policy in Edge prevents a reverse Foundation dependency.',
    );
    // The ALB must have its listener and be active before AWS creates its VPC
    // origin. CDK's origin is lazy-bound and its underlying field is protected.
    for (const construct of this.node.findAll()) {
      if (construct instanceof cloudfront.CfnVpcOrigin) construct.node.addDependency(api.listener);
    }
    new s3.CfnBucketPolicy(this, 'WebBucketPolicy', {
      bucket: webBucket.bucketName,
      policyDocument: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
            actions: ['s3:GetObject'],
            resources: [webBucket.arnForObjects('*')],
            conditions: { StringEquals: { 'AWS:SourceArn': this.distribution.distributionArn } },
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.DENY,
            principals: [new iam.AnyPrincipal()],
            actions: ['s3:*'],
            resources: [webBucket.bucketArn, webBucket.arnForObjects('*')],
            conditions: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ],
      }),
    });
    new CfnOutput(this, 'AppUrl', { value: `https://${this.distribution.distributionDomainName}` });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
    });
  }
}

export function createStudyStacks(app: App, props: StackProps = {}) {
  const foundation = new StudyFoundationStack(app, 'StudyFoundationStack', props);
  const api = new StudyApiStack(app, 'StudyApiStack', { ...props, foundation });
  const edge = new StudyEdgeStack(app, 'StudyEdgeStack', { ...props, foundation, api });
  return { foundation, api, edge };
}
