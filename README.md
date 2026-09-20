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

| モード     | TracingPolicy | npm lifecycle script | Canary受信 | 期待するTetragonイベント     |
| ---------- | ------------- | -------------------- | ---------- | ---------------------------- |
| `baseline` | 未適用        | 成功                 | あり       | `tcp_connect`なし            |
| `observe`  | monitor       | 成功                 | あり       | 対象policyの接続イベントあり |
| `enforce`  | enforce       | SIGKILLで失敗        | なし       | 対象policyの接続イベントあり |

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

ビルドイメージとホストカーネルは別設定です。このStackでは、AL2023のビルドイメージに加えて
`Environment.HostKernel: LINUX_KERNEL_6`を明示します。AL2023のイメージだけを選んでも
Linux 4.14のホストで起動する場合があり、Tetragonが必要とするBTFを利用できません。

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
- pnpm 10.11.0（`package.json`の`packageManager`と一致させる）
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

GitHub Appの**認可（Authorize）とインストール（Install）は別の手順**です。
`AVAILABLE`でもApp未インストールの場合、Webhookは作成できません。

1. [AWS Connector for GitHub](https://github.com/apps/aws-connector-for-github)をインストールする。
2. `Only select repositories`で検証用リポジトリだけを許可する。
3. GitHubの`Settings > Applications > Installed GitHub Apps`にAppがあることを確認する。
4. 接続の作成時は対象のApp installationを選択し、AWS側が`AVAILABLE`になったことを確認する。

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
- `kernel-diagnostics.txt`: 実際のカーネルバージョン、BTFの有無、Dockerのホスト情報
- `tracing-policies.txt`: 適用されたpolicyとmode
- `canary-server.log`: ローカル受信サーバーのログ
- `attack-result.json`: curl子プロセスの終了コードとsignal
- `canary-receipt.json`: 受信した場合のみ保存するcanaryのSHA-256
- `result.json`: ポリシーの接続先、curl終了結果、受信有無を突き合わせた判定

`observe`の`summary.json`例:

```json
{
  "totalEventCount": 42,
  "invalidLineCount": 0,
  "processExecCount": 30,
  "tcpConnectCount": 1,
  "curlTcpConnectCount": 0,
  "curlSigkillActionCount": 0,
  "curlDestinations": [],
  "policyTcpConnectCount": 1,
  "policyConnectMissingBinaryCount": 1,
  "policySigkillActionCount": 1,
  "policyDestinations": ["172.18.0.1:18080"]
}
```

カーネルやTetragonのバージョンによって総イベント数やaction表現は変わる可能性があります。
workflowの成否判定に使用するのは、対象policyの送信先に一致する接続イベント、npm stepの結果、
curl子プロセスの実際のsignal、canary受信の有無です。単なる通信エラーはenforce成功とみなしません。

CodeBuild実測では、policyがカーネル内で`/usr/bin/curl`に一致していても、イベントの
`process.binary`が欠け、`flags: unknown`になることがありました。これをcurl名で補完せず、
`policyConnectMissingBinaryCount`として明示します。プロセスの親子関係まで取得できたとは主張しません。

またmonitorモードでもイベントのactionは`KPROBE_ACTION_SIGKILL`になり得ます。
actionラベルだけで遮断と判定せず、`attack-result.json`の`signal: SIGKILL`と未受信を要求します。
この区別のため、初期PoCの`enforcedCurlConnectCount`は`curlSigkillActionCount`へ改名しました。

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

CodeBuild環境で`/sys/kernel/btf/vmlinux`が公開されていません。まず
`kernel-diagnostics.txt`とCodeBuild projectの`environment.hostKernel`を確認してください。
`LINUX_KERNEL_6`が必要で、ビルドイメージだけを変更してもホストカーネルは変わりません。
指定済みでもBTFがない場合は、診断ログを保存して対応環境を再検討してください。

### `container-start-failed`

CodeBuild projectの`PrivilegedMode`、Docker daemon、Quayへの外向き通信を確認してください。
`startup-error.log`とCloudWatch Logsに`docker info`の診断が出力されます。

### `readiness-timeout`

`tetragon-daemon.log`でBPF program、BTF、kernel capabilityのエラーを確認してください。
起動に失敗したコンテナも`POST_BUILD`まで保持するため、終了理由を回収できます。

### Webhook作成時の権限エラー

CodeConnectionsが`AVAILABLE`でも、GitHub Appが未インストール・対象リポジトリ未許可・
追加Webhook権限の承認待ちの場合があります。GitHubの`Installed GitHub Apps`を確認し、
必要ならAppの権限更新を承認してください。
[AWS公式のトラブルシューティング](https://docs.aws.amazon.com/codebuild/latest/userguide/connections-github-app.html)
も参照してください。

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
