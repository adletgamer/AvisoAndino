import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AvisoAndinoWebStack } from '../lib/aviso-andino-web-stack.js';

function synthWeb(apiOriginDomain?: string): Template {
  const app = new App({ context: { stage: 'dev' } });
  const stack = new AvisoAndinoWebStack(app, 'AvisoAndino-web-dev', {
    stage: 'dev',
    env: { region: 'us-east-1' },
    apiOriginDomain,
  });
  return Template.fromStack(stack);
}

describe('AvisoAndinoWebStack', () => {
  it('publica un bucket privado detrás de CloudFront con OAC', () => {
    const template = synthWeb();
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ DefaultRootObject: 'index.html' }),
    });
  });

  it('no crea Lambdas de aplicación ni recursos SMS', () => {
    const template = synthWeb();
    expect(Object.keys(template.findResources('AWS::SMSVOICE::ConfigurationSet'))).toHaveLength(0);
    expect(Object.keys(template.findResources('AWS::DynamoDB::Table'))).toHaveLength(0);
    expect(Object.keys(template.findResources('AWS::Scheduler::Schedule'))).toHaveLength(0);
  });

  it('sin apiOriginDomain no enruta /api/*; con él, la misma distribución lo añade', () => {
    const noApi = synthWeb().findResources('AWS::CloudFront::Distribution');
    const cfgNoApi = Object.values(noApi)[0] as { Properties: { DistributionConfig: { CacheBehaviors?: unknown[] } } };
    expect(cfgNoApi.Properties.DistributionConfig.CacheBehaviors ?? []).toHaveLength(0);

    synthWeb('abc123.execute-api.us-east-1.amazonaws.com').hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [Match.objectLike({ PathPattern: '/api/*' })],
        Origins: Match.arrayWith([
          Match.objectLike({ DomainName: 'abc123.execute-api.us-east-1.amazonaws.com' }),
        ]),
      }),
    });
  });

  it('nombra todos los roles zts-* y no concede Action wildcard', () => {
    const template = synthWeb();
    for (const role of Object.values(template.findResources('AWS::IAM::Role'))) {
      expect((role as { Properties: { RoleName?: string } }).Properties.RoleName).toMatch(/^zts-aviso-andino-dev-web-/);
    }
    for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
      const statements = (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action?: unknown }> } } })
        .Properties.PolicyDocument.Statement;
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        expect(actions).not.toContain('*');
      }
    }
  });
});
