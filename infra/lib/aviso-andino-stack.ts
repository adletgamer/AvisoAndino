import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
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
    // TODO(prompt 01): implementar recursos.
    new CfnOutput(this, 'Stage', { value: props.stage });
  }
}
