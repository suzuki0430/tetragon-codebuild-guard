# tetragon-codebuild-guard

AWS CodeBuild-hosted GitHub Actions runnerで実行中のプロセスをTetragonで観測し、
侵害された依存パッケージによる外向き通信を検知・阻止するPoCです。

TetragonはCVEを列挙する脆弱性スキャナーではありません。このプロジェクトでは、
静的検査を通過したコードや依存関係がCIで不審な振る舞いをした場合に、eBPFを使った
ランタイム観測・強制終了がどこまで有効かを検証します。

> [!IMPORTANT]
> AWS CodeBuildのマネージドカーネルで必要なeBPF/BTF機能が利用できるかを含めた
> feasibility PoCです。リージョンやCodeBuildイメージの変更によってTetragonが起動
> できない可能性があります。起動失敗時はGitHub jobを待機させ続けず、preflightで
> 診断情報とともに失敗します。

## 検証すること

同じ安全な攻撃シナリオを、次の3モードで実行します。

| モード     | TracingPolicy | npm lifecycle script | Canary受信 | 期待するTetragonイベント |
| ---------- | ------------- | -------------------- | ---------- | ------------------------ |
| `baseline` | 未適用        | 成功                 | あり       | `tcp_connect`なし        |
| `observe`  | monitor       | 成功                 | あり       | curlの`tcp_connect`あり  |
| `enforce`  | enforce       | SIGKILLで失敗        | なし       | curlの`tcp_connect`あり  |

`demo/compromised-dependency`の`postinstall`は、固定文字列のcanaryを`curl`で送信します。
送信先はCodeBuildコンテナ内で起動する一時HTTPサーバーです。実在する認証情報や
インターネット上の収集先は使用しません。受信記録にはcanary自体ではなくSHA-256のみを
保存します。

## アーキテクチャ

```mermaid
flowchart LR
    G[GitHub workflow_job] -->|queued webhook| C[AWS CodeBuild runner]
    C -->|PRE_BUILD| T[Tetragon container]
    C -->|BUILD| N[npm install]
    N --> P[simulated postinstall]
    P --> U[/usr/bin/curl]
    T -->|observe| E[tetragon.log]
    T -->|enforce| K[SIGKILL curl]
    U -->|baseline / observe only| S[local canary sink]
    E --> A[GitHub Actions artifact]
```

CodeBuildの`PRE_BUILD`でTetragonを起動し、GitHub Actions runnerが動く`BUILD`より先に
観測を開始します。`POST_BUILD`ではデーモンログを回収してTetragonを停止します。
この挙動を有効にするため、workflowのrunner labelには`buildspec-override:true`が必要です。

## 作成されるAWSリソース

- CodeBuild project `tetragon-codebuild-guard`
- CodeBuild用IAM role
  - CloudWatch Logsへの書き込み
  - 指定したCodeConnections connectionの読み取りだけ
- CloudWatch Logs group `/aws/codebuild/tetragon-codebuild-guard`
  - 保持期間7日

VPC、NAT Gateway、EKS、S3 bucketは作成しません。

## 前提条件

- AWSアカウントとデプロイ権限
- Node.js 22以降
- pnpm 11
- AWS CLI
- GitHub repository
- 対象リージョンで`CDK bootstrap`済みであること
- GitHub App用AWS CodeConnections connectionが`AVAILABLE`であること

GitHub App connectionはAWSコンソールで認可の完了が必要です。接続方法は
[AWS CodeBuild公式ドキュメント](https://docs.aws.amazon.com/codebuild/latest/userguide/connections-github-app.html)
を参照してください。

## セットアップ

### 1. リポジトリをGitHubへpushする

このディレクトリを、実際にworkflowを実行するGitHub repositoryへpushします。
`workflow_dispatch`だけを有効にしているため、pushや外部forkのPRでは自動実行されません。

### 2. AWS CodeConnections connectionを作成する

未作成の場合はconnectionを作成し、AWSコンソールでGitHub Appの認可を完了します。

```bash
aws codeconnections create-connection \
  --provider-type GitHub \
  --connection-name tetragon-codebuild-guard
```

返されたARNを控えます。`PENDING`のままではデプロイ後のwebhook作成に失敗します。

### 3. 依存関係とCDK templateを検証する

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify`はformat、ESLint、TypeScript、単体テスト、CDK synthを順番に実行します。

### 4. AWSへデプロイする

```bash
pnpm exec cdk bootstrap

pnpm exec cdk deploy \
  -c githubOwner=YOUR_GITHUB_OWNER \
  -c githubRepo=tetragon-codebuild-guard \
  -c githubConnectionArn=YOUR_CONNECTION_ARN
```

既にCodeBuildへGitHub credentialを登録している場合は`githubConnectionArn`を省略できます。
ただし、新規構築ではGitHub App/CodeConnectionsの利用を推奨します。

デプロイ後、GitHub repositoryの`Settings > Webhooks`にCodeBuild webhookが作成され、
`Workflow jobs`イベントが有効になっていることを確認します。

### 5. 検証workflowを実行する

GitHubのActions画面から`Tetragon CodeBuild Guard`を選び、`Run workflow`を実行します。
GitHub CLIを使用する場合は次のコマンドでも開始できます。

```bash
gh workflow run tetragon-ci.yml
```

3つのmatrix jobがそれぞれ一時CodeBuild runnerとして起動します。各jobのartifactには
次の証跡が含まれます。

- `tetragon.log`: TetragonのNDJSONイベント
- `summary.json`: secretを含まない集計結果
- `tetragon-daemon.log`: Tetragonの起動・診断ログ
- `tracing-policies.txt`: 適用されたpolicyとmode
- `canary-server.log`: ローカル受信サーバーのログ

`observe`の`summary.json`例:

```json
{
  "totalEventCount": 42,
  "invalidLineCount": 0,
  "processExecCount": 30,
  "tcpConnectCount": 1,
  "curlTcpConnectCount": 1,
  "enforcedCurlConnectCount": 0,
  "curlDestinations": ["172.18.0.1:18080"]
}
```

カーネルやTetragonのバージョンによって総イベント数やaction表現は変わる可能性があります。
workflowの成否判定に使用するのは、curlのイベント有無、npm stepの結果、canary受信の有無です。

## 実装のポイント

### Policy modeだけを切り替える

`policies/block-curl-egress.yaml`には`Sigkill` actionがあります。`observe`では
`tetra tracingpolicy add --mode monitor`としてロードするため、同じselectorでactionだけを
無効化できます。`enforce`では`--mode enforce`を使用します。

### PRE_BUILDを意図的に失敗させない

CodeBuild-hosted runnerでは、`PRE_BUILD`が失敗するとGitHub runnerが開始されず、GitHub jobを
手動キャンセルする必要があります。そのためTetragonの起動結果を`startup-status`へ保存し、
runner開始後の`Verify Tetragon startup` stepで明示的に検査します。

### 証跡にcanaryを残さない

Tetragonの生ログにはプロセス引数が含まれ得ます。`summary.json`生成時は接続先と件数だけを
抽出します。実運用で生ログを保存する場合は、Tetragonのredaction設定、保存先の暗号化、
アクセス制御、短い保持期間を追加してください。

## トラブルシューティング

### `btf-unavailable`

CodeBuild環境で`/sys/kernel/btf/vmlinux`が公開されていません。別のCodeBuildイメージを試すか、
Amazon Linux 2023のEC2セルフホステッドrunnerへ切り替えてください。

### `container-start-failed`

CodeBuild projectの`PrivilegedMode`、Docker daemon、Quayへの外向き通信を確認してください。
`startup-error.log`とCloudWatch Logsに`docker info`の診断が出力されます。

### `readiness-timeout`

`tetragon-daemon.log`でBPF program、BTF、kernel capabilityのエラーを確認してください。

### GitHub jobがrunner待ちのままになる

- CodeBuild project名が`tetragon-codebuild-guard`か
- workflow名が`Tetragon CodeBuild Guard`か
- `runs-on`に`buildspec-override:true`があるか
- CodeConnections connectionが`AVAILABLE`か
- GitHub webhookに`Workflow jobs`イベントがあるか

を確認してください。

## セキュリティ上の制限

このプロジェクトは学習・検証用です。

- CodeBuildはTetragon起動のためprivileged modeを使用します。
- job自体も同じ特権環境にいるため、root相当の攻撃者はTetragon containerを停止できます。
- `curl`全体を対象とする単純なpolicyで、汎用的なCI allowlistではありません。
- Tetragon container imageはversion tagで固定していますが、digest固定ではありません。
- public repositoryの外部PRや、信頼できないworkflowをこのrunnerで実行しないでください。
- 実際のAWS credentialやGitHub tokenをcanaryとして使用しないでください。

詳細は[SECURITY.md](SECURITY.md)を参照してください。

## 削除

```bash
pnpm exec cdk destroy \
  -c githubOwner=YOUR_GITHUB_OWNER \
  -c githubRepo=tetragon-codebuild-guard \
  -c githubConnectionArn=YOUR_CONNECTION_ARN
```

Stackを削除するとCodeBuild project、IAM role、CloudWatch Logs groupを削除します。
CodeConnections connectionはこのStackの管理外なので、不要なら別途削除してください。

## ディレクトリ構成

```text
.
├── .github/workflows/tetragon-ci.yml
├── bin/app.ts
├── demo/
│   ├── compromised-dependency/
│   └── victim/
├── docs/article-outline.md
├── lib/
│   ├── codebuild-runner-buildspec.ts
│   └── tetragon-codebuild-guard-stack.ts
├── policies/block-curl-egress.yaml
├── scripts/
│   ├── analyze-events.mjs
│   ├── assert-demo-result.mjs
│   ├── canary-server.mjs
│   └── tetragon-guard.sh
└── test/
```

## 参考資料

- [CodeBuild-hosted GitHub Actions runner](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html)
- [Tetragonをコンテナとして実行する](https://tetragon.io/docs/installation/container/)
- [Tetragon TracingPolicy](https://tetragon.io/docs/concepts/tracing-policy/)
- [Tetragon Enforcement Mode](https://tetragon.io/docs/concepts/tracing-policy/mode/)
- [Tetragon Policy Enforcement](https://tetragon.io/docs/getting-started/enforcement/)
