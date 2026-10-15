import { useState, useEffect } from 'react';
import { api } from '../data/mockDb';
import type { User, Staff } from '../data/mockDb';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);

  // Signup fields
  const [companyName, setCompanyName] = useState('');
  const [repName, setRepName] = useState('');
  const [contactName, setContactName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [signupLoginId, setSignupLoginId] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [mockFile, setMockFile] = useState<File | null>(null);
  const [signupSuccess, setSignupSuccess] = useState('');

  // Cascading quick login states
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [companyStaffs, setCompanyStaffs] = useState<Staff[]>([]);

  // Debug settings
  const [companies, setCompanies] = useState<User[]>([]);
  const [allStaffs, setAllStaffs] = useState<Staff[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const loadCompanies = async () => {
    const list = await api.getUsers();
    setCompanies(list);
    try {
      const staffsList = await api.getAllStaffs();
      setAllStaffs(staffsList);
    } catch (e) {
      console.error('Failed to load staffs in login page:', e);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const handleCompanySelect = async (companyId: string) => {
    setSelectedCompany(companyId);
    setLoginId('');
    setPassword('');
    if (companyId) {
      const staffsList = await api.getStaffsByUserId(companyId);
      setCompanyStaffs(staffsList);
    } else {
      setCompanyStaffs([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !password) {
      setError('ログインIDとパスワードを入力してください。');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const user = await api.login(loginId, password);
      if (user) {
        const freshUser = await api.getUserById(user.id);
        const status = freshUser?.status || 'approved';
        
        if (status === 'pending') {
          await api.logout();
          setError('この会社アカウントは現在審査中です。運営による承認がおこなわれるまでログインできません。');
        } else if (status === 'rejected') {
          await api.logout();
          setError('この会社アカウントは審査の結果、承認されませんでした。');
        } else {
          onLoginSuccess();
        }
      } else {
        setError('ログインIDまたはパスワードが正しくありません。');
      }
    } catch (err) {
      setError('システムエラーが発生しました。');
    } finally {
      setLoading(false);
      loadCompanies();
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName || !contactName || !signupLoginId || !signupPassword) {
      setError('必須項目を入力してください。');
      return;
    }

    if (invoiceNumber && !/^T\d{13}$/.test(invoiceNumber)) {
      setError('インボイス登録番号はTから始まる13桁の数字で入力してください。');
      return;
    }

    setLoading(true);
    setError('');
    setSignupSuccess('');

    try {
      await api.registerCompany({
        name: companyName,
        representativeName: repName || undefined,
        loginId: signupLoginId,
        password: signupPassword,
        invoiceNumber: invoiceNumber || undefined,
        role: 'contractor'
      });
      setSignupSuccess('新規会社アカウントの申請を受理しました。運営による審査・承認をお待ちください。');
      
      setCompanyName('');
      setRepName('');
      setContactName('');
      setInvoiceNumber('');
      setSignupLoginId('');
      setSignupPassword('');
      setMockFile(null);
      
      setActiveTab('login');
      loadCompanies();
    } catch (err) {
      setError('申請登録中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (companyId: string, status: 'pending' | 'approved' | 'rejected') => {
    await api.updateCompanyStatus(companyId, status);
    loadCompanies();
  };

  const handleQuickLogin = (id: string, pw?: string) => {
    setLoginId(id);
    setPassword(pw || 'pass');
    setError('');
  };

  const testCompanies = [
    { id: 'sigma', name: '株式会社シグマ通信' },
    { id: 'alpha', name: '株式会社アルファ' },
    { id: 'beta', name: 'ベータ株式会社' },
    { id: 'gamma', name: '合同会社ガンマ' },
    { id: 'delta', name: 'デルタ合同会社' },
    { id: 'seals', name: '株式会社SEALs' },
    { id: 'freer', name: '株式会社FreeR VisioN' },
    { id: 'cocolabo', name: 'ココラボ・ソリューションズ' }
  ];

  return (
    <div className="login-container" style={styles.container}>
      <div style={styles.innerContainer}>
        <div style={{ width: '100%', maxWidth: '460px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div className="login-card" style={styles.card}>
          <div style={styles.logoSection}>
            <span className="material-symbols-outlined" style={styles.logoIcon}>hub</span>
            <h1 style={styles.title}>connexy</h1>
            <p style={styles.subtitle}>通信業界BtoBマッチングプラットフォーム</p>
          </div>

          {/* Tab Switcher */}
          <div style={styles.tabContainer}>
            <button
              onClick={() => { setActiveTab('login'); setError(''); setSignupSuccess(''); }}
              style={activeTab === 'login' ? styles.activeTab : styles.inactiveTab}
            >
              ログイン
            </button>
            <button
              onClick={() => { setActiveTab('signup'); setError(''); setSignupSuccess(''); }}
              style={activeTab === 'signup' ? styles.activeTab : styles.inactiveTab}
            >
              新規会社登録申請
            </button>
          </div>

          {error && <div style={styles.errorBanner}>{error}</div>}
          {signupSuccess && <div style={styles.successBanner}>{signupSuccess}</div>}

          {activeTab === 'login' ? (
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>ログインID</label>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  disabled={loading}
                  placeholder="ログインIDを入力"
                  style={styles.input}
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>パスワード</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="パスワードを入力"
                  style={styles.input}
                />
              </div>

              <div style={styles.agreementGroup}>
                <label style={styles.checkboxLabel}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      style={styles.checkbox}
                      disabled={loading}
                    />
                    利用規約およびプライバシーポリシーに同意する
                  </div>
                  <div style={styles.agreementNotice}>
                    （※当サービスはB2Bの業務委託マッチングに限定されます）
                  </div>
                </label>
              </div>

              <button type="submit" disabled={loading || !agreed} style={styles.button(agreed)}>
                {loading ? 'ログイン中...' : 'ログイン'}
              </button>

              <div style={styles.divider}>
                <span style={styles.dividerText}>テストアカウントで簡単ログイン</span>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>テスト企業を選択</label>
                <select
                  value={selectedCompany}
                  onChange={(e) => handleCompanySelect(e.target.value)}
                  disabled={loading || !agreed}
                  style={styles.select}
                >
                  <option value="">-- 企業を選択してください --</option>
                  {testCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {selectedCompany && (
                <div style={{ ...styles.inputGroup, marginTop: '8px' }}>
                  <label style={styles.label}>ログインする個人ユーザーを選択</label>
                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        const [id, pw] = val.split(':');
                        handleQuickLogin(id, pw);
                      } else {
                        setLoginId('');
                        setPassword('');
                      }
                    }}
                    disabled={loading || !agreed}
                    style={styles.select}
                  >
                    <option value="">-- ユーザーを選択してください --</option>
                    <option value={`${selectedCompany}:pass`}>
                      {companies.find(c => c.id === selectedCompany)?.representativeName || '企業代表者'} (管理者)
                    </option>
                    {companyStaffs.map(s => (
                      <option key={s.id} value={`${s.loginId}:${s.password}`}>
                        {s.name} ({s.role === 'admin' ? '管理者' : '一般メンバー'}) [ID: {s.loginId}]
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </form>
          ) : (
            <form onSubmit={handleSignupSubmit} style={styles.form}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>法人名（屋号） <span style={styles.requiredBadge}>必須</span></label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="例: 株式会社コネクシィ"
                  style={styles.input}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ ...styles.inputGroup, flex: 1 }}>
                  <label style={styles.label}>代表者名</label>
                  <input
                    type="text"
                    value={repName}
                    onChange={(e) => setRepName(e.target.value)}
                    placeholder="例: 山田 太郎"
                    style={styles.input}
                  />
                </div>
                <div style={{ ...styles.inputGroup, flex: 1 }}>
                  <label style={styles.label}>担当者名 <span style={styles.requiredBadge}>必須</span></label>
                  <input
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="例: 佐藤 健一"
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>インボイス登録番号</label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="T1234567890123"
                  style={styles.input}
                />
                <span style={{ fontSize: '10px', color: '#64748B' }}>Tから始まる13桁の半角数字を入力してください。</span>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>登記簿謄本コピー (モックファイル) <span style={styles.requiredBadge}>必須</span></label>
                <div style={styles.fileDropArea}>
                  <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#94A3B8', marginBottom: '8px' }}>cloud_upload</span>
                  <span style={{ fontSize: '12px', color: '#64748B' }}>
                    {mockFile ? mockFile.name : 'クリックしてファイルを選択'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    required
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setMockFile(e.target.files[0]);
                      }
                    }}
                    style={styles.fileInput}
                  />
                </div>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>ログインID <span style={styles.requiredBadge}>必須</span></label>
                <input
                  type="text"
                  required
                  value={signupLoginId}
                  onChange={(e) => setSignupLoginId(e.target.value)}
                  placeholder="英数字で入力"
                  style={styles.input}
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>パスワード <span style={styles.requiredBadge}>必須</span></label>
                <input
                  type="password"
                  required
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="パスワードを設定"
                  style={styles.input}
                />
              </div>

              <div style={styles.agreementGroup}>
                <label style={styles.checkboxLabel}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      style={styles.checkbox}
                      disabled={loading}
                    />
                    利用規約およびプライバシーポリシーに同意する
                  </div>
                </label>
              </div>

              <button type="submit" disabled={loading || !agreed} style={styles.button(agreed)}>
                {loading ? '申請送信中...' : '会社アカウント開設の審査申請をする'}
              </button>
            </form>
          )}
        </div>

        {/* Developer Sandbox Panel — dev builds only, stripped entirely from production bundles */}
        {import.meta.env.DEV && (
        <div style={styles.debugPanel}>
          <div
            onClick={() => setShowDebug(!showDebug)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '12px 16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#E2E8F0', fontSize: '13px', fontWeight: 'bold' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>construction</span>
              【デバッグ開発用】アカウント審査管理ツール
            </div>
            <span className="material-symbols-outlined" style={{ color: '#E2E8F0', transform: showDebug ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              expand_more
            </span>
          </div>

          {showDebug && (
            <div style={{ padding: '0 16px 16px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', marginTop: '8px' }}>
              <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4' }}>
                登録されている会社アカウントの一覧です。ステータスを「承認（approved）」に変更することで、そのアカウントでログインできるようになります。
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {companies.map(c => {
                  const statusColors = {
                    pending: { bg: '#FEF3C7', fg: '#D97706', label: '審査待ち' },
                    approved: { bg: '#D1FAE5', fg: '#059669', label: '承認済' },
                    rejected: { bg: '#FEE2E2', fg: '#DC2626', label: '非承認' }
                  };
                  const statusInfo = statusColors[c.status || 'approved'] || statusColors.approved;
                  return (
                    <div key={c.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#FFF' }}>{c.name}</div>
                        <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: statusInfo.bg, color: statusInfo.fg, fontWeight: 'bold' }}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <button
                          onClick={() => handleStatusChange(c.id, 'approved')}
                          style={{ flex: 1, padding: '4px', background: '#059669', color: '#FFF', border: 'none', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          承認する
                        </button>
                        <button
                          onClick={() => handleStatusChange(c.id, 'rejected')}
                          style={{ flex: 1, padding: '4px', background: '#DC2626', color: '#FFF', border: 'none', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          却下する
                        </button>
                        <button
                          onClick={() => handleStatusChange(c.id, 'pending')}
                          style={{ flex: 1, padding: '4px', background: '#475569', color: '#FFF', border: 'none', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          保留に戻す
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: '1.4', marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px' }}>
                登録されているスタッフ（一般・管理者メンバー）の一覧です。
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {allStaffs.length === 0 ? (
                  <div style={{ fontSize: '11px', color: '#64748B', textAlign: 'center', padding: '10px' }}>
                    スタッフが登録されていません。
                  </div>
                ) : (
                  allStaffs.map(s => {
                    const compName = companies.find(c => c.id === s.userId)?.name || `企業ID: ${s.userId}`;
                    return (
                      <div key={s.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#FFF' }}>{s.name} ({s.role === 'admin' ? '管理者' : '一般'})</div>
                          <span style={{ fontSize: '10px', color: '#94A3B8' }}>{compName}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        )}
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '8px', textAlign: 'center' }}>
          App Version: v1.1.3 (Build: 2026-07-16 18:13)
        </div>
      </div>
    </div>
  </div>
  );
}

const styles = {
  container: {
    height: '100vh',
    width: '100%',
    overflowY: 'auto' as const,
    background: 'linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%)',
    fontFamily: '"Outfit", "Inter", sans-serif',
    boxSizing: 'border-box' as const,
    WebkitOverflowScrolling: 'touch' as const,
  },
  innerContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100%',
    width: '100%',
    padding: '40px 20px',
    boxSizing: 'border-box' as const,
  },
  card: {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(10px)',
    borderRadius: '24px',
    padding: '36px 32px',
    width: '100%',
    boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
    boxSizing: 'border-box' as const,
  },
  logoSection: {
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  logoIcon: {
    fontSize: '44px',
    color: '#2563EB',
    background: '#EFF6FF',
    padding: '10px',
    borderRadius: '16px',
    marginBottom: '8px',
    display: 'inline-block'
  },
  title: {
    fontSize: '26px',
    fontWeight: 'bold',
    margin: '0 0 6px 0',
    color: '#0F172A',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: '12px',
    color: '#64748B',
    margin: 0,
  },
  tabContainer: {
    display: 'flex',
    background: '#F1F5F9',
    padding: '4px',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  activeTab: {
    flex: 1,
    padding: '10px',
    background: 'var(--surface-color)',
    color: '#2563EB',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontSize: '13px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  inactiveTab: {
    flex: 1,
    padding: '10px',
    background: 'transparent',
    color: '#64748B',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontSize: '13px',
  },
  errorBanner: {
    background: '#FEE2E2',
    border: '1px solid #FCA5A5',
    color: '#991B1B',
    padding: '12px',
    borderRadius: '12px',
    fontSize: '13px',
    marginBottom: '20px',
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
    lineHeight: '1.4',
  },
  successBanner: {
    background: '#D1FAE5',
    border: '1px solid #6EE7B7',
    color: '#065F46',
    padding: '12px',
    borderRadius: '12px',
    fontSize: '13px',
    marginBottom: '20px',
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
    lineHeight: '1.4',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#334155',
  },
  requiredBadge: {
    color: '#EF4444',
    marginLeft: '2px',
    fontSize: '11px',
  },
  input: {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #CBD5E1',
    fontSize: '14px',
    outline: 'none',
    transition: 'all 0.2s',
    background: '#F8FAFC',
    boxSizing: 'border-box' as const,
  },
  select: {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #CBD5E1',
    fontSize: '14px',
    outline: 'none',
    background: '#F8FAFC',
    boxSizing: 'border-box' as const,
    cursor: 'pointer',
    width: '100%'
  },
  fileDropArea: {
    border: '2px dashed #CBD5E1',
    borderRadius: '12px',
    padding: '16px',
    textAlign: 'center' as const,
    background: '#F8FAFC',
    cursor: 'pointer',
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  fileInput: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
  },
  agreementGroup: {
    display: 'flex',
    alignItems: 'flex-start',
    marginTop: '4px',
    marginBottom: '4px',
  },
  checkboxLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    fontSize: '13px',
    color: '#334155',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  checkbox: {
    marginRight: '8px',
    cursor: 'pointer',
    width: '16px',
    height: '16px',
    accentColor: '#2563EB',
  },
  agreementNotice: {
    fontSize: '11px',
    color: '#64748B',
    marginTop: '4px',
    marginLeft: '24px',
  },
  button: (agreed: boolean) => ({
    padding: '12px',
    background: agreed ? '#2563EB' : '#94A3B8',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 'bold' as const,
    cursor: agreed ? 'pointer' : 'not-allowed',
    transition: 'background 0.2s',
    marginTop: '4px',
  }),
  divider: {
    display: 'flex',
    alignItems: 'center',
    textAlign: 'center' as const,
    margin: '16px 0',
  },
  dividerText: {
    fontSize: '11px',
    color: '#64748B',
    width: '100%',
    fontWeight: 'bold' as const,
    background: 'transparent',
    padding: '0',
  },
  quickLoginSection: {
    display: 'grid',
    gridTemplateColumns: 'repeat(1, 1fr)',
    gap: '8px',
  },
  quickButton: (agreed: boolean) => ({
    padding: '8px',
    background: agreed ? '#F1F5F9' : '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    cursor: agreed ? 'pointer' : 'not-allowed',
    transition: 'all 0.2s',
    opacity: agreed ? 1 : 0.6,
  }),
  debugPanel: {
    backgroundColor: '#1E293B',
    borderRadius: '16px',
    border: '1px solid rgba(255,255,255,0.1)',
    overflow: 'hidden',
    boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
  }
};
