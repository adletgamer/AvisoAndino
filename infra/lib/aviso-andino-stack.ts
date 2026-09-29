import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Arn,
  ArnFormat,
  CfnOutput,
  CustomResource,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as smsvoice from 'aws-cdk-lib/aws-smsvoice';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface AvisoAndinoStackProps extends StackProps {
  stage: string;
}

/**
 * Una sola stack con todo (ver prompts/01-infra-cdk.md y docs/ARCHITECTURE.md):
 *  - DynamoDB: Subscribers, Warnings, Deliveries, Stats (PAY_PER_REQUEST, TTL "ttl", GSIs de DATA_MODEL.md)
 *  - S3: snapshots (lifecycle 30d, salvo replay/), web (OAC)
 *  - SQS: match-queue, send-queue (+DLQ)
 *  - Lambda NodejsFunction (Runtime.NODEJS_24_X, Architecture.ARM_64): ingest, matcher, sender, api, sms-events
 *  - aws-scheduler Schedule rate(15 minutes) -> ingest
 *  - apigatewayv2 HttpApi (rutas docs/API.md, throttling)
 *  - CloudFront (S3 default + /api/* -> HttpApi) + BucketDeployment(apps/web/dist)
 *  - aws-smsvoice CfnConfigurationSet (+ event destination SNS) y CfnProtectConfiguration (solo PE)
 *  - SSM params de flags (SMS_ENABLED=false, REWRITE_ENABLED=false, SMS_DAILY_CAP=30, SMS_MAX_PRICE=0.30, allowlists)
 *  - Alarmas CloudWatch -> SNS email, CfnBudget USD 10
 * IAM mínimo privilegio con grant*. Sin Action "*".
 */
export class AvisoAndinoStack extends Stack {
  constructor(scope: Construct, id: string, props: AvisoAndinoStackProps) {
    super(scope, id, props);

    const isDev = props.stage === 'dev';
    const scheduleEnabledContext = this.node.tryGetContext('scheduleEnabled');
    const scheduleEnabled = scheduleEnabledContext === true || scheduleEnabledContext === 'true';
    const removalPolicy = isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const lockFile = path.join(root, 'pnpm-lock.yaml');
    const rolePrefix = `zts-aviso-andino-${props.stage}`;

    const subscribers = new dynamodb.Table(this, 'Subscribers', {
      tableName: `AvisoAndino-${props.stage}-Subscribers`,
      partitionKey: { name: 'subscriberId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy,
    });
    subscribers.addGlobalSecondaryIndex({
      indexName: 'byPhoneHash',
      partitionKey: { name: 'phoneHash', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });
    subscribers.addGlobalSecondaryIndex({
      indexName: 'byTelegramChat',
      partitionKey: { name: 'telegramChatId', type: dynamodb.AttributeType.STRING },
    });
    subscribers.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    const warnings = new dynamodb.Table(this, 'Warnings', {
      tableName: `AvisoAndino-${props.stage}-Warnings`,
      partitionKey: { name: 'warningId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy,
    });
    warnings.addGlobalSecondaryIndex({
      indexName: 'byActive',
      partitionKey: { name: 'activeFlag', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'fechFin', type: dynamodb.AttributeType.STRING },
    });
    warnings.addGlobalSecondaryIndex({
      indexName: 'byAviso',
      partitionKey: { name: 'avisoKey', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'mapa', type: dynamodb.AttributeType.NUMBER },
    });

    const deliveries = new dynamodb.Table(this, 'Deliveries', {
      tableName: `AvisoAndino-${props.stage}-Deliveries`,
      partitionKey: { name: 'deliveryId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy,
    });
    for (const [indexName, partitionKey, sortKey] of [
      ['byConfirmCode', 'confirmCode', undefined],
      ['bySubscriber', 'subscriberId', 'createdAt'],
      ['byWarning', 'avisoKey', 'createdAt'],
      ['byRun', 'runId', 'createdAt'],
    ] as const) {
      deliveries.addGlobalSecondaryIndex({
        indexName,
        partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING },
        ...(sortKey ? { sortKey: { name: sortKey, type: dynamodb.AttributeType.STRING } } : {}),
      });
    }

    const stats = new dynamodb.Table(this, 'Stats', {
      tableName: `AvisoAndino-${props.stage}-Stats`,
      partitionKey: { name: 'statsPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'statsSk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy,
    });

    const snapshotsBucket = new s3.Bucket(this, 'SnapshotsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
      lifecycleRules: [{ id: 'expire-live-snapshots', prefix: 'snapshots/', expiration: Duration.days(30) }],
    });
    const webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
    });

    if (isDev) {
      const bucketCleaner = this.nodeFunction(
        'BucketCleaner',
        'bucket-cleaner',
        128,
        60,
        { STAGE: props.stage },
        root,
        lockFile,
      );
      bucketCleaner.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [snapshotsBucket.bucketArn, webBucket.bucketArn],
      }));
      bucketCleaner.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
        resources: [snapshotsBucket.arnForObjects('*'), webBucket.arnForObjects('*')],
      }));
      bucketCleaner.addPermission('CloudFormationInvoke', {
        principal: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
        sourceAccount: this.account,
      });
      for (const [bucket, cleanId] of [
        [snapshotsBucket, 'CleanSnapshotsOnDelete'],
        [webBucket, 'CleanWebOnDelete'],
      ] as const) {
        new CustomResource(this, cleanId, {
          resourceType: 'Custom::ZtsEmptyBucket',
          serviceToken: bucketCleaner.functionArn,
          properties: { BucketName: bucket.bucketName },
        });
      }
    }

    const matchDlq = this.queue('MatchDlq', `${rolePrefix}-match-dlq`, Duration.seconds(30));
    const sendDlq = this.queue('SendDlq', `${rolePrefix}-send-dlq`, Duration.seconds(30));
    const matchQueue = this.queue('MatchQueue', `${rolePrefix}-match`, Duration.minutes(6), {
      queue: matchDlq,
      maxReceiveCount: 3,
    });
    const sendQueue = this.queue('SendQueue', `${rolePrefix}-send`, Duration.minutes(3), {
      queue: sendDlq,
      maxReceiveCount: 3,
    });

    const configurationSetName = `aviso-andino-${props.stage}`;
    const protectConfiguration = new smsvoice.CfnProtectConfiguration(this, 'SmsProtectConfiguration', {
      countryRuleSet: { sms: [{ countryCode: 'PE', protectStatus: 'ALLOW' }] },
      deletionProtectionEnabled: !isDev,
    });
    const smsEventsTopic = new sns.Topic(this, 'SmsEventsTopic', {
      topicName: `${rolePrefix}-sms-events`,
    });
    const configurationSet = new smsvoice.CfnConfigurationSet(this, 'SmsConfigurationSet', {
      configurationSetName,
      protectConfigurationId: protectConfiguration.attrProtectConfigurationId,
      eventDestinations: [{
        enabled: true,
        eventDestinationName: 'delivery-events',
        matchingEventTypes: [
          'TEXT_SUCCESSFUL',
          'TEXT_DELIVERED',
          'TEXT_FAILED',
          'TEXT_BLOCKED',
          'TEXT_INVALID',
          'TEXT_UNKNOWN',
        ],
        snsDestination: { topicArn: smsEventsTopic.topicArn },
      }],
    });

    const sharedEnvironment = {
      STAGE: props.stage,
      SUBSCRIBERS_TABLE: subscribers.tableName,
      WARNINGS_TABLE: warnings.tableName,
      DELIVERIES_TABLE: deliveries.tableName,
      STATS_TABLE: stats.tableName,
      SNAPSHOTS_BUCKET: snapshotsBucket.bucketName,
      MATCH_QUEUE_URL: matchQueue.queueUrl,
      SEND_QUEUE_URL: sendQueue.queueUrl,
      CONFIGURATION_SET_NAME: configurationSetName,
      SMS_ENABLED: 'false',
      REWRITE_ENABLED: 'false',
      INGEST_ENABLED: 'false',
    };

    const ingest = this.nodeFunction('Ingest', 'ingest', 512, 60, sharedEnvironment, root, lockFile);
    const matcher = this.nodeFunction('Matcher', 'matcher', 512, 60, sharedEnvironment, root, lockFile);
    const sender = this.nodeFunction('Sender', 'sender', 256, 30, sharedEnvironment, root, lockFile, 2);
    const api = this.nodeFunction('Api', 'api', 256, 10, sharedEnvironment, root, lockFile);
    const smsEvents = this.nodeFunction('SmsEvents', 'sms-events', 256, 10, sharedEnvironment, root, lockFile);

    warnings.grantReadWriteData(ingest);
    snapshotsBucket.grantPut(ingest, 'snapshots/*');
    matchQueue.grantSendMessages(ingest);
    subscribers.grantReadData(matcher);
    warnings.grantReadData(matcher);
    deliveries.grantReadWriteData(matcher);
    stats.grantReadWriteData(matcher);
    snapshotsBucket.grantRead(matcher);
    sendQueue.grantSendMessages(matcher);
    deliveries.grantReadWriteData(sender);
    stats.grantReadWriteData(sender);
    warnings.grantReadData(api);
    deliveries.grantReadData(api);
    stats.grantReadData(api);
    snapshotsBucket.grantRead(api);
    deliveries.grantReadWriteData(smsEvents);
    stats.grantReadWriteData(smsEvents);

    sender.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sms-voice:SendTextMessage'],
      resources: [configurationSet.attrArn],
    }));
    sender.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        Arn.format({
          service: 'bedrock',
          resource: 'inference-profile',
          resourceName: 'us.amazon.nova-micro-v1:0',
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
        }, this),
        'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0',
        'arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0',
        'arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0',
      ],
    }));
    sender.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [this.formatArn({
        service: 'ssm',
        resource: 'parameter',
        resourceName: `aviso-andino/${props.stage}/*`,
      })],
    }));

    matcher.addEventSource(new sources.SqsEventSource(matchQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    sender.addEventSource(new sources.SqsEventSource(sendQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    smsEventsTopic.addSubscription(new subscriptions.LambdaSubscription(smsEvents));

    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      roleName: `${rolePrefix}-scheduler`,
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    new scheduler.Schedule(this, 'IngestSchedule', {
      scheduleName: `${rolePrefix}-ingest`,
      description: 'Revisa avisos oficiales cada 15 minutos; la ingesta inicia desactivada.',
      schedule: scheduler.ScheduleExpression.rate(Duration.minutes(15)),
      target: new schedulerTargets.LambdaInvoke(ingest, { role: schedulerRole }),
      enabled: scheduleEnabled,
    });

    const apiIntegration = new HttpLambdaIntegration('ApiIntegration', api);
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${rolePrefix}-api`,
      createDefaultStage: true,
    });
    const routes: Array<[apigwv2.HttpMethod, string]> = [
      [apigwv2.HttpMethod.GET, '/api/status'],
      [apigwv2.HttpMethod.GET, '/api/alerts'],
      [apigwv2.HttpMethod.GET, '/api/alerts/{warningId}/geometry'],
      [apigwv2.HttpMethod.GET, '/api/metrics'],
      [apigwv2.HttpMethod.GET, '/api/confirm/{code}'],
      [apigwv2.HttpMethod.GET, '/api/replay/{runId}/deliveries'],
      [apigwv2.HttpMethod.POST, '/api/subscribers'],
      [apigwv2.HttpMethod.POST, '/api/confirm'],
      [apigwv2.HttpMethod.POST, '/api/replay'],
      [apigwv2.HttpMethod.POST, '/api/telegram/webhook'],
      [apigwv2.HttpMethod.DELETE, '/api/subscribers/{subscriberId}'],
    ];
    for (const [method, routePath] of routes) {
      httpApi.addRoutes({ path: routePath, methods: [method], integration: apiIntegration });
    }
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = { throttlingBurstLimit: 10, throttlingRateLimit: 5 };
      defaultStage.routeSettings = {
        'POST /api/replay': { throttlingBurstLimit: 2, throttlingRateLimit: 1 },
      };
    }

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${rolePrefix}-security`,
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
      },
    });
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      comment: `Aviso Andino ${props.stage}`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(Fn.select(2, Fn.split('/', httpApi.apiEndpoint))),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: securityHeaders,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    const webDist = path.join(root, 'apps/web/dist');
    const deploymentRole = new iam.Role(this, 'WebDeploymentRole', {
      roleName: `${rolePrefix}-web-deploy`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      sources: existsSync(webDist)
        ? [s3deploy.Source.asset(webDist)]
        : [s3deploy.Source.data('index.html', this.placeholderHtml())],
      destinationBucket: webBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: !isDev,
      role: deploymentRole,
    });

    const parameters: Record<string, string> = {
      SMS_ENABLED: 'false',
      REWRITE_ENABLED: 'false',
      SMS_DAILY_CAP: '30',
      SMS_MAX_PRICE: '0.30',
      'replay/allowlist': '["2026-230","2025-200","2026-388","2026-383"]',
      'sms/allowlist': '[]',
    };
    for (const [name, stringValue] of Object.entries(parameters)) {
      new ssm.StringParameter(this, `Parameter${name.replace(/[^A-Za-z0-9]/g, '')}`, {
        parameterName: `/aviso-andino/${props.stage}/${name}`,
        stringValue,
      });
    }

    for (const fn of [ingest, matcher, sender, api, smsEvents]) {
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorsAlarm`, {
        alarmName: `${rolePrefix}-${fn.node.id.toLowerCase()}-errors`,
        metric: fn.metricErrors({ period: Duration.minutes(5) }),
        evaluationPeriods: 1,
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });
    }
    for (const [queue, name] of [[matchDlq, 'match'], [sendDlq, 'send']] as const) {
      new cloudwatch.Alarm(this, `${name}DlqAlarm`, {
        alarmName: `${rolePrefix}-${name}-dlq-visible`,
        metric: queue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
        evaluationPeriods: 1,
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });
    }
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${rolePrefix}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 10, unit: 'USD' },
      },
    });

    new CfnOutput(this, 'Stage', { value: props.stage });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'SubscribersTableName', { value: subscribers.tableName });
    new CfnOutput(this, 'WarningsTableName', { value: warnings.tableName });
    new CfnOutput(this, 'DeliveriesTableName', { value: deliveries.tableName });
    new CfnOutput(this, 'StatsTableName', { value: stats.tableName });
    new CfnOutput(this, 'MatchQueueName', { value: matchQueue.queueName });
    new CfnOutput(this, 'SendQueueName', { value: sendQueue.queueName });
    new CfnOutput(this, 'ConfigurationSetName', { value: configurationSetName });
  }

  private queue(
    id: string,
    queueName: string,
    visibilityTimeout: Duration,
    deadLetterQueue?: sqs.DeadLetterQueue,
  ): sqs.Queue {
    return new sqs.Queue(this, id, {
      queueName,
      visibilityTimeout,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue,
      removalPolicy: this.node.tryGetContext('stage') === 'prod'
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
    });
  }

  private nodeFunction(
    id: string,
    service: string,
    memorySize: number,
    timeoutSeconds: number,
    environment: Record<string, string>,
    root: string,
    lockFile: string,
    reservedConcurrentExecutions?: number,
  ): NodejsFunction {
    const role = new iam.Role(this, `${id}Role`, {
      roleName: `zts-aviso-andino-${this.node.tryGetContext('stage') ?? 'dev'}-${service}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
      logGroupName: `/aws/lambda/zts-aviso-andino-${this.node.tryGetContext('stage') ?? 'dev'}-${service}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    return new NodejsFunction(this, id, {
      functionName: `zts-aviso-andino-${this.node.tryGetContext('stage') ?? 'dev'}-${service}`,
      entry: path.join(root, `services/${service}/src/handler.ts`),
      depsLockFilePath: lockFile,
      projectRoot: root,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize,
      timeout: Duration.seconds(timeoutSeconds),
      reservedConcurrentExecutions,
      role,
      logGroup,
      environment,
      bundling: {
        format: OutputFormat.ESM,
        target: 'node24',
        sourceMap: true,
        banner: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
      },
    });
  }

  private placeholderHtml(): string {
    return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Aviso Andino</title><main style="font:18px system-ui;max-width:720px;margin:12vh auto;padding:24px">
<h1>Aviso Andino</h1><p>Avisos oficiales de SENAMHI en mensajes claros para colegios rurales del Peru.</p>
<p><strong>Infraestructura lista.</strong> La ingesta y el envio real empiezan desactivados.</p>
<p>Solo avisos oficiales. La IA no decide.</p></main></html>`;
  }
}
