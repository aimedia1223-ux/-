import { useRef } from 'react';
import { reviewBuildLabel } from '../lib/reviewBuild';

export function ReviewNotice() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <aside className="test-data-notice" role="note">
      <span>機能・デザイン確認用：架空データのみ</span>{' '}
      <button type="button" onClick={() => dialog.current?.showModal()}>確認ガイド</button>
    </aside>
    <dialog ref={dialog} className="review-guide" aria-labelledby="review-guide-title">
      <h2 id="review-guide-title">Connexy 確認ガイド</h2>
      <p>機能と画面デザインを相談するための検証サイトです。実際の案件・個人情報・顧客情報・契約書は入力しないでください。</p>
      <h3>確認してほしいこと</h3>
      <ul>
        <li>スマホ・パソコンでの文字の読みやすさ、余白、ボタンの分かりやすさ</li>
        <li>「管理」から案件・スタッフ・責任者を探す流れ</li>
        <li>承諾確認、契約の提示・相手方確認、変更前後の比較と版履歴</li>
        <li>責任者間の連絡、公開概要、監査・削除実施記録</li>
      </ul>
      <p>契約や連絡は、対象の架空案件・承諾・双方の担当者を事前に準備した場合だけ試せます。空の一覧は必ずしも不具合ではありません。</p>
      <h3>現在の制限</h3>
      <p>地図・住所検索、実際の出退勤・支払、電子署名・第三者の時刻証明は今回の確認対象外です。新規登録は管理者が専用アカウントを準備します。</p>
      <p>パスワードを共有せず、案内された自分のアカウントでログインしてください。検証用に追加認証を一時解除したアカウントは、メールアドレスとパスワードでログインできます。共有端末では必ずログアウトしてください。</p>
      <h3>要望の伝え方</h3>
      <p>「画面名」「操作したこと」「こうなってほしい」を教えてください。画面を送る場合もパスワード・認証コード・QRコードは含めないでください。</p>
      <p className="review-build">更新番号：{reviewBuildLabel}</p>
      <form method="dialog"><button type="submit">ガイドを閉じる</button></form>
    </dialog>
  </>;
}
