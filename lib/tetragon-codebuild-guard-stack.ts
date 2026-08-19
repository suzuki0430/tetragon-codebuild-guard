import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  Tags,
  aws_codebuild as codebuild,
  aws_iam as iam,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import {
  TETRAGON_ARTIFACT_DIR,
  createCodeBuildRunnerBuildSpec,
} from './codebuild-runner-buildspec';

/** Stable kebab-case name used by both CodeBuild and the GitHub runner label. */
export const CODEBUILD_PROJECT_NAME = 'tetragon-codebuild-guard';

/** GitHub workflow name accepted by the CodeBuild webhook. */
export const GITHUB_WORKFLOW_NAME = 'Tetragon CodeBuild Guard';

/** Configuration required to connect the runner project to one GitHub repository. */
export interface TetragonCodeBuildGuardStackProps extends StackProps {
  /** GitHub account or organization that owns the target repository. */
  readonly githubOwner: string;

  /** GitHub repository whose workflow jobs are handled by CodeBuild. */
  readonly githubRepo: string;

  /**
   * Optional AWS CodeConnections ARN for GitHub App authentication.
   *
   * When omitted, CodeBuild uses GitHub credentials already configured for the
   * AWS account and region.
   */
  readonly githubConnectionArn?: string;
}

/**
 * Provisions an ephemeral CodeBuild-hosted GitHub Actions runner with Tetragon.
 *
 * The project subscribes only to queued jobs from the demo workflow. CodeBuild
 * launches Tetragon during `PRE_BUILD`, runs the GitHub job during `BUILD`, and
 * stops Tetragon during `POST_BUILD`. The project role has no application-level
 * AWS permissions; it can only write its log stream and, when configured, obtain
 * a token from the supplied CodeConnections connection.
 *
 * @example
 * ```ts
 * new TetragonCodeBuildGuardStack(app, 'GuardStack', {
 *   githubOwner: 'octocat',
 *   githubRepo: 'tetragon-codebuild-guard',
 * });
 * ```
 */
export class TetragonCodeBuildGuardStack extends Stack {
  /** The CodeBuild runner project created by this stack. */
  public readonly runnerProject: codebuild.Project;

  /**
   * Creates the AWS resources for the Tetragon CI guard demonstration.
   *
   * @param scope - CDK construct scope.
   * @param id - Logical construct identifier.
   * @param props - GitHub source and optional authentication configuration.
   */
  public constructor(
    scope: Construct,
    id: string,
    props: TetragonCodeBuildGuardStackProps,
  ) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'RunnerLogGroup', {
      logGroupName: `/aws/codebuild/${CODEBUILD_PROJECT_NAME}`,
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const runnerRole = new iam.Role(this, 'RunnerRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'Least-privilege service role for the Tetragon CodeBuild runner.',
      ...(props.githubConnectionArn === undefined
        ? {}
        : {
            inlinePolicies: {
              CodeConnectionsAccess: new iam.PolicyDocument({
                statements: [
                  new iam.PolicyStatement({
                    actions: [
                      'codeconnections:GetConnection',
                      'codeconnections:GetConnectionToken',
                    ],
                    resources: [props.githubConnectionArn],
                  }),
                ],
              }),
            },
          }),
    });

    const source = codebuild.Source.gitHub({
      owner: props.githubOwner,
      repo: props.githubRepo,
      reportBuildStatus: false,
      webhook: true,
      webhookFilters: [
        codebuild.FilterGroup.inEventOf(codebuild.EventAction.WORKFLOW_JOB_QUEUED),
      ],
    });

    this.runnerProject = new codebuild.Project(this, 'RunnerProject', {
      projectName: CODEBUILD_PROJECT_NAME,
      role: runnerRole,
      source,
      buildSpec: createCodeBuildRunnerBuildSpec(),
      environment: {
        buildImage: codebuild.LinuxBuildImage.fromCodeBuildImageId(
          'aws/codebuild/amazonlinux-x86_64-standard:5.0',
        ),
        computeType: codebuild.ComputeType.MEDIUM,
        environmentVariables: {
          TETRAGON_ARTIFACT_DIR: {
            value: TETRAGON_ARTIFACT_DIR,
          },
          TETRAGON_IMAGE: {
            value: 'quay.io/cilium/tetragon:v1.7.0',
          },
        },
        privileged: true,
      },
      logging: {
        cloudWatch: {
          logGroup,
          prefix: 'runner',
        },
      },
      grantReportGroupPermissions: false,
      queuedTimeout: Duration.minutes(30),
      timeout: Duration.minutes(30),
    });

    const cfnProject = this.runnerProject.node.defaultChild as codebuild.CfnProject;
    cfnProject.addPropertyOverride('Triggers.FilterGroups', [
      [
        { Pattern: 'WORKFLOW_JOB_QUEUED', Type: 'EVENT' },
        { Pattern: GITHUB_WORKFLOW_NAME, Type: 'WORKFLOW_NAME' },
      ],
    ]);

    if (props.githubConnectionArn !== undefined) {
      cfnProject.addPropertyOverride('Source.Auth', {
        Resource: props.githubConnectionArn,
        Type: 'CODECONNECTIONS',
      });
    }

    Tags.of(this).add('Project', CODEBUILD_PROJECT_NAME);

    new CfnOutput(this, 'CodeBuildProjectName', {
      description: 'Name used in the GitHub Actions runs-on label.',
      value: this.runnerProject.projectName,
    });

    new CfnOutput(this, 'GitHubRunnerLabelPrefix', {
      description: 'Prefix of the dynamic CodeBuild runner label.',
      value: `codebuild-${CODEBUILD_PROJECT_NAME}`,
    });

    new CfnOutput(this, 'RunnerLogGroupName', {
      description: 'CloudWatch Logs group for CodeBuild runner diagnostics.',
      value: logGroup.logGroupName,
    });
  }
}
