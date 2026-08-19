# dev.to記事アウトライン

## 仮タイトル

AWS CodeBuild上のGitHub ActionsをTetragonで監視し、悪意あるnpm postinstallを止める

## 読者が持ち帰るもの

- Tetragonは脆弱性スキャナーではなく、実行時の振る舞いを観測・制御すること
- CodeBuild-hosted GitHub Actions runnerの`PRE_BUILD`で監視を先行起動できること
- monitor/enforceを同一TracingPolicyで比較する方法
- CIのランタイムセキュリティにもroot trust boundaryがあること

## 構成案

1. KubeCon Japanで見た「Detecting Compromised CI」の問題設定
2. なぜGitHub-hosted runnerではなくAWS CodeBuild-hosted runnerなのか
3. Tetragon、CodeBuildログ、CloudTrail、VPC Flow Logsの観測範囲の違い
4. 実験の安全設計
   - 実credentialを使わない
   - 送信先は同一CodeBuild環境内
   - canaryはハッシュだけ保存
5. CDKで作るCodeBuild runner
6. `PRE_BUILD`でTetragonを起動する
7. `baseline / observe / enforce`を実行する
8. `summary.json`とcanary receiptを比較する
9. 期待どおりにならなかった点とCodeBuildカーネルの制約
10. 実運用へ進める場合の追加対策

## 掲載する結果表

| モード   | npm install | curl event | SIGKILL | Canary到達 |
| -------- | ----------- | ---------- | ------- | ---------- |
| baseline |             |            |         |            |
| observe  |             |            |         |            |
| enforce  |             |            |         |            |

workflow artifactの実測値で空欄を埋める。CodeBuildのリージョン、イメージ、Tetragon、
Linux kernelのバージョンも併記する。

## 必ず触れる制限

- privileged jobはTetragon自体を妨害できる
- process argumentをログへ残すリスク
- 単純なcurl block policyは一般的なegress policyではない
- CodeBuildのマネージド環境でeBPF機能が将来も同じとは限らない
- ランタイム検知はactionのSHA pin、最小権限、レビューを置き換えない

## 第二弾候補

- EC2 ephemeral runnerとの可観測性比較
- CloudWatch LogsへのTetragon event転送
- CodeBuild VPC＋egress proxyによる多層防御
- GitHub OIDCで取得した一時AWS credentialへのアクセス検知
