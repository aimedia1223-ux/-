import { supabase } from './supabase';
import type { User } from '../data/mockDb';
import { isSessionLocked, markSessionActive } from './sessionActivity';

// 旧認証は開発中に明示指定した場合だけ利用可能。本番では指定しても無効。
export const legacyDemoAuth = import.meta.env.DEV && import.meta.env.VITE_ENABLE_LEGACY_DEMO_AUTH === 'true';

export class MfaRequiredError extends Error {
  account: { id: string; email: string; factors: { id: string; name: string }[] };
  constructor(account: MfaRequiredError['account']) {
    super('追加認証が必要です');
    this.account = account;
  }
}

export async function getAuthenticatedUser(freshLogin = false): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw assurance.error;
  let temporaryDemoException = false;
  if (assurance.data.currentLevel === 'aal1') {
    // 例外はDB側の検証用アカウント設定で限定する。取得失敗時は追加認証を維持。
    const policy = await supabase.rpc('connexy_mfa_is_required');
    temporaryDemoException = !policy.error && policy.data === false;
  }
  if (!temporaryDemoException && (assurance.data.currentLevel !== 'aal2' || assurance.data.nextLevel !== 'aal2')) {
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    throw new MfaRequiredError({ id: data.user.id, email: data.user.email || '',
      factors: factors.data.totp.map(f => ({ id: f.id, name: f.friendly_name || '認証アプリ' })) });
  }
  // RPCはauth.uid()から本人を特定。ブラウザの会社ID・ロールを信用しない。
  const result = await supabase.rpc('connexy_current_identity');
  if (result.error) throw result.error;
  const identity = result.data?.[0];
  if (!identity || identity.status !== 'approved') return null;
  const user: User = {
    id: identity.company_id,
    name: identity.company_name,
    role: 'contractor',
    status: identity.status,
    staffId: identity.staff_id,
    staffName: identity.display_name,
    staffRole: identity.member_role,
  };
  if (!freshLogin && isSessionLocked(user)) return null;
  return user;
}

export async function loginWithAuth(email: string, password: string): Promise<User | null> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return null;
  try {
    const user = await getAuthenticatedUser(true);
    if (user) { markSessionActive(user); return user; }
  } catch (error) {
    // AAL1のセッションは認証アプリ登録・コード確認のためだけに維持する。
    if (error instanceof MfaRequiredError) throw error;
    await supabase.auth.signOut({ scope: 'local' });
    throw error;
  }
  await supabase.auth.signOut({ scope: 'local' });
  return null;
}
