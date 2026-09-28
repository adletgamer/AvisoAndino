#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { AvisoAndinoStack } from '../lib/aviso-andino-stack.js';

const app = new App();
const stage = (app.node.tryGetContext('stage') as string) ?? 'dev';

const stack = new AvisoAndinoStack(app, `AvisoAndino-${stage}`, {
  stage,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  description: 'Aviso Andino: avisos oficiales SENAMHI -> SMS para colegios rurales (hackathon Zero to Shipped)',
});

Tags.of(stack).add('project', 'aviso-andino');
Tags.of(stack).add('stage', stage);
Tags.of(stack).add('hackathon', 'zero-to-shipped');
// TODO(prompt 06): Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
