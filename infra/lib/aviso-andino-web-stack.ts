import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CfnOutput, CustomResource, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { spaRewriteAssociation } from './spa-rewrite.js';

export interface AvisoAndinoWebStackProps extends StackProps {
  stage: string;
  /**
   * Dominio del HttpApi (p. ej. `abc123.execute-api.us-east-1.amazonaws.com`), sin esquema ni ruta.
   * Si se define, esta MISMA distribución enruta `/api/*` al API, así la URL pública no cambia.
   */
  apiOriginDomain?: string;
}

/**
 * Stack mínima e independiente para publicar el frontend (`cdk deploy AvisoAndino-web-<stage>`):
 * S3 privado + OAC + CloudFront + BucketDeployment(apps/web/dist). Roles con nombre zts-*.
 * En dev: RemovalPolicy.DESTROY y vaciado del bucket al borrar (Custom::ZtsEmptyBucket).
 */
export class AvisoAndinoWebStack extends Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: AvisoAndinoWebStackProps) {
    super(scope, id, props);

    const isDev = props.stage === 'dev';
    const removalPolicy = isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const prefix = `zts-aviso-andino-${props.stage}-web`;

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy,
    });

    if (isDev) {
      const cleanerRole = new iam.Role(this, 'BucketCleanerRole', {
        roleName: `${prefix}-bucket-cleaner`,
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
      cleanerRole.addToPolicy(new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [bucket.bucketArn],
      }));
      cleanerRole.addToPolicy(new iam.PolicyStatement({
        actions: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
        resources: [bucket.arnForObjects('*')],
      }));
      const cleaner = new NodejsFunction(this, 'BucketCleaner', {
        functionName: `${prefix}-bucket-cleaner`,
        entry: path.join(root, 'services/bucket-cleaner/src/handler.ts'),
        depsLockFilePath: path.join(root, 'pnpm-lock.yaml'),
        projectRoot: root,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 128,
        timeout: Duration.seconds(60),
        role: cleanerRole,
        logGroup: new logs.LogGroup(this, 'BucketCleanerLogGroup', {
          logGroupName: `/aws/lambda/${prefix}-bucket-cleaner`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        environment: { STAGE: props.stage },
        bundling: {
          format: OutputFormat.ESM,
          target: 'node24',
          sourceMap: true,
          banner: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
        },
      });
      cleaner.addPermission('CloudFormationInvoke', {
        principal: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
        sourceAccount: this.account,
      });
      new CustomResource(this, 'CleanSiteOnDelete', {
        resourceType: 'Custom::ZtsEmptyBucket',
        serviceToken: cleaner.functionArn,
        properties: { BucketName: bucket.bucketName },
      });
    }

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${prefix}-security`,
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

    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
    if (props.apiOriginDomain) {
      additionalBehaviors['/api/*'] = {
        origin: new origins.HttpOrigin(props.apiOriginDomain),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
      };
    }

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: `Aviso Andino web ${props.stage}`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [spaRewriteAssociation(this, 'SpaRewrite')],
      },
      additionalBehaviors,
    });

    const deploymentRole = new iam.Role(this, 'SiteDeploymentRole', {
      roleName: `${prefix}-deploy`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    const webDist = path.join(root, 'apps/web/dist');
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: existsSync(webDist)
        ? [s3deploy.Source.asset(webDist)]
        : [s3deploy.Source.data('index.html', '<!doctype html><title>Aviso Andino</title><h1>Aviso Andino</h1>')],
      destinationBucket: bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: !isDev,
      role: deploymentRole,
    });

    new CfnOutput(this, 'Stage', { value: props.stage });
    new CfnOutput(this, 'WebUrl', { value: `https://${this.distribution.distributionDomainName}` });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'SiteBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'ApiRouted', { value: props.apiOriginDomain ? 'true' : 'false' });
  }
}
