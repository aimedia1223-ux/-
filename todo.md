# Connexy 開発タスク＆やることリスト (todo.md)

本プロジェクトにおける機能追加・改善タスク、および将来的なコンプライアンス強化に向けたロードマップです。

## 📋 将来的な計画・対応予定タスク

### 🛠️ 改善提案(バグではなく設計・品質向上、2026-09-08 提案・採用)
一連のバグ調査を通して見えてきた根本原因・改善余地。すべて採用済みだが、規模の大きいものは別途スコープを決めて着手する。

**設計・アーキテクチャ**
- [~] チャット⇔案件の紐付けの読み出しを単一アクセサに統一(PR #32)。`src/utils/jobStates.ts` に `getLinkedJobIds()` / `getPrimaryLinkedJobId()` / `isJobLinkedToChat()` を新設し、`appliedJobIds` / `offeredJobId` / `jobStates` を統合。MessagePage の `appliedJobIds?.[0] || offeredJobId` イディオム5箇所 + ManagementPage/SearchPage の該当箇所を差し替え。**残**: 保存側は `appliedJobIds` と `offeredJobId` の両フィールドが残っている(完全な単一化は下記「ContractTask 型の分離」と同時に行う)。
- [ ] `ContractTask`型が「チャットスレッド」「応募」「オファー」「実契約」の4つの異なる概念を1レコードで兼務しているのを分離する。段階導入:
  - [x] **段階1: `evaluations` の応募/オファー情報を `jobStates` に統合**(PR #33)。`JobState` に `appliedAt` / `staffId` / `offer` を追加。`seedAppliedJobStates` がスタッフIDと応募日も記録、`applyJobState` がオファー時に条件・スタッフを記録。`getJobAppliedAt()` / `getJobStaffId()` / `getLinkedStaffIds()` / `getJobOfferInfo()` を新設し、`appliedJobDates` / `appliedJobStaffIds` / `offeredStaffId` / `offered*` の**読み出し**を差し替え(旧フィールドにフォールバック)。保存側は旧フィールドも併記(段階4で撤去)。
  - [x] **段階2: レコード種別の判定を集約**(PR #34)。`src/utils/contractTaskKind.ts` に `getContractTaskKind()`(`direct_chat` / `group_chat` / `contract`)と `isDirectChat()` / `isGroupChat()` / `isContractRecord()` を新設。ManagementPage・MessagePage の `id.startsWith('chat_')` / `startsWith('chat_group_')` 判定を差し替え。挙動不変。(判別可能ユニオンによる型レベルの分離は churn が大きいため見送り、述語の集約に留める。)
  - [ ] 段階3: `ct_*`(実契約)を `api.getContracts()` に分離。
  - [ ] 段階4: 直接チャットの `appliedJobIds` / `offeredJobId` / `appliedJobDates` / `appliedJobStaffIds` / `offered*` フィールドを撤去(`jobStates` に一本化済み)。
  - [ ] 段階5: 残りの参照箇所・group chat の扱いを整理。
- [x] 経費申請まわりの重複ロジックを共通化(PR #29)。`src/utils/chatParties.ts` の `getOpponentCompanyName()` を送信・承認・差戻し・手配・写真送信の5ハンドラで使用(チャットID分割の重複を集約)。`src/utils/expenseHelpers.ts` の `getExpenseCategoryLabel()` でカテゴリラベルを統一(「公共交通機関/交通費」「車移動/車移動費」の表記ゆれを「交通費」「車移動費」に統一)。

**コード品質**
- [x] 自作CSVパーサー(`parseCsvLine`)をライブラリ(papaparse)に置き換える。`src/pages/SearchPage.tsx`の`handleCsvFileUpload`をPapa.parseベースに書き換え、`parseCsvLine`は削除。クォート・カンマ・CRLFの扱いをNode上で再検証済み。
- [x] デバッグ用ログインパネル・テストアカウント機能を、ビルド時フラグ(`import.meta.env.DEV`)で本番ビルドから機械的に排除する。`src/pages/LoginPage.tsx`のパネル全体を`{import.meta.env.DEV && (...)}`でラップ。`npm run build`後、`dist/assets/*.js`に「デバッグ開発用」の文字列が一切含まれないことを確認済み(開発サーバーでは従来通り表示されることも確認済み)。

**UX・運用性**
- [x] 未読バッジのポーリングをイベント駆動に変更(PR #31 → #35 で修正)。`saveOfflineData` が `connexy:data-changed` イベントを発火。`subscribeToContractTaskChanges()` がイベント + storage + Supabase Realtime + **フォールバックポーリング**(Realtime が SUBSCRIBED になるまで5秒、確認後45秒)を併走。`BottomNav`/`MessagePage` のポーリングを購読 + `visibilitychange` に置換。
  - ⚠️ PR #31 初版は Realtime が未有効の環境で新着メッセージが最大60秒遅延する不具合があった(#35 で短間隔ポーリングを常時併走させて解消)。

### 🚑 Supabase プロジェクト消滅(2026-09-10〜11)
デプロイ版が参照する Supabase プロジェクト `snoccydfbrbxupembsar` が一時 DNS ごと消滅(無料プランで削除された可能性)。その後復活したが、**復元できたのは 2026-06-05 時点の古いバックアップのみ**(無料プランは日次バックアップの保持が短く、それより新しい復元ポイントが無かった)。
- 欠損: 会社 `seals` / `freer` / `cocolabo` とそのスタッフ、`announcements` テーブル、6/5 以降の案件・チャット履歴。
- `staffs` テーブルに `login_id` / `password` / `role` 列が無い(localStorage 生成のログインで代用されていた)。
- 対応: [db/reseed_missing_data.sql](db/reseed_missing_data.sql) を Supabase SQL Editor で実行(3社・9スタッフの再投入、`announcements` テーブル作成+シード、`working`→`confirmed` 更新、`staffs` への列追加)。冪等。
- 恒久対策: 本番運用するなら Supabase Pro へ(無料プランは7日放置で pause → 放置継続で削除、バックアップ保持も短い)。

### 🚑 デプロイ版チャット不具合(2026-09-10 ユーザー報告 → PR #35 で修正)
デプロイ版(Supabase オンライン)でチャットが機能しない。相手アカウントにメッセージが届かず、トークルームも表示されない。
- 原因1: `getAnnouncements()`(PR #27)が存在しない `announcements` テーブルを問い合わせ → `callSupabase` の例外ハンドラが `connexy_is_offline='true'` を**永続化**し、アプリ全体が localStorage モードに固定 → 別ブラウザ(=別アカウント)間でデータが同期されなくなる。
- 原因2: PR #31 の Realtime 依存で、Realtime 未有効だと新着が反映されない。
- 修正(PR #35):
  - `getAnnouncements` / `saveAnnouncement` / `deleteAnnouncement` を `callSupabase` から外し、失敗しても全体をオフラインに落とさず既定データにフォールバック。
  - `callSupabase` の `connexy_is_offline` 永続化を `!navigator.onLine` のときだけに限定(オンラインなら次回リロードで再試行)。
  - 起動時の自己回復: `connexy_is_offline` がセットされていても `navigator.onLine` なら `companies` に軽く疎通確認し、成功したらフラグ解除。
  - `subscribeToContractTaskChanges` に短間隔フォールバックポーリングを常時併走。
  - `saveContractTaskChat` の新規 insert に `client_id`/`agency_id`(チャットIDから推定)を追加、列が無ければ外して再試行。
- [x] チャットの同時送信でメッセージが消える問題を軽減(PR #36)。`saveContractTaskChat` の更新時、呼び出し側の `messages` を正としつつ、保存済みにしか無いIDのメッセージ(ロード後に届いた相手の発言)を末尾にマージする `mergeChatMessages()` を追加。両アカウントがほぼ同時に送っても双方のメッセージが残ることを検証。
- [~] 「運営からのお知らせ」をデータソース化(PR #27)。`HomePage.tsx` のハードコード配列を廃止し、`api.getAnnouncements()`(Supabase `announcements` テーブル / オフライン時 localStorage、日付降順)から取得。`api.saveAnnouncement()` / `api.deleteAnnouncement()` も追加。**残**: 運営(プラットフォーム管理者)ロールが未実装のため、投稿・編集UIは未着手。ロール導入後に画面を追加する。
- [x] マスキング用マスターデータ(エリア名・家電量販店名・キャリア名のパターン)を `src/data/maskingMasters.ts` に分離(PR #26)。パターンは正規表現リテラルでなく「文字列 + 伏せ名」で保持し、将来 DB/管理画面に載せ替え可能に。`maskingUtils.ts` は `compileBrandPatterns()` でコンパイルして使用。出力は従来と同一(検証済み)。
- [x] エリア検索を緯度経度の半径判定に変更(PR #28)。`src/utils/areaFilter.ts` に中心座標・Haversine・`isWithinAreaFilter()` を新設。SearchPage の4箇所(保存条件チェック×2、案件フィルタ、人材グループフィルタ)を差し替え。半径3km、座標が無いデータは従来の地名一致にフォールバック。
- [x] 「探す」の地図クラスタバッジを修正(PR #47)。地図を縮小するとライブラリ(`@googlemaps/markerclusterer`)の既定レンダラーが濃い青のグラデーションバッジで「エリア数」を表示していた。カスタム `renderer` を渡し、内包マーカーの `__count` を合算して**案件数/人材数**を表示するフラットな円バッジに統一。100件以上は「99+」表記(自作グリッドクラスタのバッジも同様)。`src/utils/offerExpiry.ts`(既定7日、残り2日で「期限間近」)。送信時に `evaluations.offeredAt` / `offerExpiresAt` を記録。内定通知モーダル・オファーカードに有効期限を表示、期限切れは承諾ボタンを無効化し `handleAcceptUnofficialOffer` でもガード。自動リマインドはバックエンド(cron)が無いため、クライアント側に「相手にリマインドを送る」ボタン(システムメッセージ送信)を用意。旧データ(タイムスタンプ無し)は従来通り期限なし。

### 🏷️ 案件ごとのステータス表示(2026-09-10 設計確定、段階導入中)

設計仕様は [STATUS_MODEL.md](STATUS_MODEL.md) を参照。表示ラベル・色・視点別文言を一元管理し、保存値の遷移ロジックには手を入れずに段階的に移行する。

- [x] **第1段階: 表示関数の新設 + 2画面の差し替え**
  - `src/utils/statusLabels.ts` を新設。`getJobListingStatus()`(軸A: 掲載中/締切間近/掲載締切/募集停止)、`getEngagementStatusLabel()`(軸B: 選考中/内定・承諾待ち/稼働待ち・稼働中・稼働終了/評価待ち/完了/内容確認中/見送り/辞退/キャンセル、視点別文言・契約書承認待ちサブバッジ対応)、`isContractApproved()` を提供。`confirmed`(=現行`working`)は稼働日から「稼働待ち/稼働中/稼働終了」を算出。
  - 「応募状況・履歴」「案件管理」の2画面のバッジをこの関数経由に差し替え([src/pages/ManagementPage.tsx](src/pages/ManagementPage.tsx))。保存値・遷移は不変。
  - `npx tsc -b --noEmit` パス。開発サーバーで全ラベル分岐を実データ検証済み。
- [x] **第2段階a: `evaluations.jobStates` 保存レイヤの新設**(PR #20)
  - `src/utils/jobStates.ts`: `getJobStatus` / `getJobState`(読み出し・チャット単位`status`へフォールバック)、`applyJobState`(純粋更新)、`mostAdvancedStatus`(後方互換値=「最も進んだ案件の状態」)、`seedAppliedJobStates`。
  - `api.updateContractTaskJobStatus(taskId, jobId, status, options)`。挙動不変。
- [x] **第2段階b: 書き込み経路の移行**(PR #21)
  - 応募時に `saveContractTaskChat` が案件ごとに `jobStates[jobId]='applying'` を seed。
  - 承諾・辞退・オファー送信・完了報告・**競合自動不採用**を `updateContractTaskJobStatus` 経由に移行。競合自動不採用は「その案件のみ」不採用にするようになり、同じ直接チャットの別案件は影響を受けない → 上記「発見済みバグ(未修正)」を解消。
  - 「応募状況・履歴」「選考」画面の状態参照を `getJobStatus(task, jobId)` に変更。
  - 承諾時に `contractApprovalRequired` フラグを記録(将来の `contract_review` 独立ステータス化の起点)。
- [x] **第3段階: 保存値 `working` → `confirmed` リネーム**(PR #24)
  - `normalizeEngagementStatus()` を新設し、`mapContractTask` / `getJobStatus` が読み出し時に旧 `working` を `confirmed` に正規化。
  - 起動時に一度きりのデータ移行(`offline_db_contract_tasks` の `status` と `jobStates` を書き換え、`connexy_migrated_working_to_confirmed` フラグで再実行防止)。
  - 型・比較・配列・バッジ判定の `'working'` を `'confirmed'` に一括置換(mockDb / MessagePage / ManagementPage / SearchPage)。`getEngagementStatusLabel` と `PROGRESS_RANK` は旧値も受理(防御的)。
  - ※ Supabase 側の `working` 行の移行は別途必要(運用者タスク)。
- [x] **第4段階: 稼働前キャンセルUI(発注者のみ)**(PR #22)
  - `ContractTask.status` に `cancelled` 追加。`getWorkPhase()` を `statusLabels.ts` から公開。
  - 「選考」画面の候補者カードに「この応募をキャンセル」を追加(応募中/内定通知済み、または稼働開始前の稼働待ちのみ)。確認モーダルで理由を任意入力。
  - 確定で `updateContractTaskJobStatus(chatId, jobId, 'cancelled')` + 相手チャットへシステムメッセージ通知。UIフロー検証済み。
- [x] **第5段階: 「内容確認中」(disputed)の解消UI**(PR #23)
  - 完了報告で評価★1のとき `disputed` にし、コメントを確認事項として保存(`handleReportSubmit`)。
  - 「報告・評価」の該当カードに「内容を承認して完了」(→ `completed`)/「認識に相違あり」(理由入力 → `disputed` のまま)の2ボタン。
  - `respondToDispute` を jobStates 対応にし、理由は `evaluations.disputedReason` に統一。UIフロー検証済み(★1→disputed→差戻し→承認→completed)。
- [x] **第6段階: MessagePage のバッジを `getEngagementStatusLabel` 経由に**(PR #25)
  - `getChannelBadge()` ヘルパーを新設。レガシーなチャット状態(商談中/契約待ち/契約成立/現場グループ)は個別、応募・契約ステータスは `getEngagementStatusLabel` に委譲。
  - チャット一覧バッジ(視点なし・中立ラベル)とチャットヘッダーの条件ピン(視点・案件・契約書承認状態つき、`subBadge` 対応)を差し替え。

### 💬 チャット機能の追加・改善(2026-09-11)
- [x] 直接チャットへ**自社メンバーを追加/削除**できる(PR #44 / #45)。参加メンバーモーダルから、まだ参加していない自社スタッフを選んで追加。追加時に「これまでのトーク内容も共有する」を選択可(追加した側が決める)。追加メンバーは同社の担当者が「参加メンバー一覧」から削除可能。
  - 追加時のシステムメッセージ: 履歴共有あり→「○○が○○を追加し、過去のトークを共有しました。」／なし→「○○が○○を追加しました。」。削除時→「○○が○○をトークから削除しました。」
  - PR #45: `var(--primary-color)`(未定義)を `var(--primary)` に一括修正(MessagePage 全体で19箇所。チャット内の一部ボタン/アイコンが不可視だった)。
  - `evaluations.addedMembers: [{ staffId, companyId, name, addedBy*, addedAt, historyShared, joinAfterMsgId }]`(`src/utils/chatMembers.ts`)。
  - 非共有の場合、追加された担当者には `joinAfterMsgId` より後のメッセージのみ表示。追加時にシステムメッセージを1件記録。
  - スタッフユーザーのチャットアクセス判定に `getAddedMemberStaffIds` を追加。
  - `mergeChatMessages` を「既存の順序を保ったままマージ」に変更(スライスされた一覧で発言しても履歴順が崩れない)。
- [x] メンバー削除の権限ルール(PR #46)。
  - 一般スタッフは管理者を削除できない。管理者は管理者・一般スタッフの両方を削除できる。
  - トークルーム開始時の各社1名(応募スタッフ / 最初の発言者 / 代表者 = anchor)は、誰であっても削除不可。
  - `MemberEntry` に `role`(admin/staff)と `isAnchor` を追加。モーダルの `canRemove` 判定に反映。
- [x] チャット参加メンバー・発言者の担当者単位表示(PR #43)。

### 📱 探す・管理画面の UX 調整(2026-09-11, PR #48)
- [x] 実績報告と評価入力: 評価コメントを**任意**に(`ManagementPage.tsx` の textarea から `required` を除去。ラベル/プレースホルダーを「(任意)」表記に)。空コメントでも送信可(★1時の異議理由は空ならデフォルト文言を自動補完)。
- [x] 案件管理「掲載案件・選考」: `myJobs` を**掲載中優先**でソート(募集中→掲載締切→過去の案件→募集停止、同グループ内は応募締切の近い順)。
- [x] 探すリストのハート: お気に入りは**即トグルのみ**。「お気に入りの保存先」モーダル・フォルダ分類(`folderModalState` / `handleAddFolder` / `handleAddToFolder` / `searchPresets` 一式)を削除。
- [x] 探すリスト上部の「現在の検索条件を保存」バー(プリセット保存/呼び出し)を撤去。フィルターシート内の `saveFilters` / `loadFilters` ボタン・`newMatchesCount` バッジも削除。「フィルター未設定 / 設定時はチップ表示」の行は据え置き。
- [x] 「緊急募集の案件を表示する」チェックを、リスト上部から「絞り込み・ソート」シート内(案件モードの並び替え直下)へ移動。state・ロジックは不変。
- [x] (PR #51)緊急案件の**表示/非表示トグルを廃止**。緊急案件は常に一覧・地図に表示し、並び順にかかわらず常に最上部。`includeUrgent` state・`matchesUrgent` フィルタ・シート内チェックを削除。理由: 一度OFFにすると復帰操作をしない限り緊急案件が見えなくなり、見落としリスクがあったため。
- [x] (PR #52)**絞り込み・ソートシートのリニューアル**。
  - キーワード欄を大型化(高さ48px)。即時反映(`tempKeyword` 廃止、`searchKeyword` 直バインド)。
  - 並び替えをアコーディオン廃止・縦リスト単一選択に。案件: 新着/応募締切が近い/開催日が近い/単価高い/単価安い/現在地から近い。人材: 単価安い/単価高い/経験が長い/研修受講数が多い/拠点が近い。「近い順」は位置情報許可時のみ有効(`navigator.geolocation`、`userLocation`)。
  - 絞り込みは全項目を常時表示。見出しに選択数バッジ(`.fg-count`)。
  - 応募締切・最低経験年数はクイック選択チップに。諸経費あり/お気に入りのみはトグル。
  - (PR #53) 単価は**2ハンドルのレンジスライダー**(下限・上限を1本で。`filterMinPrice`/`filterMaxPrice`、0〜50000円/1000刻み、上限50000は「上限なし」扱い)。名称は「単価」。`.price-range` CSS。
  - (PR #54 → #55) 案件カードの「緊急募集」を回転リボン→**カード上部フルワイドの赤帯**に変更(`.job-card-urgent-badge`、`margin: -20px -20px 14px` で padding を打ち消し)。お気に入り♡・締切バッジと非干渉。
  - フッターは「◯件/◯名を表示」(合致件数ライブ表示)＝閉じるだけ。
  - **都道府県フィルタ**(`src/utils/prefectures.ts`: `PREFECTURE_REGIONS`(8地域47件)/`ALL_PREFECTURES`/`getPrefecture`/`matchesPrefectureFilter`)。地域別・複数選択・検索付きのサブシート(`isPrefPickerOpen`)。案件は `locationName`、人材は `baseLocation` の先頭一致。`filterPrefectures` は案件・人材で共通。
  - `parseExperienceYears` / `countRealTrainings` ヘルパーを新設。
  - `activeFiltersCount` / `clearAllFilters` を新フィルタに対応。リスト上部チップに都道府県・諸経費・経験・お気に入りを追加。
- [x] (PR #56)**案件リストカードのコンパクト化**。高さ約270px→約140px。説明文・独立した住所行・jobCode・ホバー矢印を削除。会社名＋エリア(`getCityArea` で市区まで)＋取引実績を1行に統合。タグは3つ(キャリア/販路/職種、勤務形態は省略)。単価パネル(グレー囲み)を廃止し「📅 日程 ・ 締切バッジ / ¥単価」の1行に。padding 20→14px。`getCityArea`(`prefectures.ts`)を新設。

### 🐛 発見済みバグ(未修正・要設計判断)

- [x] **内定承諾時の「競合他社の自動不採用」処理が、同じチャットの無関係な別案件への応募まで不採用にしてしまう** — PR #21 で解消
  - 解消方法: `evaluations.jobStates` マップ(第2段階)を導入し、自動不採用ループを `api.updateContractTaskJobStatus(t.id, job.id, 'rejected')` に変更。当該案件のみ `rejected` になり、同じ直接チャットの別案件は影響を受けない。チャット単位 `status` には「最も進んだ案件の状態」を書き戻すため、`relatedTasks`/`channels`/`BottomNav` 等の既存参照も後方互換を維持。データ層で再現シナリオを検証済み(jobA=rejected / jobB=applying のまま)。
  - 発生箇所: [src/pages/MessagePage.tsx:1009-1037](src/pages/MessagePage.tsx) `handleAcceptUnofficialOffer` 内。
  - 内定が承諾されると、同じ案件(`job.id`)に応募していた他社の`ContractTask`(直接チャット)を検索し、`api.updateContractTaskStatus(t.id, 'rejected')` で一括不採用にする処理があるが、この`status`は**チャット単位**のフィールドであり、**案件単位**ではない。
  - 一方、応募情報自体は`evaluations.appliedJobIds`という配列で、同じ1つのチャット(直接取引のある2社間)を通じて**複数の異なる案件に同時に応募できる**設計になっている(これは「応募日の使い回し」バグ([todo.md参照](#【発見・修正済みのバグ2026-08-24))で扱ったのと同じデータモデル)。
  - 再現シナリオ: A社とB社が1つの直接チャットで、案件X・案件Yの両方に応募中(両方とも`status: 'applying'`)だとする。B社が案件Xについて別の会社に内定を出し、その会社が承諾すると、このロジックがA社のチャットを「案件Xの落選候補」として検出し`status: 'rejected'`に更新する。しかし`status`はチャット全体に1つしかないため、**まだ選考中だったはずの案件Yへの応募も一緒に「不採用」扱いになってしまう**(「応募状況・履歴」画面は`task.status`をそのまま使って各案件の状態を表示するため、案件Yも「見送り/辞退」と誤表示される)。
  - 直し方の方向性: 応募日と同様に、案件ごとのステータスを持つマップ(例: `evaluations.appliedJobStatuses: { [jobId]: status }`)を導入し、チャット全体の`status`と分離する必要がある。ただし`status`は`relatedTasks`のフィルタリング・`channels`のステータス表示・`BottomNav`の未読/件数バッジなど広範囲から参照されているため、影響範囲の大きい設計変更になる。単純な差分修正では収まらないため、対応方針を要相談。
  - 発見日: 2026-08-25(バグ調査中)。

### 🚨 緊急: `.env` の秘密情報がgit管理下で漏洩している
`.env` が `.gitignore` に含まれておらず、実際の値のままGitHubリポジトリにコミット・pushされている状態(2026-08-24発見、[PR #1](https://github.com/seals-applications/connexy/pull/1) 対応中に発覚)。

- [x] `.env` を `.gitignore` に追加する
- [x] `git rm --cached .env` でgit管理から除外する
- [x] `.env.example`(ダミー値)を追加する
- [ ] `.env.example` をREADMEからリンクする(PR #1のREADME改修とあわせて対応)
- [ ] Google Maps APIキー(`VITE_GOOGLE_MAPS_API_KEY`)にHTTPリファラー制限をかける、または新しいキーに差し替える
- [ ] Supabase anon key(`VITE_SUPABASE_ANON_KEY`)をローテーションし、対象テーブルのRLSポリシーを確認・強化する
- [ ] 必要であれば過去のcommit履歴からも秘密情報を除去する(`git filter-repo`等)

⚠️ **注意**: 上記のgit管理からの除外は今後のコミットに`.env`が含まれなくなるだけで、**過去のコミット履歴には既に実際のキーが残ったまま**です。GitHub上で既に公開されてしまった鍵そのものを無効化するには、上記のAPIキーのローテーション/制限が別途必須です。

### 🚨 緊急: `companies`テーブルのRLSが平文パスワードをanonキーで全公開している(2026-08-25 セキュリティレビューで発見)
`supabase/01_security_rls.sql` の `companies` テーブル向けポリシーを精査した結果、**現状の設計のまま本番Supabaseプロジェクトへ適用すると、企業アカウントの`login_id`・平文`password`が誰でも(公開anonキーだけで)閲覧可能になる**、極めて深刻な認証情報漏洩の脆弱性を確認した。

- **該当ポリシー**: `CREATE POLICY "Allow public read access for companies" ON public.companies FOR SELECT USING (true);`（[supabase/01_security_rls.sql](supabase/01_security_rls.sql) 11-13行目）
- **なぜ深刻か**:
  - `companies.password` は暗号化されずDBに平文で保存されている(`src/data/mockDb.ts` `login()`/`registerCompany()` は `password` カラムをそのまま比較・挿入しており、`src/lib/crypto.ts` の `encryptData`/`decryptData`(モック実装のBase64相当)はスタッフのローカルストレージ用途にのみ使われ、`companies`テーブルの`password`カラムには一切適用されていない)。
  - RLSのSELECTポリシーは行単位の制御であり、`USING (true)` は「どのカラムを問い合わせても全行を返す」ことを意味する。クライアント側コードが`select('*')`しか使っていなくても、**攻撃者は公開anonキーだけを使い、直接 `supabase.from('companies').select('login_id,password')` のようなリクエストを送れば、全企業の平文ログインID・パスワードを取得できる**。
  - 公開anonキー自体も既にgit履歴上で漏洩済み(上記`.env`問題)であり、悪用のハードルが極めて低い。
- **根本原因(設計上の問題)**: このRLSスクリプト全体が `auth.uid()`（Supabaseネイティブ認証のユーザーID）を前提に書かれているが、本アプリのログイン処理(`src/data/mockDb.ts` `login()`)は `supabase.auth.signIn`等のSupabase Auth機能を一切使わず、anonキーで直接 `companies`/`staffs` テーブルに対して `login_id`/`password` の一致を問い合わせる自前実装になっている。そのため`auth.uid()`は常に`null`となり、`auth.uid() = id` 等を使う更新系ポリシー（`staffs`・`jobs`・`talents`・`contract_tasks`含む全テーブル）は**実質的に誰の書き込みも通さない**（過剰に厳しい）一方、SELECT系の `USING (true)` ポリシー（`companies`・`jobs`・`talents`）は**行の中身を無条件に全公開する**（過剰に緩い）という、両極端な機能不全に陥っている。
- [ ] `companies`テーブルの認証情報(`login_id`/`password`)を、パスワード検証を伴わない一般公開プロフィール用の列と分離する(例: `companies_public`ビューを作成し、`password`列を含まない列のみを公開、anonロールには`companies`本体への直接SELECTを許可しない)
- [ ] ログイン処理をクライアント側の直接パスワード列比較から、`SECURITY DEFINER`のPostgres関数(RPC)経由のサーバーサイド検証に置き換える(anonキーが`password`列を直接参照できないようにする)
- [ ] 上記の対応と合わせて、`companies.password`をハッシュ化して保存する(現状は平文)
- [ ] `auth.uid()`前提のRLSポリシー全体を、実際の認証方式(Supabase Authを使わない自前ログイン)に合わせて設計し直す

⚠️ **注意**: このファイルは「Supabase SQLエディタで実行して設定する」ためのスクリプトであり、実際に本番プロジェクトへ適用済みかは本セッションからは確認できていない。ただし、`.env`の秘密情報漏洩と合わせて考えると、**このスクリプトが意図通りに適用されていたとしても、されていなくても、平文パスワードが公開anonキー経由で閲覧できる状態になっている可能性が高い**ため、最優先で確認・対応が必要。

### 🚨 緊急: Supabase接続情報がソースコードにハードコードされたフォールバック値として残っている
`src/lib/supabase.ts` の3-4行目で、`import.meta.env`の環境変数が未設定の場合のフォールバックとして、実際のSupabaseプロジェクトURLと**anonキーの実値**がソースコードに直接ハードコードされ、gitで追跡されている(コミット`a56b692`で追加)。

- 上記「Supabase anon keyをローテーションする」対応を`.env`/GitHub Secrets側だけで行っても、このハードコードされた値が古いままだと、環境変数が未設定な環境(フォーク先、別のデプロイ環境など)でビルドした場合に**無効化したはずの古いキーがフォールバックとして使われ続けてしまう**。
- [ ] `VITE_SUPABASE_ANON_KEY`をローテーションする際は、`.env`/GitHub Secretsだけでなく`src/lib/supabase.ts`内のハードコードされたフォールバック値も必ず同時に更新する(あるいはフォールバック自体を削除し、環境変数未設定時はエラーで起動を止める方が安全)

### 🔐 セキュリティ・情報保護(プライバシーマーク取得準備)
- [ ] **将来的なプライバシーマーク（Pマーク）の取得対応**
  - [ ] **位置情報（GPS）取得の明確な同意取得フロー**:
    - [ ] GPS打刻時に、位置情報の取得目的（出勤確認目的のみに使用等）を明記したポップアップ表示と初回同意確認機能の実装。
  - [ ] **チャット内の個人情報保護強化**:
    - [ ] `maskContactInfo` 関数による電話番号・メールアドレス等の自動マスキング（伏字化）ロジックの判定精度の向上。
  - [ ] **データベースアクセスのセキュリティ強化**:
    - [ ] SupabaseのRLS（Row Level Security / 行レベルセキュリティ）ポリシーの再検証と、企業間でのデータ完全分離の厳密化。
    - [ ] 保存データ（個人情報関連カラム）の暗号化の検討。
  - [ ] **個人情報保護規定（PMS）関連の文書化支援**:
    - [ ] システム内の個人情報保護管理規定（取扱手順）のドキュメント作成。

### 🧩 仕様書作成時に見つかった、対応容易ではない不備・未実装事項
- [ ] 案件の新規作成・編集・複製フォームの導線が「管理」画面内に見当たらない(別画面がある想定だが要確認)
- [ ] Talentの実名(`name`)がUI非表示なのにクライアント側データには含まれている(実バックエンド接続時にAPI層でのマスキングが必要)(2026-08-25追記: `supabase/01_security_rls.sql`の`talents`テーブルSELECTポリシーが`USING (true)`で全カラム公開のため、Supabase接続時はanonキーで`name`列を直接取得できてしまう。上記の「🚨 緊急: companiesテーブルのRLSが平文パスワードをanonキーで全公開している」と同根の問題)
- [ ] Google Maps(表示)とNominatim/OpenStreetMap(ジオコーディング)のプロバイダ混在(利用規約・レート制限リスク)
- [ ] エリア検索が新宿・渋谷・池袋の3エリア固定で、地図連携があるのに半径検索ができない
- [ ] 異議あり(`disputed`)を「管理」画面から解消する導線が見当たらない
- [ ] ダッシュボードの入出金額・手数料内訳が固定値表示で、実際の`price`/手数料率からの計算になっていない
- [ ] GPS打刻が実測位ではなく「シミュレーターON/OFF」のみ
- [ ] 分析・ダッシュボードの指標が2つのみで、スタッフ向けメニュー説明にある「獲得報酬総額」「高評価率」が未実装
- [ ] 決済連携(Stripe)が「デモモードです」アラートのみのスタブ
- [ ] 出勤管理のNG日設定カレンダーが「2026年7月」に固定、年月選択ができない
- [ ] 選考時の候補企業スコアリングが4社の固定モックデータで、実際の登録企業を検索していない

---

## ✅ 完了済みのタスク

### 🐛 発見・修正済みのバグ(2026-09-08)
- [x] **【最重要・実機確認済み】「管理」画面の候補者選考から送った内定オファーは、相手が「承諾する」を押しても契約が一切成立しない致命的な問題を修正**
  - 発生箇所: [src/pages/MessagePage.tsx](src/pages/MessagePage.tsx) の `relatedJob`(案件情報解決)、`handleAcceptUnofficialOffer`(内定承諾)、`handleDeclineUnofficialOffer`(内定辞退)。
  - チャット⇔案件の紐付けには2つの経路がある: ① 案件応募(`handleJobApplication`)経由は `evaluations.appliedJobIds` 配列に案件IDを保存、② 管理画面からの内定オファー送信(`handleConfirmOrderSubmit`)経由は `evaluations.offeredJobId` という別のキーに案件IDを保存する。しかし上記3箇所はいずれも `appliedJobIds[0]` しか見ておらず、`offeredJobId` を一切参照していなかった。
  - 影響: ②の経路(管理画面の「候補者の選考」→「内定をオファー」)で送られた内定は、`appliedJobIds` が空配列のままなので `relatedJob` が常に`null`になり、
    - 「内定通知書」モーダルが案件コード「未発行」・契約単価固定「15,000円 / 日」という**実際とは異なる誤った契約条件**を表示する
    - 相手が「承諾する」を押しても `handleAcceptUnofficialOffer` 内で対象案件が見つからず`alert('対象の案件が見つかりません。')`が出るだけで**契約(ContractTask)もグループチャットも一切作成されない**(サイレントに失敗し、送信側には何も伝わらない)
  - 実機確認: 新規案件を作成し、管理画面の候補者選考から内定オファーを送信 → 内定通知書に「案件コード: 未発行」「契約単価: 15,000円 / 日」という誤情報が表示され、「承諾する」を押しても状態が`offered`のまま変化しないことを確認。修正後は正しい案件コード・実際の契約単価(30,000円)が表示され、承諾操作で`working`状態への遷移・現場グループチャットの自動作成まで正常に完了することを確認済み。
  - 修正: `relatedJob`・`handleAcceptUnofficialOffer`・`handleDeclineUnofficialOffer` の3箇所で、`appliedJobIds?.[0]` に加えて `offeredJobId` もフォールバックとして参照するよう修正(スタッフIDも同様に `appliedJobStaffIds` に加えて `offeredStaffId` を参照)。
  - 発見日: 2026-09-08(バグ調査中、実機確認済み)。
  - 追記: 同根の見落としが残っていた `handleAcceptUnofficialOffer`内の「競合他社の自動不採用」ループと`hasApplications`(いずれも他チャットの`appliedJobIds`のみを見て`offeredJobId`を見ていなかった)も、同日中に追加で修正済み。

- [x] **「確定実績・請求データ一括CSV出力」のステータス表示が、`completed`/`working`以外すべて「稼働準備中」と誤表示される問題を修正**
  - 発生箇所: [src/pages/ManagementPage.tsx](src/pages/ManagementPage.tsx) `handleBulkExportCSV`。
  - ステータス表示が `completed ? '完了' : working ? '進行中' : '稼働準備中'` という3択のみで、`report_pending`(報告待ち)・`disputed`(異議あり)・`applying`(選考中)・`offered`(内定通知中)・`rejected`/`declined`(不成立)といった実際に発生しうる他のステータスがすべて「稼働準備中」に丸め込まれていた。特に不採用・辞退案件まで「稼働準備中」と表示されるのは実績データとして誤解を招く。
  - 修正: 実際に存在する全ステータスに対応するラベルを追加。
  - 発見日: 2026-09-08(バグ調査中)。
  - 発生箇所: [src/pages/MessagePage.tsx:582-588](src/pages/MessagePage.tsx) `isClient`。
  - `relatedJob`(チャットに紐づく案件)が解決できる場合は正しく`job.authorId`との比較で判定していたが、`relatedJob`が無い場合のフォールバックが `currentUser.id === 'sigma'` という特定のデモアカウントIDの決め打ちになっていた。
  - `relatedJob`は「案件応募」経由のチャットでのみ設定され、人材への「メッセージを送る」(スカウト)経由のチャット(`handleStartTalentChat`)や、一部のグループチャットでは常に`null`になるため、**sigma以外の全企業にとって、案件と紐付かないチャットでは常に`isClient`が`false`(発注側ではないと誤判定)になり、逆にsigmaでログインしている場合は本来発注側でなくても`isClient`が`true`になってしまう**、頻繁に発生しうるバグだった。`isClient`は「条件を編集」ボタン表示、経費申請の送信/承認可否など複数のUI許可判定に使われている。
  - 修正: `relatedJob`が無い場合は、チャット作成時に記録される`relatedTask.clientName`と`currentUser.name`を比較するフォールバックに置き換え(スカウト開始時に`clientName = currentUser.name`として保存されているため)。案件ID・企業IDに基づくより堅牢な判定にするには、`saveContractTaskChat`側で`client_id`/`agency_id`を全チャット作成経路で保存するスキーマ変更が必要(今回は名前ベースの比較による最小修正に留めた)。
  - 発見日: 2026-09-08(バグ調査中)。

- [x] **案件応募時、`saveContractTaskChat`に渡す`clientName`/`workerName`引数が発注企業と応募企業で入れ違っていた問題を修正**
  - 発生箇所: [src/pages/SearchPage.tsx](src/pages/SearchPage.tsx) `handleJobApplication`。
  - `clientName`には応募している自社(`currentUser.name`)、`workerName`には案件の発注企業(`authorName`)を渡していたが、これは意味が逆。同ファイル内の「人材へのスカウト・メッセージ送信」系処理(`handleSendBulkScout`/`handleStartTalentChat`)では、`currentUser`が発注(スカウトする)側なので`clientName = currentUser.name`が正しいが、`handleJobApplication`では逆に`currentUser`が応募する側(受注側)であるため、正しくは`clientName = authorName`(発注企業)・`workerName = currentUser.name`(応募企業)であるべきだった。
  - 影響: `ManagementPage.tsx`の`relatedTasks`は`t.clientName === currentUser.name`で「自社が発注者かどうか」を判定しているため、この入れ違いにより発注企業側が自社の案件への応募チャットを「報告・評価」等の一覧で正しく拾えなくなる、応募側も同様に正しく拾えなくなる、という不整合が生じていた。`saveContractTaskChat`は既存タスクへの2回目以降の呼び出しでは`client_name`/`worker_name`を更新しない実装のため、この修正は新規に作成されるチャットにのみ効果がある。
  - 発見日: 2026-09-08(バグ調査中)。

- [x] **候補者への内定オファー送信時、`saveContractTaskChat`に渡す案件名・相手企業名の引数が入れ違っていた問題を修正**
  - 発生箇所: [src/pages/ManagementPage.tsx](src/pages/ManagementPage.tsx) `handleConfirmOrderSubmit`。
  - `saveContractTaskChat(taskId, messages, jobTitle, clientName, workerName, ...)` の呼び出しで、`jobTitle`引数に案件タイトル(`activeScreeningJob.title`)ではなく候補者企業名(`confirmingCandidate.company.name`)を渡し、`workerName`引数には候補者企業名の代わりに発注企業自身の名前(`currentUser?.name`、`clientName`と同じ値)を渡していた。
  - 影響: このチャットの`jobTitle`が案件タイトルの代わりに候補者企業名になってしまい(チャット一覧のタイトル表示等に波及)、`workerName`が発注企業自身の名前になるため、スタッフ名との突合(出勤ログ・CSV出力での案件コード解決等、`t.workerName`を参照する箇所)が正しく機能しなくなる。
  - 修正: `jobTitle`に`activeScreeningJob.title`、`workerName`に`confirmingCandidate.company.name`を渡すよう訂正。
  - 発見日: 2026-09-08(バグ調査中)。

- [x] **`unmapStaff`が、暗号化したスタッフのパスワードを保存直前に削除してしまい、Supabase本番環境ではスタッフのパスワードが一切永続化されない問題を修正**
  - 発生箇所: [src/data/mockDb.ts](src/data/mockDb.ts) `unmapStaff`。`row.password = encryptData(staff.password); delete row.password;` という実装になっており、暗号化した値をセットした直後に同じキーを削除していたため、`addStaff`/`updateStaff`がSupabaseへ送信する行データに`password`が一切含まれていなかった。
  - 他のcamelCase→snake_caseへの変換フィールド(`userId`→`user_id`等)は「新しいキーを設定→古いキーを削除」というパターンだが、`password`はキー名の変更が不要なため、このパターンをそのままコピーしたことで自分自身を削除してしまっていたとみられる。
  - 影響がこれまで表面化しなかった理由: `addStaff`/`updateStaff`はこの関数呼び出しの直前に`localStorage.setItem('staff_password_' + id, ...)`で平文パスワードを別途キャッシュしており、読み込み時(`mapStaff`)もこのローカルキャッシュを優先して使う(`decryptData(localPassword || row.password)`)ため、同一ブラウザ内で動作確認する限りは問題が隠れていた。実際のSupabase接続環境で別のブラウザ・端末からログインしようとすると、DBの`password`列が空のため認証に失敗する。
  - 修正: 誤って追加されていた `delete row.password;` を削除。Node上でシミュレートし、修正前は`password`フィールドが行データから消滅すること、修正後は暗号化→復号の往復が正しく元のパスワードに一致することを確認済み。
  - 発見日: 2026-09-08(バグ調査中)。

### 🐛 発見・修正済みのバグ(2026-08-25)
- [x] **経費申請の承認時、「車移動(car)」区分が「宿泊費」と誤表示される問題を修正**
  - `handleApproveReceipt` 内の承認完了メッセージ・システムログで使っていたカテゴリ名の2分岐(`transport`/それ以外)を、`accommodation`/`car`を区別する3分岐に修正 ([src/pages/MessagePage.tsx](src/pages/MessagePage.tsx))。申請時(`handleSendReceipt`)は元々正しい3分岐だった。

### 🐛 発見・修正済みのバグ(2026-08-24)
- [x] **案件応募時のシステムメッセージの発注企業名が、ハードコードされた4社以外だと汎用テキスト「パートナー企業」になり、4社分の名前も実際の登録名と食い違っていた問題を修正**
  - `handleJobApplication` 内のハードコードされた三項演算子チェーンを、同ファイル内の他箇所と同じ `allUsers.find(u => u.id === selectedJob.authorId)?.name` によるルックアップに置き換え ([src/pages/SearchPage.tsx](src/pages/SearchPage.tsx))。
- [x] **CSV一括登録(案件・人材)で、フィールド内にカンマが含まれていると列がずれる問題を修正**
  - クォート・エスケープに対応した簡易CSVラインパーサー `parseCsvLine` を追加し、`line.split(',')` を置き換え ([src/pages/SearchPage.tsx](src/pages/SearchPage.tsx))。Node上でクォート付きカンマ・エスケープ済みダブルクォートの3パターンを検証済み。
- [x] **「応募状況・履歴」で、同じチャット内の複数応募の応募日が使い回される問題を修正**
  - `evaluations.appliedJobIds` に加えて案件ごとの応募日を保持する `evaluations.appliedJobDates: { [jobId]: dateString }` を新設 ([src/data/mockDb.ts](src/data/mockDb.ts) `saveContractTaskChat`)。
  - 「応募状況・履歴」画面は `t.date`(チャット作成日)ではなく `appliedJobDates[jobId]` を参照するよう修正 ([src/pages/ManagementPage.tsx](src/pages/ManagementPage.tsx) `myApplications`)。
- [x] **完了報告(遅刻なし)提出時に出勤ログの出勤時間が`undefined`になる問題を修正**
  - 完了報告フローで生成する出勤ログタグを、他の生成箇所と同じ `ATTENDANCE_LOG_<日付>_<時刻>_<OK|LATE>` の3セグメント形式に統一 ([src/pages/ManagementPage.tsx](src/pages/ManagementPage.tsx) `handleReportSubmit`)。
- [x] **国際表記(+81-90-...)の電話番号がチャットの連絡先マスキングをすり抜ける問題を修正**
  - `maskContactInfo` の電話番号用正規表現に任意の `+81` 国番号プレフィックスを許容するパターンを追加し、国内・国際どちらの表記でもマスキングされることをブラウザで確認済み ([src/pages/MessagePage.tsx](src/pages/MessagePage.tsx))。
- [x] **分析・ダッシュボードが自社データではなく全社(プラットフォーム全体)のデータを集計していた問題を修正**
  - 未絞り込みの `tasks` ではなく、自社分に絞り込み済みの `relatedTasks` を集計に使うよう修正 ([src/pages/ManagementPage.tsx](src/pages/ManagementPage.tsx))。
- [x] **設定画面「自社プロフィール編集」で、インボイス登録番号だけ編集内容が保存されない問題を修正**
  - インボイス番号欄が `defaultValue` の非制御入力で `onChange` も無く、`handleProfileSave` の保存対象にも含まれていなかったため、編集して「保存」を押しても変更が破棄されていた。他の項目と同様に `invoiceNumberInput` state を追加し `value`/`onChange` で制御、保存処理にも追加 ([src/components/SettingsDrawer.tsx](src/components/SettingsDrawer.tsx))。
- [x] **新規会社登録申請フォームの「代表者名」が、入力しても保存されない問題を修正**
  - フォーム自体は state・`onChange` を備えていたが、`handleSignupSubmit` が `api.registerCompany` 呼び出し時に `representativeName` を渡していなかった。加えて `registerCompany` 側もこのフィールドをローカルストレージ・DB行のどちらにも保存していなかったため、渡しても永続化されなかった。両方を修正し、代表者名を入力欄の値で送信・保存するよう対応 ([src/pages/LoginPage.tsx](src/pages/LoginPage.tsx), [src/data/mockDb.ts](src/data/mockDb.ts) `registerCompany`)。
- [x] **マッチング成立後（`working`/`completed`）のチャットで、連絡先の自動マスキングが解除されない問題を修正**
  - `maskContactInfo` は `status === 'contracted'` のみをマスキング除外対象にしていたが、応募→内定→承諾のフローで成立したチャットは実際には `working`（進行中）や `completed`（完了）ステータスになり、`contracted` には決してならない。同ファイル内の氏名表示ロジック（`isClient || status === 'group' || status === 'contracted' || status === 'working' || status === 'completed'`）と同じ判定基準に合わせ、`working`/`completed` もマスキング除外に追加 ([src/pages/MessagePage.tsx](src/pages/MessagePage.tsx) `maskContactInfo`)。
- [x] **チャット内の経費申請・手配情報共有・写真送信・精算承認/差戻しで、取引先企業名がハードコードされたalpha/beta/sigma以外だと汎用テキストになっていた問題を修正**
  - 案件応募時のシステムメッセージで既に修正済みだった「ハードコードされた三項演算子チェーンで企業名を決め打ちする」バグと同種のものが、`handleSendReceipt`・`handleSendArrangement`・`handleSendPhoto`・`handleApproveReceipt`・`handleRejectReceipt` の5箇所に残っていた。チャットIDから相手企業IDを取り出し `allCompanies.find` で解決する方式に統一 ([src/pages/MessagePage.tsx](src/pages/MessagePage.tsx))。
- [x] **契約書未承認バナー表示中、チャット冒頭のメッセージが固定ヘッダーの下に隠れる問題を修正**
  - チャットヘッダーは `position: absolute` かつ高さ可変で、メッセージ一覧側は `headerHeight`(見積り値)を`paddingTop`として確保しているが、「契約書が未承認です」バナーの表示条件がこの見積りに含まれていなかった。バナー表示条件と同じ条件でheaderHeightに加算するよう修正 ([src/pages/MessagePage.tsx](src/pages/MessagePage.tsx) `headerHeight`)。
- [x] **案件投稿フォームで「すべての稼働日で同じ単価を設定する」を一度オフにして日程別単価を入力後、再度オンにすると全日程の単価が未入力状態(0円)の共通単価で上書きされ、入力済みの単価が消える問題を修正**
  - チェックボックスをオンにする瞬間、既存の日程別単価から代表値を引き継いでから同期するよう変更し、意図せず0円で全日程が上書きされることを防止 ([src/pages/SearchPage.tsx](src/pages/SearchPage.tsx) `handleToggleSamePrice`)。
- [x] **スタッフ登録時に人材(Talent)としても登録する際の「希望勤務日」が年なし・ゼロ埋めなしの `M/D` 形式で保存され、表示時の日付ソート・連続日程のとりまとめが壊れる問題を修正**
  - 案件の`eventDate`と異なり、この画面だけ独自に年なし`M/D`形式へ変換してから保存していたため、共通の表示ユーティリティ`formatJobDates`（`YYYY-MM-DD`前提でソート・Date変換する)に渡すと文字列としての辞書順ソートが崩れていた。`eventDate`と同じくISO形式のまま保存し、表示側で`formatJobDates`を通すよう統一 ([src/pages/SearchPage.tsx](src/pages/SearchPage.tsx))。
- [x] **CSV一括登録のプレビュー画面で、列数不足の行が無言でスキップされ、以降の行のエラー表示がずれて別の行に表示される問題を修正**
  - エラーの`rowIndex`が元ファイルの行番号(空行や列数不足行を含む)基準、プレビュー表の行番号が実際に取り込めた行の並び順基準と、2つの異なる基準で採番されていたため、一度でも行がスキップされるとズレて無関係な行にエラーメッセージが表示されていた。両者を同じ「表示行番号」カウンタで揃え、列数不足の行もプレースホルダーとしてプレビューに表示してエラー内容を確認できるよう修正 ([src/pages/SearchPage.tsx](src/pages/SearchPage.tsx) `handleCsvFileUpload`)。

### 🔧 仕様上の不備の解消(2026-08-24)
- [x] **ログイン画面のデバッグパネルから、全社・全スタッフの平文ログインID/パスワード表示を削除**
  - 会社承認(承認/却下/保留)機能自体は他に代替手段がないため維持しつつ、認証情報の平文表示のみを削除([src/pages/LoginPage.tsx](src/pages/LoginPage.tsx))。本番リリース前には、この管理ツール自体を認証済み管理者専用の別画面に移す対応が別途必要。
- [x] **アカウント承認ステータス(`pending`/`rejected`)のルートガードをアプリ全体に追加**
  - これまではログイン処理の中でのみ`pending`/`rejected`を弾いており、既にログイン済みのセッションが後から承認取り消しされた場合にアプリ側で検知できていなかった。`App.tsx`の起動時ユーザー確認処理でも`status !== 'approved'`なら強制ログアウトするよう修正([src/App.tsx](src/App.tsx))。
- [x] **内定「辞退」と「不採用」が同じ`rejected`ステータスで区別できない問題を解消**
  - `ContractTask.status`に`declined`を追加し、応募者側の辞退操作(`handleDeclineUnofficialOffer`)は`declined`を書き込むよう変更。関連するバッジ表示・ボタン制御箇所を対応([src/data/mockDb.ts](src/data/mockDb.ts), [src/pages/MessagePage.tsx](src/pages/MessagePage.tsx))。「応募状況・履歴」画面は元々`rejected`/`declined`の両方を「見送り/辞退」として表示する実装だったため、表示側の変更は不要だった。

### 📱 ダッシュボード・入出金管理機能の刷新
- [x] **「入金予定額」および「振込予定額」カードの追加・実装** (`src/pages/DashboardPage.tsx`)
  - [x] 稼働月の翌月末の支払いサイクルに基づいた動的な月名表記（例：「7月入金予定額（6月稼働分）」）の自動算出。
  - [x] 予定額カードをタップした際の詳細明細画面（サブビュー）へのアニメーション遷移の実装。
  - [x] 明細画面における戻るボタン（`arrow_back_ios_new`）の配置・カラー・挙動の修正。
- [x] **予定詳細における手数料等の差し引き計算の追加** (`src/pages/DashboardPage.tsx`)
  - [x] 入金予定明細での売上総額表示。
  - [x] 振込予定明細における「10%マッチング手数料（自動計算）」および「7.5%早期出金手数料（即時振込申請時）」の差し引き内訳表示。
  - [x] 早期出金（即時振込）申請モックアクションの実装。

### 🏷️ 案件識別・案件コードの自動発行
- [x] **一意の「案件コード (jobCode)」の自動生成と各画面への統合**
  - [x] 新規案件掲載（作成）時に自動で `JOB-XXXXXX` 形式のコードを自動発行・保存するロジックの実装 (`src/data/mockDb.ts`)。
  - [x] 過去のシード案件に対しても一意のハッシュから固定コードを自動算出するフォールバック処理の実装 (`src/data/mockDb.ts`)。
  - [x] 案件一覧、詳細モーダル、チャットの条件ヘッダー、内定通知、およびダッシュボード明細内における `【JOB-XXXXXX】` 形式への表記置換。
  - [x] 日次出勤ログへの案件コード付与と、CSV出力時の「案件コード」列の追加 (`src/pages/TaskPage.tsx`)。

### 💬 トークルーム（チャット）内のUI改善・内定オファーのモーダル化
- [x] **チャット画面ヘッダーの整理** (`src/pages/MessagePage.tsx`)
  - [x] 「同期（更新）」および「通報」ボタンの非表示化と右側のスペーサー配置。
  - [x] スクロールバーの上下矢印（ボタン）の非表示化の強化 (`src/index.css`)。
- [x] **内定通知オファーの吹き出し表示統合** (`src/pages/MessagePage.tsx`)
  - [x] チャット中央のシステムメッセージ表示から、送信者・受信者の吹き出し内カードデザインへの変更。
  - [x] プレミアム感のあるゴールドを基調としたカードデザインと「内定通知を開く」ボタンの配置。
- [x] **確認・承諾・辞退のダブル確認フローモーダルの実装** (`src/pages/MessagePage.tsx`)
  - [x] ボタンタップ時に立ち上がる詳細プレビュー（企業名、案件、単価、日程、勤務地）の実装。
  - [x] 「承諾」「辞退」それぞれの決定時に誤操作を防ぐ「最終確認画面」へのモーダル内画面遷移。
- [x] **参加メンバー一覧表示モーダルの追加** (`src/pages/MessagePage.tsx`)
  - [x] チャット右上ヘッダーへのメンバー一覧ボタン（グループアイコン）の追加と一覧モーダルの実装。
- [x] **「経費申請」への表記統一と制限解除** (`src/pages/MessagePage.tsx`)
  - [x] 「領収書提出」から「経費申請」への文言変更。
  - [x] 交通費・宿泊費の別途支給設定の有無に関わらず、全ての案件で経費申請を行えるよう制限を撤廃。
