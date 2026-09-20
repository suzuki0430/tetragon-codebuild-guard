# AWS実機検証結果 — 2026-09-20

## 結論

AWS CodeBuild-hosted GitHub Actions runner上でTetragonを起動し、同じTracingPolicyの
monitor/enforce切り替えによって、ダミー通信の観測とcurlのSIGKILLを確認した。
3モードのGitHub Actions jobはいずれも成功した。

- [成功したworkflow run](https://github.com/suzuki0430/tetragon-codebuild-guard/actions/runs/35511573771)
- 実行コミット: `0ae2ad5ac61525ce7b6ed64065cbfd3059f3f686`
- 実行ブランチ: `codex/aws-runtime-validation`
- ローカル検証: `pnpm verify`（format、lint、typecheck、24 tests、CDK synth）

この結果は限定した安全なPoCの成立を示す。任意の悪意あるCI jobを完全に防げることや、
プロセスの親子関係まで取得できることを示すものではない。

## 環境

| 項目                | 設定・実測値                                             |
| ------------------- | -------------------------------------------------------- |
| AWS Region          | `ap-northeast-1`                                         |
| CodeBuild project   | `tetragon-codebuild-guard`                               |
| Compute             | `LINUX_CONTAINER` / `BUILD_GENERAL1_MEDIUM` / privileged |
| Build image         | `aws/codebuild/amazonlinux-x86_64-standard:5.0`          |
| Host kernel setting | `LINUX_KERNEL_6`                                         |
| 実際のカーネル      | `6.1.180-225.360.amzn2023.x86_64`                        |
| Tetragon            | `quay.io/cilium/tetragon:v1.7.0`                         |
| Node.js runtime設定 | `22`                                                     |
| Canary送信先        | 同じビルド内のHTTPサーバー `172.18.0.1:18080`            |

IPアドレスとカーネルのパッチ版は実測値であり、将来のビルドへの固定値ではない。

## 実測結果

| モード   | npm step              | 対象policyの接続イベント | curl子プロセス | Canary受信 | 判定 |
| -------- | --------------------- | -----------------------: | -------------- | ---------- | ---- |
| baseline | success               |                        0 | exit 0         | あり       | pass |
| observe  | success               |                        1 | exit 0         | あり       | pass |
| enforce  | failure（意図どおり） |                        1 | SIGKILL        | なし       | pass |

enforceの攻撃stepは`continue-on-error`で実行し、後続stepが遮断結果を検証する。
そのため攻撃stepのexit 1は期待した挙動で、job全体の失敗ではない。

各jobのartifactで確認できる証拠:

- `result.json`: 最終判定と、policyイベント・接続先・signal・受信有無の照合
- `attack-result.json`: `spawnSync`が返した実際のcurl終了コードとsignal
- `canary-receipt.json`: baseline/observeでのみ存在する、受信したダミー値のSHA-256
- `summary.json`: Tetragonイベントの集計
- `kernel-diagnostics.txt`: ホストカーネルとBTFの存在
- `tracing-policies.txt`: policyのmodeとカウンター

固定のダミー文字列だけを送信した。実際のAWS/GitHub認証情報を攻撃用データとして使っていない。
raw Tetragonログにはプロセス引数が含まれ得るため、別環境へ展開する際は保存・公開前の
redactionとアクセス制御が必要。

## 成功までに分かったこと

### 1. GitHub Appの認可とインストールは別

CodeConnectionsは`AVAILABLE`でも、AWS Connector for GitHubが未インストールの状態だった。
この状態ではCodeBuild projectのWebhook作成が失敗した。対象リポジトリへのAppインストール後に
デプロイが成功した。

### 2. AL2023イメージだけではホストカーネルは変わらない

[初回run](https://github.com/suzuki0430/tetragon-codebuild-guard/actions/runs/35510870288)は
3モードとも`btf-unavailable`で停止した。追加の診断ビルドではホストが
`4.14.355-284.742.amzn2.x86_64`で、`/sys/kernel/btf/vmlinux`がないことを確認した。

CDKで`Environment.HostKernel: LINUX_KERNEL_6`を明示すると、Linux 6.1とBTFを利用でき、
Tetragonが起動した。コンテナのuserspaceとホストカーネルを混同しないことが重要。

- [AWS: ホストカーネル選択の発表](https://aws.amazon.com/about-aws/whats-new/2026/07/aws-codebuild-amazon-linux-2023/)
- [AWS: hostKernelの仕様](https://docs.aws.amazon.com/cli/latest/reference/codebuild/create-project.html)

### 3. 実行環境に合わせた小さな修正が必要だった

- TetragonイメージのENTRYPOINTを明示し、実行ファイル名を二重に渡さないよう修正。
- `hostname`コマンドがないため、Node.jsの`networkInterfaces()`でローカルIPv4を選択。
- CodeBuildのNode.js runtimeを22系に固定。
- 起動失敗したコンテナをPOST_BUILDまで保持し、診断ログを回収。

### 4. プロセス情報の欠落と、actionラベルの解釈に注意

observe/enforceとも、対象policyの`tcp_connect`イベントは1件だったが、
`process.binary`は欠け、`flags`は`unknown`だった。`policyConnectMissingBinaryCount`は各1、
`curlTcpConnectCount`は各0として、そのまま記録している。

daemonログにはprocfsのPID namespaceに関する警告もあったが、情報欠落の根本原因は未確定。
このPoCではプロセスの親子関係の取得までは検証できていない。

初期の集計は`process.binary`のみでcurlを数えていたため、
[3回目のrun](https://github.com/suzuki0430/tetragon-codebuild-guard/actions/runs/35511290113)では
実際には遮断できていたenforceも集計エラーになった。

最終版はテストで固定した`block-curl-egress` policyの接続先と、実際のcurl終了結果・受信結果を
照合する。欠落したbinary情報は推測で埋めない。またmonitorモードでもactionラベルには
`KPROBE_ACTION_SIGKILL`が出るため、それだけでは実際の遮断を判定しない。
[Tetragonのモード仕様](https://tetragon.io/docs/concepts/tracing-policy/mode/)ではmonitor時の
enforcementは実行されない。

## 残る制限・次の検証

- privileged jobからTetragonを停止できるため、敵対的なrootから独立した防御ではない。
- policyはcurlだけを対象とし、別のHTTPクライアントなどを一般的に防ぐものではない。
- プロセス情報・親子関係の欠落は未解決。検知・遮断と完全な実行履歴の復元は区別する。
- イメージはversion tag指定。再現性を高めるならdigest固定を検討する。
- 外部ActionsのNode.js 20非推奨警告がある。今回のrunnerではNode.js 24へ自動切り替えされ成功したが、将来の更新対象。

GitHub artifactとCloudWatch Logsの保持期間は7日。長期保存する場合は、必要な証拠を確認・
sanitizationしてから保存する。検証終了後もCodeBuild projectと接続は残している。
削除する場合はREADMEの手順を使い、接続がStack管理外であることに注意する。
