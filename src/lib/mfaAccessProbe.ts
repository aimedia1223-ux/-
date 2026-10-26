import type { SupabaseClient } from '@supabase/supabase-js';

export type ProbeResult = { label: string; passed: boolean };

// 応答本文・認証情報を返さず、判定結果だけを返す。書込・MFA検証は行わない。
export async function probeBeforeMfa(client: SupabaseClient, expectedUserId: string): Promise<ProbeResult[]> {
  const user = await client.auth.getUser();
  if (user.error || user.data.user?.id !== expectedUserId) throw new Error('ACCOUNT_MISMATCH');
  const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || assurance.data.currentLevel !== 'aal1') throw new Error('AAL1_REQUIRED');
  const results: ProbeResult[] = [{ label: 'Cアカウント・追加認証前の状態を確認', passed: true }];
  const denied = (response: { data: unknown; error: { code?: string } | null }) =>
    response.error?.code === '42501' || (!response.error && Array.isArray(response.data) && response.data.length === 0);
  const identity = await client.rpc('connexy_current_identity');
  results.push({ label: '所属・役割を取得できない', passed: denied(identity) });
  const tables = [
    ['companies', '会社情報'], ['staffs', 'スタッフ情報'], ['jobs', '案件情報'],
    ['talents', '人材情報'], ['contract_tasks', '契約情報'], ['announcements', 'お知らせ'],
  ];
  for (const [table, label] of tables) {
    const response = await client.from(table).select('id').limit(1);
    results.push({ label: `${label}を取得できない`, passed: denied(response) });
  }
  for (const [id, label] of [
    ['connexy-access-test-a', '割当済みのA社案件'],
    ['connexy-access-test-a-unassigned', '未割当のA社案件'],
    ['connexy-access-test-b', 'B社案件'],
  ]) {
    const response = await client.from('jobs').select('id').eq('id', id).limit(1);
    results.push({ label: `IDを直接指定しても${label}を取得できない`, passed: denied(response) });
  }
  const membership = await client.from('connexy_auth_memberships').select('auth_user_id').limit(1);
  results.push({ label: '所属管理表を取得できない', passed: denied(membership) });
  return results;
}
