import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabasePublicKey } from './lib/supabaseConfig';
import { probeBeforeMfa } from './lib/mfaAccessProbe';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const form = document.querySelector<HTMLFormElement>('#probe-form')!;
const results = document.querySelector<HTMLUListElement>('#results')!;
const email = document.querySelector<HTMLInputElement>('#email')!;
const password = document.querySelector<HTMLInputElement>('#password')!;
const button = form.querySelector('button')!;
// 検証専用ページ。通常アプリのセッション・保存領域を一切使わない。
if (!import.meta.env.DEV || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
  status.textContent = 'この確認画面はローカルの開発環境だけで利用できます。';
} else {
  form.hidden = false;
  status.textContent = 'Cアカウントの情報を入力してください。';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true; results.replaceChildren();
    status.textContent = '確認中…';
    const client = createClient(supabaseUrl, supabasePublicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: `connexy-mfa-probe-${crypto.randomUUID()}` },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
    });
    try {
      const loginRequest = client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      password.value = '';
      const login = await loginRequest;
      if (login.error || !login.data.session) throw new Error('LOGIN_FAILED');
      const checks = await probeBeforeMfa(client, '99ac0e75-7871-42a9-b6ac-b766e7f2a319');
      for (const check of checks) {
        const item = document.createElement('li');
        item.className = check.passed ? 'pass' : 'fail';
        item.textContent = `${check.passed ? '確認OK' : '要確認'}：${check.label}`;
        results.append(item);
      }
      status.textContent = checks.every(check => check.passed)
        ? 'すべて確認OK：追加認証前は業務データを取得できませんでした。'
        : '要確認の項目があります。確認結果をお知らせください。';
    } catch {
      // SDKの生レスポンス・エラー・JWT・入力値を表示/記録しない。
      status.textContent = '確認を完了できませんでした。Cのメール・パスワードと接続を確認してください。データ取得を拒否できたという判定にはしていません。';
    } finally {
      password.value = '';
      try {
        const logout = await client.auth.signOut({ scope: 'local' });
        if (logout.error) status.textContent += ' 検証セッションの終了をサーバーに確認できませんでした。';
      } catch { status.textContent += ' 検証セッションの終了をサーバーに確認できませんでした。'; }
      button.disabled = false;
    }
  });
}
