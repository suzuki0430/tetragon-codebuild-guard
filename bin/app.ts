#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { TetragonCodeBuildGuardStack } from '../lib/tetragon-codebuild-guard-stack';

/**
 * Reads an optional string value from CDK context.
 *
 * @param app - CDK application whose context is inspected.
 * @param key - Context key to read.
 * @returns The non-empty string value, or `undefined` when it is not configured.
 */
function optionalContext(app: App, key: string): string | undefined {
  const value: unknown = app.node.tryGetContext(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const app = new App();
const githubOwner = optionalContext(app, 'githubOwner') ?? 'replace-me';
const githubRepo = optionalContext(app, 'githubRepo') ?? 'tetragon-codebuild-guard';
const githubConnectionArn = optionalContext(app, 'githubConnectionArn');

new TetragonCodeBuildGuardStack(app, 'TetragonCodeBuildGuardStack', {
  ...(githubConnectionArn === undefined ? {} : { githubConnectionArn }),
  githubOwner,
  githubRepo,
});
