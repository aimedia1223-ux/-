// 都道府県での絞り込み用マスタ。
// 案件は locationName、人材は baseLocation(なければ locationName)の
// 先頭一致で判定する。

export interface PrefectureRegion {
  name: string;
  prefectures: string[];
}

export const PREFECTURE_REGIONS: PrefectureRegion[] = [
  { name: '北海道・東北', prefectures: ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] },
  { name: '関東', prefectures: ['東京都', '神奈川県', '埼玉県', '千葉県', '茨城県', '栃木県', '群馬県'] },
  { name: '甲信越・北陸', prefectures: ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県'] },
  { name: '東海', prefectures: ['愛知県', '岐阜県', '静岡県', '三重県'] },
  { name: '近畿', prefectures: ['大阪府', '京都府', '兵庫県', '滋賀県', '奈良県', '和歌山県'] },
  { name: '中国', prefectures: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'] },
  { name: '四国', prefectures: ['徳島県', '香川県', '愛媛県', '高知県'] },
  { name: '九州・沖縄', prefectures: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] },
];

export const ALL_PREFECTURES: string[] = PREFECTURE_REGIONS.flatMap((r) => r.prefectures);

/** 住所文字列から都道府県名を取り出す(先頭一致)。判定できなければ null。 */
export function getPrefecture(locationName: string | null | undefined): string | null {
  if (!locationName) return null;
  const name = locationName.trim();
  return ALL_PREFECTURES.find((p) => name.startsWith(p)) || null;
}

/**
 * 住所文字列から「市区郡（＋政令市の区）」までを取り出す。都道府県は落とす。
 * 例: 東京都町田市原町田6丁目 → 町田市 / 神奈川県横浜市西区南幸1丁目 → 横浜市西区
 */
export function getCityArea(locationName: string | null | undefined): string {
  if (!locationName) return '';
  const name = locationName.trim();
  const pref = getPrefecture(name);
  const rest = pref ? name.slice(pref.length) : name;
  const m = rest.match(/^(.+?[市区郡])(.+?区)?/);
  if (m) return m[1] + (m[2] || '');
  return rest || name;
}

/** 選択中の都道府県セットに、対象地点が該当するか(未選択なら常に true)。 */
export function matchesPrefectureFilter(
  selected: string[],
  locationName: string | null | undefined,
): boolean {
  if (!selected || selected.length === 0) return true;
  const pref = getPrefecture(locationName);
  return pref != null && selected.includes(pref);
}
