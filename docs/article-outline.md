# dev.to記事アウトライン

## 仮タイトル

AWS CodeBuild上のGitHub ActionsをTetragonで監視し、悪意あるnpm postinstallを止める

## 読者が持ち帰るもの

- Tetragonは脆弱性スキャナーではなく、実行時の振る舞いを観測・制御すること
- CodeBuild-hosted GitHub Actions runnerの`PRE_BUILD`で監視を先行起動できること
- monitor/enforceを同一TracingPolicyで比較する方法
- CIのランタイムセキュリティにもroot trust boundaryがあること

## 構成案

1. KubeConで聞いたCIランタイム監視の問題設定
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

| モード   | npm install | policy接続event | 実際のSIGKILL | Canary到達 |
| -------- | ----------- | --------------- | ------------- | ---------- |
| baseline | 成功        | 0               | なし          | あり       |
| observe  | 成功        | 1               | なし          | あり       |
| enforce  | 失敗        | 1               | あり          | なし       |

2026-09-20にAWS東京リージョンで実測済み。
[検証結果と証拠へのリンク](aws-validation-2026-09-20.md)を参照する。
AL2023イメージとは別に`HostKernel: LINUX_KERNEL_6`が必要だった点を記事の中心に置く。
イベントの`process.binary`が欠落した点、monitorでもSIGKILLのactionラベルが出た点も明記し、
policyイベントとcurl自身のsignal、受信結果をどう照合したか説明する。

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
