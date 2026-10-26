import { supabase } from './supabase';
import { parseJobContacts } from './jobResponsibilities';
import type { JobContacts } from './jobResponsibilities';

export type JobSummary = { public_id: string; region: string; category: string };
export type ApprovedJobDetail = {
  title: string; description: string; detailed_description: string | null;
  company_name: string; location_name: string | null; exact_location: string | null;
  work_hours: string | null; event_date: string | null; price: number;
  contacts: JobContacts | null;
};
const regions = ['北海道','東北','関東','中部','近畿','中国','四国','九州・沖縄'];
const categories = ['通信サービスの販売支援','店舗運営支援','イベント運営支援','その他の業務支援'];
const unavailable = '公開概要を取得できません。接続・追加認証・115番SQLの適用を確認してください。';
const denied = '詳細を開示できません。承諾対象の会社・担当者・期間・案件内容と追加認証を確認してください。';

export async function listJobSummaries(): Promise<JobSummary[]> {
  const { data, error } = await supabase.rpc('connexy_list_job_summaries');
  if (error || !Array.isArray(data)) throw new Error(unavailable);
  return data.map(row => {
    if (!row || typeof row.public_id !== 'string' || !regions.includes(row.region) || !categories.includes(row.category)) {
      throw new Error(unavailable);
    }
    // 許可した3項目だけを画面へ渡す。元の案件データを混ぜない。
    return { public_id: row.public_id, region: row.region, category: row.category };
  });
}

export async function readApprovedJob(publicId: string): Promise<ApprovedJobDetail> {
  // 会社ID/スタッフID/承諾済みフラグは送らない。サーバーがログイン本人を確認する。
  const { data, error } = await supabase.rpc('connexy_read_approved_job', { target_public_id: publicId });
  if (error || !data || typeof data.title !== 'string' || typeof data.company_name !== 'string'
    || typeof data.description !== 'string' || !Number.isFinite(Number(data.price))) throw new Error(denied);
  const optional = (key: string): string | null => typeof data[key] === 'string' ? data[key] : null;
  return { title: data.title, company_name: data.company_name, description: data.description,
    detailed_description: optional('detailed_description'), location_name: optional('location_name'),
    exact_location: optional('exact_location'), work_hours: optional('work_hours'),
    event_date: optional('event_date'), price: Number(data.price), contacts: parseJobContacts(data.contacts) };
}
