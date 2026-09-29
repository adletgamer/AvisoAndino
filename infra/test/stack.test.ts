import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AvisoAndinoStack } from '../lib/aviso-andino-stack.js';

function synthTemplate(smsInfra = false, extraContext: Record<string, unknown> = {}): Template {
  const app = new App({ context: { stage: 'dev', scheduleEnabled: false, smsInfra, ...extraContext } });
  const stack = new AvisoAndinoStack(app, 'AvisoAndino-dev', {
    stage: 'dev',
    env: { region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

describe('AvisoAndinoStack', () => {
  it('crea cuatro tablas on-demand con TTL', () => {
    const template = synthTemplate();
    template.resourceCountIs('AWS::DynamoDB::Table', 4);
    template.allResourcesProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('crea las cinco Lambdas de aplicación en Node 24 arm64', () => {
    const template = synthTemplate(true);
    const applicationNames = new Set(['ingest', 'matcher', 'sender', 'api', 'sms-events']);
    const functions = Object.values(template.findResources('AWS::Lambda::Function'))
      .map((resource) => resource.Properties as Record<string, unknown>)
      .filter((properties) => applicationNames.has(
        String(properties.FunctionName ?? '').replace('zts-aviso-andino-dev-', ''),
      ));

    expect(functions).toHaveLength(5);
    for (const properties of functions) {
      expect(properties.Runtime).toBe('nodejs24.x');
      expect(properties.Architectures).toEqual(['arm64']);
    }
  });

  it('omite toda la infraestructura SMS por defecto', () => {
    const template = synthTemplate();
    template.resourceCountIs('AWS::SMSVOICE::ConfigurationSet', 0);
    template.resourceCountIs('AWS::SMSVOICE::ProtectConfiguration', 0);
    template.resourceCountIs('AWS::SNS::Topic', 0);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-sender',
      Environment: {
        Variables: Match.objectLike({
          CONFIGURATION_SET_NAME: '',
          SMS_ENABLED: 'false',
        }),
      },
    });
    expect(JSON.stringify(template.findResources('AWS::Lambda::Function'))).not.toContain('sms-events');
    expect(JSON.stringify(template.findResources('AWS::Logs::LogGroup'))).not.toContain('sms-events');
    expect(JSON.stringify(template.findResources('AWS::IAM::Role'))).not.toContain('sms-events');
  });

  it('crea un event destination SMS válido al habilitar smsInfra', () => {
    const template = synthTemplate(true);
    template.resourceCountIs('AWS::SMSVOICE::ProtectConfiguration', 1);
    template.hasResourceProperties('AWS::SMSVOICE::ConfigurationSet', {
      ConfigurationSetName: 'aviso-andino-dev',
      EventDestinations: [{
        Enabled: true,
        EventDestinationName: 'delivery-events',
        MatchingEventTypes: ['TEXT_ALL'],
        SnsDestination: { TopicArn: Match.anyValue() },
      }],
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-sms-events',
    });
    template.hasOutput('ConfigurationSetName', { Value: 'aviso-andino-dev' });
  });

  it('por defecto no crea CloudFront propio (una sola URL vía AvisoAndino-web)', () => {
    const template = synthTemplate();
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.resourceCountIs('Custom::CDKBucketDeployment', 0);
  });

  it('incluye colas con DLQ, Scheduler, CloudFront (webDist=true) y Budget', () => {
    const template = synthTemplate(false, { webDist: true });
    template.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'zts-aviso-andino-dev-match-dlq' });
    template.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'zts-aviso-andino-dev-send-dlq' });
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('AWS::Budgets::Budget', 1);
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', Match.objectLike({
      OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 's3' }),
    }));
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      State: 'DISABLED',
    });
  });

  it('cablea handlers con flags seguros y variables requeridas', () => {
    const template = synthTemplate();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-ingest',
      Environment: {
        Variables: Match.objectLike({
          INGEST_ENABLED: 'false',
          WARNINGS_TABLE: Match.anyValue(),
          DELIVERIES_TABLE: Match.anyValue(),
          SNAPSHOTS_BUCKET: Match.anyValue(),
          MATCH_QUEUE_URL: Match.anyValue(),
          SEND_QUEUE_URL: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-matcher',
      Environment: {
        Variables: Match.objectLike({
          PUBLIC_BASE_URL: Match.anyValue(),
          SUBSCRIBERS_TABLE: Match.anyValue(),
          WARNINGS_TABLE: Match.anyValue(),
          DELIVERIES_TABLE: Match.anyValue(),
          STATS_TABLE: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-sender',
      Environment: {
        Variables: Match.objectLike({
          SMS_ENABLED: 'false',
          SMS_CONFIGURATION_SET: '',
          SSM_PREFIX: '/aviso-andino/dev',
          SUBSCRIBERS_TABLE: Match.anyValue(),
          DELIVERIES_TABLE: Match.anyValue(),
          STATS_TABLE: Match.anyValue(),
        }),
      },
    });
    synthTemplate(true).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-sender',
      Environment: {
        Variables: Match.objectLike({
          SMS_ENABLED: 'false',
          SMS_CONFIGURATION_SET: 'aviso-andino-dev',
        }),
      },
    });
  });

  it('sintetiza el throttling por ruta con claves CloudFormation PascalCase', () => {
    const template = synthTemplate();
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: {
        ThrottlingBurstLimit: 10,
        ThrottlingRateLimit: 5,
      },
      RouteSettings: {
        'POST /api/replay': {
          ThrottlingBurstLimit: 2,
          ThrottlingRateLimit: 1,
        },
      },
    });
  });

  it('crea el Stage por defecto después de la ruta POST /api/replay', () => {
    const template = synthTemplate();
    const routes = template.findResources('AWS::ApiGatewayV2::Route', {
      Properties: { RouteKey: 'POST /api/replay' },
    });
    const replayRouteIds = Object.keys(routes);
    expect(replayRouteIds).toHaveLength(1);
    const stageList = Object.values(template.findResources('AWS::ApiGatewayV2::Stage'));
    expect(stageList).toHaveLength(1);
    const dependsOn = (stageList[0] as { DependsOn?: string[] }).DependsOn ?? [];
    expect(dependsOn).toContain(replayRouteIds[0]);
  });

  it('no reserva concurrencia Lambda por defecto (cuentas con límite 10)', () => {
    const template = synthTemplate(true);
    for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
      expect((fn as { Properties: Record<string, unknown> }).Properties.ReservedConcurrentExecutions).toBeUndefined();
    }
    synthTemplate(false, { senderReservedConcurrency: '2' }).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-sender',
      ReservedConcurrentExecutions: 2,
    });
  });

  it('sin webDist omite bucket web y CloudFront, y usa publicBaseUrl', () => {
    const template = synthTemplate(false, { publicBaseUrl: 'https://example.cloudfront.net' });
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.resourceCountIs('Custom::CDKBucketDeployment', 0);
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasOutput('ApiDomain', {});
    expect(Object.keys(template.findOutputs('WebUrl'))).toHaveLength(0);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'zts-aviso-andino-dev-matcher',
      Environment: { Variables: Match.objectLike({ PUBLIC_BASE_URL: 'https://example.cloudfront.net' }) },
    });
  });

  it('no concede Action wildcard y nombra todos los roles zts-*', () => {
    const template = synthTemplate();
    const roles = Object.values(template.findResources('AWS::IAM::Role'));
    for (const role of roles) {
      expect(String(role.Properties.RoleName)).toMatch(/^zts-/);
    }

    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    for (const policy of policies) {
      const statements = (policy.Properties.PolicyDocument as { Statement: Array<{ Action?: unknown }> }).Statement;
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        expect(actions).not.toContain('*');
      }
    }
  });
  it('el sender solo tiene SendTextMessage (ruta compartida, Resource *) y ninguna otra acción SMS', () => {
    const policies = Object.values(synthTemplate(true).findResources('AWS::IAM::Policy')) as Array<{
      Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> } };
    }>;
    const statements = policies
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
      .filter((entry) => JSON.stringify(entry.Action).includes('sms-voice:'));
    expect(statements).toEqual([expect.objectContaining({ Action: 'sms-voice:SendTextMessage', Resource: '*' })]);
  });
});
