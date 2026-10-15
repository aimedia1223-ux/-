// マスキング用マスターデータ。
// エリア名・家電量販店・キャリアショップの判定パターンをロジック(src/utils/maskingUtils.ts)から分離。
// 将来的には管理画面から編集できるデータソース(Supabase 等)に載せ替えられるよう、
// パターンは正規表現リテラルではなく「文字列 + フラグ」で持つ。

/** ブランド系マスキングのマスタ1件 */
export interface MaskingBrandPattern {
  /** RegExp のソース文字列(例: "ヤマダ|yamada") */
  pattern: string;
  /** マスク後に使う伏せ名(例: "Yデンキ") */
  label: string;
}

/**
 * extractArea() のフォールバックで使う主要エリア名。
 * 住所文字列にこの語が含まれれば、その語(末尾が「区」「市」でなければ "◯◯エリア")を返す。
 */
export const MAJOR_AREAS: string[] = [
  '新宿', '渋谷', '池袋', '秋葉原', '有楽町', '銀座', '新橋', '品川',
  '上野', '豊島', '葛飾', '足立', '江戸川', '大田', '世田谷', '練馬',
  '杉並', '中野', '北区', '荒川', '台東', '墨田', '江東', '中央区', '港区',
  '千代田', '文京', '板橋', '目黒', '大崎', '五反田', '恵比寿', '原宿',
  '代々木', '大宮', '浦和', '川口', '横浜', '川崎', '吉祥寺', '八王子',
  '立川', '町田', '調布', '府中',
];

/** 家電量販店ブランド → 伏せ名。店名・住所にマッチしたら "◯◯エリアの△△" を返す。 */
export const QUANTITY_STORE_PATTERNS: MaskingBrandPattern[] = [
  { pattern: 'ヤマダ|yamada', label: 'Yデンキ' },
  { pattern: 'ビック|bic', label: 'Bカメラ' },
  { pattern: 'ヨドバシ|yodobashi', label: 'Yカメラ' },
  { pattern: 'エディオン|edion', label: 'E社' },
  { pattern: "ケーズ|k'?s", label: 'Kデンキ' },
  { pattern: 'ノジマ|nojima', label: 'N社' },
  { pattern: '上新|joshin|ジョーシン', label: 'J社' },
  { pattern: 'コジマ|kojima', label: 'K社' },
  { pattern: 'ソフマップ|sofmap', label: 'S社' },
  { pattern: 'ベスト電器|ベストデンキ', label: 'B電器' },
  { pattern: 'マツヤ', label: 'Mデンキ' },
  { pattern: '100満|１００満', label: '100満' },
  { pattern: 'pcデポ|pc depot', label: 'P社' },
  { pattern: 'ラオックス|laox', label: 'L社' },
];

/** キャリアショップ名 → 一般化した呼称。 */
export const CARRIER_SHOP_PATTERNS: MaskingBrandPattern[] = [
  { pattern: 'ドコモ|docomo', label: 'docomoショップ' },
  { pattern: 'au |auショップ|au\\s|^au$', label: 'auショップ' },
  { pattern: 'uqモバイル|uqmobile|uq mobile', label: 'UQモバイルショップ' },
  { pattern: 'ソフトバンク|softbank', label: 'SoftBankショップ' },
  { pattern: 'ワイモバイル|y!mobile|ymobile', label: 'Y!mobileショップ' },
  { pattern: '楽天モバイル|rakuten mobile', label: '楽天モバイルショップ' },
];

/** マスタの pattern 文字列を大文字小文字無視の RegExp に変換する。 */
export function compileBrandPatterns(patterns: MaskingBrandPattern[]): [RegExp, string][] {
  return patterns.map(({ pattern, label }) => [new RegExp(pattern, 'i'), label]);
}
