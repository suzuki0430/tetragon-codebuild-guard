# Security policy

## Intended use

`tetragon-codebuild-guard` is an isolated demonstration of runtime observability and
enforcement in an ephemeral CI environment. It is not a complete CI sandbox or a
production security product.

## Safe demonstration rules

- Use only the committed `tetragon-demo-only-not-a-secret` canary.
- Do not substitute AWS credentials, GitHub tokens, customer data, or production secrets.
- Run the workflow only with `workflow_dispatch` in a repository you control.
- Do not enable the CodeBuild runner for workflows triggered by untrusted forks.
- Destroy the demonstration stack when the experiment is complete.

The local canary sink records a SHA-256 digest rather than the submitted value. Raw
Tetragon events can still contain process arguments, so treat uploaded evidence as
sensitive operational telemetry.

## Trust boundary

Tetragon runs as a privileged container alongside the CodeBuild-hosted runner. A job
that obtains root-equivalent control of the build environment can stop the Tetragon
container, modify its policy, or alter local event files. The demonstration detects a
non-evasive compromised dependency; it does not defend against a hostile privileged
runner administrator.

Production designs should separate policy control and evidence export from the
workload trust domain, restrict egress independently at the VPC or proxy layer, redact
sensitive arguments, and forward events to an append-only remote destination.

## Reporting a vulnerability

Open a private GitHub security advisory for vulnerabilities in the project. Do not
include live credentials, unredacted Tetragon logs, or exploit data from systems you do
not own.
