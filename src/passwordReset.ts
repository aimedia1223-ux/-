import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabasePublicKey } from './lib/supabaseConfig';
import { readRecoveryLink, verifyRecoveryLink, validateNewPassword } from './lib/passwordRecovery';

// メイン画面のA社セッションを読まない。メールの回復トークンだけで本人確認する。
const client = createClient(supabaseUrl, supabasePublicKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'connexy-recovery-only' },
});
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const requestForm = document.querySelector<HTMLFormElement>('#request-form')!;
const passwordForm = document.querySelector<HTMLFormElement>('#password-form')!;
const emailInput = document.querySelector<HTMLInputElement>('#email')!;
const passwordInput = document.querySelector<HTMLInputElement>('#new-password')!;
const confirmationInput = document.querySelector<HTMLInputElement>('#confirm-password')!;
let recoveryUserId: string | null = null;
function message(text: string, error = false) { status.textContent = text; status.dataset.error = String(error); }

// トークンやエラーの原文は画面・ログ・ブラウザ保存へ出力しない。
const hash = window.location.hash;
const link = readRecoveryLink(hash);
window.history.replaceState(null, '', window.location.pathname);

async function initialize() {
  if (link.kind === 'request') {
    requestForm.hidden = false;
    message('メールアドレスを入力してください。');
    return;
  }
  try {
    const user = await verifyRecoveryLink(client.auth, hash);
    recoveryUserId = user.id;
    document.querySelector('#account')!.textContent = user.email || '';
    passwordForm.hidden = false;
    message('本人確認ができました。新しいパスワードを設定してください。');
  } catch {
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    requestForm.hidden = false;
    message('リンクが無効、期限切れ、または接続できません。設定用メールを再送してください。', true);
  }
}

requestForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = requestForm.querySelector('button')!;
  button.disabled = true;
  try {
    const redirectTo = new URL('reset-password.html', window.location.href).href;
    const { error } = await client.auth.resetPasswordForEmail(emailInput.value.trim(), { redirectTo });
    if (error) throw error;
    message('登録されている場合は設定用メールが届きます。メールのリンクをこのパソコンのブラウザで開いてください。');
  } catch {
    message('送信できませんでした。接続とメール設定を確認し、時間をおいて再度お試しください。', true);
  } finally { button.disabled = false; }
});

passwordForm.addEventListener('submit', async event => {
  event.preventDefault();
  const validation = validateNewPassword(passwordInput.value, confirmationInput.value);
  if (validation) { message(validation, true); return; }
  const button = passwordForm.querySelector('button')!;
  button.disabled = true;
  try {
    const verified = await client.auth.getUser();
    if (verified.error || !recoveryUserId || verified.data.user?.id !== recoveryUserId) throw new Error('INVALID_RECOVERY_SESSION');
    const updated = await client.auth.updateUser({ password: passwordInput.value });
    if (updated.error) throw updated.error;
    passwordForm.hidden = true;
    recoveryUserId = null;
    const signedOut = await client.auth.signOut({ scope: 'local' });
    message(signedOut.error
      ? 'パスワードを設定しました。このタブを閉じ、ログイン画面から入り直してください。'
      : 'パスワードを設定しました。ログイン画面で新しいパスワードを入力してください。');
  } catch {
    message('設定できませんでした。パスワードの条件を確認するか、設定用メールを再送してください。', true);
  } finally { passwordForm.reset(); button.disabled = false; }
});
void initialize();
