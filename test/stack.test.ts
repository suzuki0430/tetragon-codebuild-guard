import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import {
  CODEBUILD_PROJECT_NAME,
  GITHUB_WORKFLOW_NAME,
  TetragonCodeBuildGuardStack,
} from '../lib/tetragon-codebuild-guard-stack';

/**
 * Synthesizes the stack under test with deterministic GitHub source values.
 *
 * @param connectionArn - Optional CodeConnections ARN to exercise GitHub App auth.
 * @returns CloudFormation assertion template.
 */
function synthesizeTemplate(connectionArn?: string): Template {
  const app = new App();
  const stack = new TetragonCodeBuildGuardStack(app, 'TestStack', {
    ...(connectionArn === undefined ? {} : { githubConnectionArn: connectionArn }),
    githubOwner: 'example-owner',
    githubRepo: 'example-repo',
  });
  return Template.fromStack(stack);
}

describe('TetragonCodeBuildGuardStack', () => {
  it('creates a privileged runner for queued jobs from the demo workflow', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: CODEBUILD_PROJECT_NAME,
      Environment: Match.objectLike({
        ComputeType: 'BUILD_GENERAL1_MEDIUM',
        Image: 'aws/codebuild/amazonlinux-x86_64-standard:5.0',
        PrivilegedMode: true,
        Type: 'LINUX_CONTAINER',
      }),
      Source: Match.objectLike({
        Location: 'https://github.com/example-owner/example-repo.git',
        Type: 'GITHUB',
      }),
      Triggers: {
        FilterGroups: [
          [
            { Pattern: 'WORKFLOW_JOB_QUEUED', Type: 'EVENT' },
            { Pattern: GITHUB_WORKFLOW_NAME, Type: 'WORKFLOW_NAME' },
          ],
        ],
        Webhook: true,
      },
    });
  });

  it('embeds non-blocking Tetragon startup and teardown commands', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: Match.objectLike({
        BuildSpec: Match.stringLikeRegexp('Tetragon is ready'),
      }),
    });
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: Match.objectLike({
        BuildSpec: Match.stringLikeRegexp('docker rm -f tetragon'),
      }),
    });
  });

  it('uses a CodeConnections ARN and grants only connection token access', () => {
    const connectionArn =
      'arn:aws:codeconnections:ap-northeast-1:111122223333:connection/example';
    const template = synthesizeTemplate(connectionArn);

    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Source: Match.objectLike({
        Auth: {
          Resource: connectionArn,
          Type: 'CODECONNECTIONS',
        },
      }),
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: [
                  'codeconnections:GetConnection',
                  'codeconnections:GetConnectionToken',
                ],
                Effect: 'Allow',
                Resource: connectionArn,
              }),
            ]),
          },
        }),
      ]),
    });
  });

  it('emits the stable kebab-case project name', () => {
    expect(CODEBUILD_PROJECT_NAME).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
