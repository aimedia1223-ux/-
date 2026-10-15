// エリア検索。従来は locationName の固定文字列一致(新宿/渋谷/池袋)だったが、
// 取得済みの緯度経度を使った中心点からの半径判定に変更する。
// 座標が無いデータには従来の地名一致でフォールバックする。

export interface AreaCenter {
  label: string;
  lat: number;
  lng: number;
  /** 地名フォールバック時に併せて判定する別名(例: 池袋 ⇔ 豊島区) */
  aliases?: string[];
}

/** プリセットエリアの中心座標。座標は mapJob のフォールバックと同じ値。 */
export const AREA_CENTERS: Record<string, AreaCenter> = {
  shinjuku: { label: '新宿', lat: 35.6895, lng: 139.6917 },
  shibuya: { label: '渋谷', lat: 35.658, lng: 139.7016 },
  ikebukuro: { label: '池袋', lat: 35.7295, lng: 139.7109, aliases: ['豊島'] },
};

/** プリセットエリアとみなす、中心からの半径(km) */
export const AREA_RADIUS_KM = 3;

/** 2点間の距離(km)。Haversine。 */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface AreaFilterPoint {
  lat?: number | null;
  lng?: number | null;
  locationName?: string | null;
}

/**
 * `filterArea`(`'all'` / `'shinjuku'` / …)に対して、対象地点が該当するか。
 * 座標があれば中心からの半径で、無ければ地名一致で判定する。
 */
export function isWithinAreaFilter(
  filterArea: string | null | undefined,
  point: AreaFilterPoint,
  radiusKm: number = AREA_RADIUS_KM,
): boolean {
  if (!filterArea || filterArea === 'all') return true;
  const center = AREA_CENTERS[filterArea];
  if (!center) return true;

  const { lat, lng } = point;
  if (typeof lat === 'number' && typeof lng === 'number' && lat !== 0 && lng !== 0 && !isNaN(lat) && !isNaN(lng)) {
    return distanceKm(center.lat, center.lng, lat, lng) <= radiusKm;
  }

  // 座標なし → 地名フォールバック
  const name = point.locationName || '';
  if (!name) return false;
  return name.includes(center.label) || (center.aliases || []).some((a) => name.includes(a));
}
