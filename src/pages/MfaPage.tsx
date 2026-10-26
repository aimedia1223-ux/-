import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAuthenticatedUser, MfaRequiredError } from '../lib/auth';
import { markSessionActive } from '../lib/sessionActivity';

type Props = { account: MfaRequiredError['account']; onComplete: () => Promise<void> };

export function MfaPage({ account, onComplete }: Props) {
  // QR・秘密鍵・コードは画面のメモリ内だけに保持する。
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [factorId, setFactorId] = useState(account.factors[0]?.id || '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const working = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function sameAccount() {
    const result = await supabase.auth.getUser();
    if (result.error || result.data.user?.id !== account.id) throw new Error('account changed');
  }

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await sameAccount(); await action(); }
    catch { if (active.current) setError('認証できませんでした。接続・認証アプリの最新コード・端末の時刻を確認して再試行してください。登録できない場合は管理者へお問い合わせください。'); }
    finally { working.current = false; if (active.current) setBusy(false); }
  }

  function enroll() {
    void run(async () => {
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Connexy ${new Date().toISOString()}` });
      if (result.error) throw result.error;
      await sameAccount();
      if (active.current) setEnrollment({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret });
    });
  }

  function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError('6桁の数字を入力してください。'); return; }
    void run(async () => {
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment?.id || factorId, code });
      if (result.error) throw result.error;
      await sameAccount();
      const user = await getAuthenticatedUser(true);
      if (!user) {
        await supabase.auth.signOut({ scope: 'local' });
        throw new Error('membership or session unavailable');
      }
      markSessionActive(user);
      if (active.current) { setCode(''); setEnrollment(null); await onComplete(); }
    });
  }

  return <main style={{ maxWidth: 440, margin: '48px auto', padding: 24, background: '#fff', borderRadius: 16 }}>
    <h1 style={{ fontSize: 24 }}>追加認証</h1>
    <p>{account.email}</p>
    {account.factors.length === 0 && !enrollment ? <>
      <p>認証アプリを登録してください。Google Authenticatorなどの認証アプリで、この後表示されるQRコードを読み取ります。</p>
      <button disabled={busy} onClick={enroll}>認証アプリを登録する</button>
    </> : <form onSubmit={verify}>
      {enrollment && <>
        <p>認証アプリでQRコードを読み取ってください。</p>
        <img src={enrollment.qr} alt="認証アプリ登録用QRコード" style={{ width: 220, maxWidth: '100%' }} />
        <details><summary>QRコードを読み取れない場合</summary>
          <p>認証アプリの「セットアップキー」に入力してください。</p>
          <code style={{ overflowWrap: 'anywhere' }}>{enrollment.secret}</code>
        </details>
        <p>QRコード・セットアップキーは他の人に送らないでください。</p>
      </>}
      {!enrollment && account.factors.length > 1 && <label>使用する認証アプリ
        <select value={factorId} disabled={busy} onChange={e => setFactorId(e.target.value)}>
          {account.factors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>}
      <label style={{ display: 'block', margin: '20px 0' }}>認証アプリの6桁コード
        <input aria-label="認証コード" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
          value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          style={{ display: 'block', fontSize: 24, padding: 10, width: '90%' }} required />
      </label>
      <button type="submit" disabled={busy}>{busy ? '確認中…' : '確認して続ける'}</button>
    </form>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    <p style={{ fontSize: 13 }}>認証アプリを使えない場合は管理者へお問い合わせください。</p>
    <button disabled={busy} onClick={() => { void run(async () => {
      const result = await supabase.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
      setCode(''); setEnrollment(null); await onComplete();
    }); }}>ログアウト</button>
  </main>;
}
