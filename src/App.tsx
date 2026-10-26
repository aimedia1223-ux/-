import { supabase } from './lib/supabase';
import { legacyDemoAuth, MfaRequiredError } from './lib/auth';
import { MfaPage } from './pages/MfaPage';
import { startSessionMonitor } from './lib/sessionActivity';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { api, DATA_ACCESS_ERROR_EVENT } from './data/mockDb';
import type { User } from './data/mockDb';
import { BottomNav } from './components/BottomNav';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { MessagePage } from './pages/MessagePage';
import { ManagementPage } from './pages/ManagementPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsDrawer } from './components/SettingsDrawer';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [mfaAccount, setMfaAccount] = useState<MfaRequiredError['account'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [dataAccessError, setDataAccessError] = useState(false);
  const [sessionNotice, setSessionNotice] = useState('');
  const authCheckVersion = useRef(0);
  const observedAuthUserId = useRef<string | null>(null);

  const checkUser = async () => {
    const version = ++authCheckVersion.current;
    try {
      const user = await api.getCurrentUser();
      if (version !== authCheckVersion.current) return;
      setMfaAccount(null);
      if (user && user.status !== 'approved') {
        await api.logout();
        setCurrentUser(null);
      } else {
        setCurrentUser(user);
        if (!user) setShowSettingsDrawer(false);
        if (user) { setSessionNotice(''); setDataAccessError(false); }
        else if (currentUser) setSessionNotice('ログイン期限または利用権限を確認できません。もう一度ログインしてください。');
      }
    } catch (e) {
      if (version !== authCheckVersion.current) return;
      setCurrentUser(null);
      setShowSettingsDrawer(false);
      if (e instanceof MfaRequiredError) setMfaAccount(e.account);
      else { setMfaAccount(null); setSessionNotice('認証の確認に失敗しました。もう一度ログインしてください。'); }
    } finally {
      if (version === authCheckVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      // Seeding runs in the background so it doesn't block the page loading
      if (legacyDemoAuth) api.seedStaffAttendanceLogs().catch(err => console.error('Seeding error:', err));
      await checkUser();
    };
    init();
    // コールバック内でAuth APIをawaitせず、失効・ログアウト時に画面を閉じる。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!legacyDemoAuth && !session) {
        ++authCheckVersion.current;
        setCurrentUser(null);
        setMfaAccount(null);
        setShowSettingsDrawer(false);
        setLoading(false);
      } else if (!legacyDemoAuth && session && observedAuthUserId.current && observedAuthUserId.current !== session.user.id) {
        // 別タブで別アカウントへ切替わった場合、前の会社の画面を一度破棄する。
        ++authCheckVersion.current;
        setCurrentUser(null);
        setMfaAccount(null);
        setShowSettingsDrawer(false);
        setTimeout(() => { void checkUser(); }, 0);
      }
      observedAuthUserId.current = session?.user.id || null;
    });
    const refreshIdentity = () => { if (!legacyDemoAuth) void checkUser(); };
    window.addEventListener('focus', refreshIdentity);
    const handleDataAccessError = () => setDataAccessError(true);
    window.addEventListener(DATA_ACCESS_ERROR_EVENT, handleDataAccessError);

    // Listen to custom settings drawer open event
    const handleOpenSettings = () => {
      setShowSettingsDrawer(true);
    };
    window.addEventListener('open-settings-menu', handleOpenSettings);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener(DATA_ACCESS_ERROR_EVENT, handleDataAccessError);
      window.removeEventListener('focus', refreshIdentity);
      window.removeEventListener('open-settings-menu', handleOpenSettings);
    };
  }, []);

  useEffect(() => {
    if (legacyDemoAuth || !currentUser) return;
    return startSessionMonitor({
      user: currentUser,
      onExpire: () => {
        ++authCheckVersion.current;
        setCurrentUser(null);
        setShowSettingsDrawer(false);
        setSessionNotice('一定時間操作がなかったためログアウトしました。もう一度ログインしてください。');
        void api.logout().catch(() => {});
      },
      onRevalidate: () => { void checkUser(); },
    });
  }, [currentUser?.id, currentUser?.staffId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0F172A', color: 'white', fontFamily: 'sans-serif' }}>
        読み込み中...
      </div>
    );
  }

  if (mfaAccount) return <MfaPage key={mfaAccount.id} account={mfaAccount} onComplete={checkUser} />;

  if (!currentUser) {
    return (
      <Router>
        <Routes>
          <Route path="/login" element={<LoginPage onLoginSuccess={checkUser} notice={sessionNotice} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router>
      <div id="app-container">
        {dataAccessError && (
          <div role="alert" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000, background: '#fff3cd', color: '#513c06', padding: '12px', fontSize: '14px' }}>
            データの取得・保存ができませんでした。接続とアクセス権限を確認してください。
            <button onClick={() => window.location.reload()} style={{ marginLeft: '12px' }}>再読み込み</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/message" element={<MessagePage />} />
          <Route path="/manage" element={<ManagementPage />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <BottomNav />
        <SettingsDrawer 
          isOpen={showSettingsDrawer} 
          onClose={() => setShowSettingsDrawer(false)} 
          onLogoutSuccess={checkUser} 
        />
      </div>
    </Router>
  );
}

export default App;
