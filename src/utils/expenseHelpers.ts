// 経費申請のカテゴリラベル。送信・承認・差戻し・表示で表記がバラついていた
// (「公共交通機関」「交通費」/「車移動」「車移動費」)のを統一する。
// PR #7 の「車移動費」バグの遠因だった重複ロジックの集約。

export type ExpenseCategory = 'transport' | 'accommodation' | 'car';

/** 経費カテゴリの表示ラベル。全ハンドラ・表示で共通。 */
export function getExpenseCategoryLabel(category: string | undefined): string {
  switch (category) {
    case 'transport':
      return '交通費';
    case 'accommodation':
      return '宿泊費';
    case 'car':
      return '車移動費';
    default:
      return '経費';
  }
}
