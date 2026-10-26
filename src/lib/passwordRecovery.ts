import type { SupabaseClient } from '@supabase/supabase-js';

type RecoveryAuth = Pick<SupabaseClient['auth'], 'setSession' | 'getUser'>;

export function readRecoveryLink(hash: string) {
  const parameters = new URLSearchParams(hash.replace(/^#/, ''));
  if (parameters.has('error') || parameters.has('error_code')) return { kind: 'invalid' } as const;
  const access_token = parameters.get('access_token');
  const refresh_token = parameters.get('refresh_token');
  if (!access_token && !refresh_token && !parameters.has('type')) return { kind: 'request' } as const;
  if (parameters.get('type') !== 'recovery' || !access_token || !refresh_token) return { kind: 'invalid' } as const;
  return { kind: 'recovery', tokens: { access_token, refresh_token } } as const;
}

export async function verifyRecoveryLink(auth: RecoveryAuth, hash: string) {
  const link = readRecoveryLink(hash);
  if (link.kind !== 'recovery') throw new Error('INVALID_RECOVERY_LINK');
  const session = await auth.setSession(link.tokens);
  if (session.error) throw new Error('INVALID_RECOVERY_LINK');
  const verified = await auth.getUser();
  if (verified.error || !verified.data.user) throw new Error('INVALID_RECOVERY_LINK');
  return verified.data.user;
}

export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password.length < 12) return 'パスワードは12文字以上で入力してください。';
  if (password !== confirmation) return '確認用のパスワードが一致していません。';
  return null;
}
