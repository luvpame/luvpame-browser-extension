# Chrome拡張を一つに統合する計画

Labels: wayfinder:map
Status: resolved

## Destination

luvpame の対象リポジトリの機能を一つの Chrome 拡張へ統合し、公開リポジトリ `luvpame-browser-extension` へ保存するための仕様と移行方針を確定する。
残す機能、操作、内部構成、検証条件、元リポジトリの削除条件に未決事項がなくなれば、この計画は完了とする。

## Notes

- この計画は wayfinder の計画モードで進める。実装、公開、元リポジトリの削除は計画完了後の実行作業とする。
- 各回は wayfinder、grilling、domain-modeling を参照する。用語は [CONTEXT.md](CONTEXT.md) に記録する。
- 一回のセッションで解決する判断チケットは一件までとする。開始前に Status を claimed にし、Assignee に担当者を記録する。
- Issue tracker の指定がないため、ローカル Markdown tracker を使う。未着手は Status: open、解決済みは Status: resolved とする。子チケットは issues/ に置き、Blocked by の全チケットが解決済みなら着手できる。
- レビュー時だけ reviewer、コミット時だけ committer に委譲する。それ以外は親エージェントが進める。

### ユーザーが確定した条件

- 複数の独立した拡張を一つの repo に置く案から、一つの拡張へ機能を統合する案へ変更した。
- 公開先の名前は `luvpame-browser-extension`。Git の変更履歴は引き継がない。
- ビルド成果物も Git に保存し、ルートから見つけやすくする。配置は `dist/chrome-mv3/`。
- ローカルの未コミット変更も取り込む。
- 拡張アイコンから共通メニューを開き、「URLをMarkdownでコピー」「本文をMarkdownでコピー」と設定を利用する。
- 機能別の ON/OFF を用意し、重複機能を一本化する。具体的な切替単位と初期値は「共通メニューと機能設定の動作を決める」の解決記録に従う。
- 移行確認後に元リポジトリを削除する。削除対象と条件は「移行完了の確認方法と元repoの削除条件を決める」の解決記録に従い、削除直前に明示確認する。

## Decisions so far

- [統合後に残す機能と重複の扱いを決める](issues/01-feature-scope.md): Gemini切替を除外し、残る10repoの固有機能を維持。重複はgithub-enhancerへ一本化し、本文コピーはサイト別に変換する。

- [共通メニューと機能設定の動作を決める](issues/02-interaction-settings.md): 12機能を個別切替・初期ONとし、開いているタブへ反映。共通メニュー、保存範囲、旧設定の手動移行を確定。

- [一つの拡張として動かす内部構成を決める](issues/03-integration-structure.md): Chrome MV3・WXT・Vite+を採用。Bunで依存管理とビルド、検査・テスト用にNodeも維持し、Vim連携・OFF時復元・dist保存を確定。

- [移行完了の確認方法と元repoの削除条件を決める](issues/04-cutover-deletion.md): 自分用。ユニットテストと各検査、新規clone・成果物一致・コピー2操作の手動確認を完了条件とし、旧拡張とローカルコピーを残して切り替える。GitHub上の10repoは削除直前に確認。

## Not yet specified

計画上の未決事項はない。4件の判断を解決し、仕様と移行方針の確定を完了した。
統合実装とその検証は未実施。実装中に利用時の動作を変える新しい選択が必要になった場合は、その時点で確認する。

## Out of scope

- Playwright/E2Eの移植と、新しいE2E・統合テスト基盤の追加。ユーザー指定により自動テストはユニットテストに限定する。

- `gemini-shift-tab-model-switcher` の機能移行。ユーザーが不要と判断したため除外。元repoの削除は承認していない。

- `jobcan-flex` の移行と削除。
- ローカルの `boxil_prod_warning` と `browser-extension-template` の移行と削除。
- 個別の拡張機能を残したままの monorepo 化。
- Git 履歴の統合。
- この計画セッション内での実装、公開、元リポジトリの削除。
