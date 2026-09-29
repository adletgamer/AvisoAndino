import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AvisoAndinoStack } from '../lib/aviso-andino-stack.js';

function synthTemplate(smsInfra = false): Template {
  const app = new App({ context: { stage: 'dev', scheduleEnabled: false, smsInfra } });
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

  it('incluye colas con DLQ, Scheduler, CloudFront y Budget', () => {
    const template = synthTemplate();
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
          SMS_CONFIGURATION_SET: 'aviso-andino-dev',
          SSM_PREFIX: '/aviso-andino/dev',
          SUBSCRIBERS_TABLE: Match.anyValue(),
          DELIVERIES_TABLE: Match.anyValue(),
          STATS_TABLE: Match.anyValue(),
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
});
