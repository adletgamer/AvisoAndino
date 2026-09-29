import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AvisoAndinoStack } from '../lib/aviso-andino-stack.js';

function synthTemplate(): Template {
  const app = new App({ context: { stage: 'dev', scheduleEnabled: false } });
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
    const template = synthTemplate();
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
