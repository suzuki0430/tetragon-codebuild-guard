import { aws_codebuild as codebuild } from 'aws-cdk-lib';

/** Directory shared by the CodeBuild host shell and the Tetragon container. */
export const TETRAGON_ARTIFACT_DIR = '/tmp/tetragon-codebuild-guard';

const START_TETRAGON = String.raw`set +e
mkdir -p "${TETRAGON_ARTIFACT_DIR}"
chmod 0777 "${TETRAGON_ARTIFACT_DIR}"
status_file="${TETRAGON_ARTIFACT_DIR}/startup-status"
: > "${TETRAGON_ARTIFACT_DIR}/tetragon.log"
chmod 0666 "${TETRAGON_ARTIFACT_DIR}/tetragon.log"

if [ ! -r /sys/kernel/btf/vmlinux ]; then
  printf '%s\n' 'btf-unavailable' > "$status_file"
  printf '%s\n' 'Tetragon was not started: /sys/kernel/btf/vmlinux is unavailable.'
  exit 0
fi

docker rm -f tetragon >/dev/null 2>&1 || true
docker run --name tetragon --rm -d \
  --pid=host \
  --cgroupns=host \
  --privileged \
  -v /sys/kernel/btf/vmlinux:/var/lib/tetragon/btf:ro \
  -v "${TETRAGON_ARTIFACT_DIR}:/var/log/tetragon" \
  "$TETRAGON_IMAGE" \
  /usr/bin/tetragon \
  --export-filename /var/log/tetragon/tetragon.log \
  --enable-process-ancestors > "${TETRAGON_ARTIFACT_DIR}/container-id" 2> "${TETRAGON_ARTIFACT_DIR}/startup-error.log"

if [ "$?" -ne 0 ]; then
  printf '%s\n' 'container-start-failed' > "$status_file"
  docker info >> "${TETRAGON_ARTIFACT_DIR}/startup-error.log" 2>&1 || true
  exit 0
fi

attempt=1
while [ "$attempt" -le 30 ]; do
  if docker exec tetragon tetra status >/dev/null 2>&1; then
    printf '%s\n' 'ready' > "$status_file"
    printf '%s\n' 'Tetragon is ready.'
    exit 0
  fi
  sleep 1
  attempt=$((attempt + 1))
done

printf '%s\n' 'readiness-timeout' > "$status_file"
docker logs tetragon > "${TETRAGON_ARTIFACT_DIR}/tetragon-daemon.log" 2>&1 || true
exit 0`;

const STOP_TETRAGON = String.raw`set +e
if docker inspect tetragon >/dev/null 2>&1; then
  docker logs tetragon > "${TETRAGON_ARTIFACT_DIR}/tetragon-daemon.log" 2>&1 || true
  sync
  docker rm -f tetragon >/dev/null 2>&1 || true
fi
chmod -R a+rX "${TETRAGON_ARTIFACT_DIR}" 2>/dev/null || true
exit 0`;

/**
 * Creates the build specification used by a CodeBuild-hosted GitHub Actions runner.
 *
 * The pre-build phase starts Tetragon before the GitHub runner accepts the queued
 * job. Startup failures are deliberately recorded instead of failing this phase:
 * AWS does not start the runner after a pre-build failure, which otherwise leaves
 * the GitHub job waiting until it is manually cancelled. The workflow performs a
 * fail-fast preflight check after the runner starts.
 *
 * @returns An inline CodeBuild build specification with Tetragon lifecycle hooks.
 *
 * @example
 * ```ts
 * const project = new codebuild.Project(stack, 'Runner', {
 *   buildSpec: createCodeBuildRunnerBuildSpec(),
 * });
 * ```
 */
export function createCodeBuildRunnerBuildSpec(): codebuild.BuildSpec {
  return codebuild.BuildSpec.fromObjectToYaml({
    version: '0.2',
    phases: {
      pre_build: {
        commands: [START_TETRAGON],
      },
      post_build: {
        commands: [STOP_TETRAGON],
      },
    },
  });
}
