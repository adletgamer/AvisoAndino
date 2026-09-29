#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { AvisoAndinoStack } from '../lib/aviso-andino-stack.js';
import { AvisoAndinoWebStack } from '../lib/aviso-andino-web-stack.js';

const app = new App();
const stage = (app.node.tryGetContext('stage') as string) ?? 'dev';

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' };
const tag = (stack: AvisoAndinoStack | AvisoAndinoWebStack) => {
  Tags.of(stack).add('project', 'aviso-andino');
  Tags.of(stack).add('stage', stage);
  Tags.of(stack).add('hackathon', 'zero-to-shipped');
};

// `-c webOnly=true` sintetiza solo la stack web independiente (S3 + OAC + CloudFront).
// `-c apiOriginDomain=<id>.execute-api.us-east-1.amazonaws.com` añade /api/* a esa misma distribución.
const webOnlyContext = app.node.tryGetContext('webOnly');
const webOnly = webOnlyContext === true || webOnlyContext === 'true';

if (webOnly) {
  tag(new AvisoAndinoWebStack(app, `AvisoAndino-web-${stage}`, {
    stage,
    env,
    apiOriginDomain: (app.node.tryGetContext('apiOriginDomain') as string | undefined) || undefined,
    description: 'Aviso Andino: frontend estático (S3 privado + OAC + CloudFront)',
  }));
} else {
  tag(new AvisoAndinoStack(app, `AvisoAndino-${stage}`, {
    stage,
    env,
    description: 'Aviso Andino: avisos oficiales SENAMHI -> SMS para colegios rurales (hackathon Zero to Shipped)',
  }));
}
// TODO(prompt 06): Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
