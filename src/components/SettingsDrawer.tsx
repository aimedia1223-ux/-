import { useState, useEffect } from 'react';
import { api } from '../data/mockDb';
import type { User } from '../data/mockDb';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onLogoutSuccess: () => void;
}

export function SettingsDrawer({ isOpen, onClose, onLogoutSuccess }: SettingsDrawerProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showProfileOverlay, setShowProfileOverlay] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  // Profile fields state
  const [repNameInput, setRepNameInput] = useState('');
  const [invoiceNumberInput, setInvoiceNumberInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [websiteInput, setWebsiteInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [prInput, setPrInput] = useState('');
  const [genderInput, setGenderInput] = useState<'男性' | '女性' | 'その他' | '無回答'>('男性');
  const [contractTemplateInput, setContractTemplateInput] = useState('');
  const [contractPdfInput, setContractPdfInput] = useState('');
  const [pdfName, setPdfName] = useState('');

  useEffect(() => {
    if (isOpen) {
      const loadUser = async () => {
        const user = await api.getCurrentUser();
        setCurrentUser(user);
        if (user) {
          setRepNameInput(user.representativeName || '');
          setInvoiceNumberInput(user.invoiceNumber || '');
          setEmailInput(user.email || '');
          setWebsiteInput(user.website || '');
          setAddressInput(user.address || '');
          setPrInput(user.prText || '');
          setGenderInput((user.gender as any) || '男性');
          setContractTemplateInput(user.contractTemplate || '');
          setContractPdfInput(user.contractPdf || '');
          const localPdfName = localStorage.getItem('company_contract_pdf_name_' + user.id) || '';
          setPdfName(user.contractPdf ? (localPdfName || '登録済みPDF') : '');
        }
      };
      loadUser();
    }
  }, [isOpen]);

  const handleLogout = async () => {
    if (confirm('ログアウトしますか？')) {
      await api.logout();
      onLogoutSuccess();
      onClose();
    }
  };

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        alert('PDFファイルのみアップロード可能です。');
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        alert('ローカル保存制限のため、2MB以下のPDFファイルを選択してください。');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setContractPdfInput(result);
        setPdfName(file.name);
        if (currentUser) {
          localStorage.setItem('company_contract_pdf_name_' + currentUser.id, file.name);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProfileSave = () => {
    setProfileSaving(true);
    if (currentUser) {
      localStorage.setItem('company_rep_' + currentUser.id, repNameInput);
      localStorage.setItem('company_invoice_' + currentUser.id, invoiceNumberInput);
      localStorage.setItem('company_email_' + currentUser.id, emailInput);
      localStorage.setItem('company_website_' + currentUser.id, websiteInput);
      localStorage.setItem('company_address_' + currentUser.id, addressInput);
      localStorage.setItem('company_pr_' + currentUser.id, prInput);
      localStorage.setItem('company_gender_' + currentUser.id, genderInput);
      localStorage.setItem('company_contract_template_' + currentUser.id, contractTemplateInput);
      localStorage.setItem('company_contract_pdf_' + currentUser.id, contractPdfInput);

      currentUser.representativeName = repNameInput;
      currentUser.invoiceNumber = invoiceNumberInput;
      currentUser.email = emailInput;
      currentUser.website = websiteInput;
      currentUser.address = addressInput;
      currentUser.prText = prInput;
      currentUser.gender = genderInput;
      currentUser.contractTemplate = contractTemplateInput;
      currentUser.contractPdf = contractPdfInput;

      if (!currentUser.staffId) {
        currentUser.staffName = repNameInput;
      }
    }
    setTimeout(() => {
      setProfileSaving(false);
      setShowProfileOverlay(false);
    }, 800);
  };

  const isUserAdmin = !currentUser?.staffId || currentUser.staffRole === 'admin';

  if (!isOpen) return null;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 3000, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
      {/* Backdrop */}
      <div 
        onClick={onClose}
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%', 
          background: 'rgba(15, 23, 42, 0.4)', 
          backdropFilter: 'blur(3px)',
          animation: 'fadeIn 0.2s ease-out'
        }} 
      />

      {/* Drawer Panel */}
      <div 
        style={{ 
          position: 'relative', 
          width: '80%', 
          maxWidth: '360px', 
          height: '100%', 
          background: 'var(--surface-color)', 
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
          display: 'flex', 
          flexDirection: 'column',
          animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <header className="solid-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'calc(16px + env(safe-area-inset-top)) 16px 16px 16px', borderBottom: '1px solid var(--border-color)', height: 'calc(60px + env(safe-area-inset-top))' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, color: 'var(--text-main)' }}>設定・メニュー</h2>
          <button className="icon-btn-dark" onClick={onClose} style={{ padding: '4px' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <main style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', background: '#F8FAFC' }}>
          {/* User profile card */}
          <div style={{ background: 'var(--surface-color)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="profile-avatar" style={{ width: '48px', height: '48px', fontSize: '18px', borderRadius: '24px' }}>
              {currentUser?.name.charAt(0) || '株'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {currentUser?.name || '会社名'}
                <span className="premium-badge" style={{ margin: 0, padding: '2px 6px', fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>stars</span>
                  プレミアム
                </span>
              </div>
              {currentUser?.staffName && (
                <div style={{ fontSize: '12px', color: 'var(--text-sub)', marginTop: '2px' }}>
                  ログイン: {currentUser.staffName} ({currentUser.staffRole === 'admin' ? '管理者' : '一般'})
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Self Profile Edit */}
            <div 
              className="settings-item" 
              onClick={() => { 
                if (isUserAdmin) setShowProfileOverlay(true); 
                else alert('管理者権限が必要です。'); 
              }} 
              style={{ 
                background: 'var(--surface-color)', 
                padding: '14px 16px', 
                borderRadius: '10px', 
                border: '1px solid var(--border-color)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                cursor: 'pointer',
                opacity: isUserAdmin ? 1 : 0.6
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)' }}>business</span>
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>自社プロフィール編集 {!isUserAdmin && ' (制限中)'}</span>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#94A3B8' }}>chevron_right</span>
            </div>

            {/* Stripe Integration */}
            <div 
              className="settings-item" 
              onClick={() => {
                if (isUserAdmin) alert('現在デモモードです。本番環境のStripeアカウントと連携します。');
                else alert('管理者権限が必要です。');
              }}
              style={{ 
                background: 'var(--surface-color)', 
                padding: '14px 16px', 
                borderRadius: '10px', 
                border: '1px solid var(--border-color)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                cursor: 'pointer',
                opacity: isUserAdmin ? 1 : 0.6
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="material-symbols-outlined" style={{ color: '#635BFF' }}>payments</span>
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>決済連携 (Stripe) {!isUserAdmin && ' (制限中)'}</span>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#94A3B8' }}>chevron_right</span>
            </div>

            {/* Logout */}
            <div 
              className="settings-item" 
              onClick={handleLogout}
              style={{ 
                background: 'var(--surface-color)', 
                padding: '14px 16px', 
                borderRadius: '10px', 
                border: '1px solid var(--border-color)',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                cursor: 'pointer',
                marginTop: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="material-symbols-outlined" style={{ color: '#EF4444' }}>logout</span>
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#EF4444' }}>ログアウト</span>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#EF4444' }}>chevron_right</span>
            </div>
          </div>
        </main>
      </div>

      {/* Profile Edit Overlay View */}
      {showProfileOverlay && (
        <div className="overlay-view show" style={{ zIndex: 4000, display: 'flex', flexDirection: 'column' }}>
          <header className="solid-header overlay-header">
            <button className="icon-btn-dark" onClick={() => setShowProfileOverlay(false)}>
              <span className="material-symbols-outlined">arrow_back_ios_new</span>
            </button>
            <h1>自社プロフィール編集</h1>
            <button className="text-btn primary-text" onClick={handleProfileSave} disabled={profileSaving}>
              {profileSaving ? '保存中...' : '保存'}
            </button>
          </header>
          <main className="list-area bg-gray p-16 pb-80 form-container" style={{ flex: 1, overflowY: 'auto' }}>
            <div className="form-section" style={{ background: 'var(--surface-color)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
              <div className="form-avatar-edit" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0' }}>
                <div className="profile-avatar large" style={{ width: '64px', height: '64px', fontSize: '24px' }}>
                  {currentUser?.name.charAt(0) || '株'}
                </div>
                <button className="btn-secondary mt-8" style={{ border: '1px solid var(--border-color)', background: 'var(--surface-color)', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', marginTop: '8px' }}>
                  画像を変更
                </button>
              </div>
            </div>

            <div className="form-section" style={{ background: 'var(--surface-color)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <h3 style={{ fontSize: '14px', margin: '0 0 4px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>基本情報</h3>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>法人名（屋号） <span style={{ color: '#EF4444' }}>必須</span></label>
                <input 
                  type="text" 
                  className="form-control" 
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  value={repNameInput} 
                  onChange={e => setRepNameInput(e.target.value)} 
                />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>インボイス登録番号</label>
                <input 
                  type="text" 
                  className="form-control" 
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  value={invoiceNumberInput}
                  onChange={e => setInvoiceNumberInput(e.target.value)}
                  placeholder="T + 13桁の半角数字"
                />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>会社のメールアドレス</label>
                <input 
                  type="email" 
                  className="form-control" 
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  value={emailInput} 
                  onChange={e => setEmailInput(e.target.value)} 
                  placeholder="info@company.com" 
                />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>公式ホームページURL</label>
                <input 
                  type="url" 
                  className="form-control" 
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  value={websiteInput} 
                  onChange={e => setWebsiteInput(e.target.value)} 
                  placeholder="https://company.com" 
                />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>本社所在地 (住所)</label>
                <input 
                  type="text" 
                  className="form-control" 
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  value={addressInput} 
                  onChange={e => setAddressInput(e.target.value)} 
                  placeholder="東京都千代田区1-1" 
                />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>会社PR・得意分野</label>
                <textarea 
                  className="form-control" 
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
                  rows={4}
                  value={prInput} 
                  onChange={e => setPrInput(e.target.value)} 
                  placeholder="自社の強みや稼働実績を記入してください" 
                />
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>代表者・担当者の性別</label>
                <select 
                  className="form-control" 
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-color)' }}
                  value={genderInput} 
                  onChange={e => setGenderInput(e.target.value as any)}
                >
                  <option value="男性">男性</option>
                  <option value="女性">女性</option>
                  <option value="その他">その他</option>
                  <option value="無回答">無回答</option>
                </select>
              </div>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-sub)' }}>業務委託契約書 (PDF形式)</label>
                <div style={{ marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <input 
                      type="file" 
                      accept="application/pdf" 
                      onChange={handlePdfUpload}
                      style={{ display: 'none' }}
                      id="pdf-upload-input"
                    />
                    <label htmlFor="pdf-upload-input" style={{ padding: '8px 14px', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>upload_file</span>
                      PDFを選択
                    </label>
                    {pdfName && (
                      <span style={{ fontSize: '11px', color: '#059669', display: 'inline-flex', alignItems: 'center', gap: '2px', fontWeight: 'bold' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check_circle</span>
                        {pdfName}
                      </span>
                    )}
                  </div>
                  {contractPdfInput && (
                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button 
                        type="button" 
                        onClick={() => {
                          const win = window.open();
                          if (win) win.document.write(`<iframe src="${contractPdfInput}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                        }} 
                        style={{ padding: '6px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', color: 'var(--primary)', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>visibility</span>
                        プレビュー
                      </button>
                      <button 
                        type="button" 
                        onClick={() => {
                          setContractPdfInput('');
                          setPdfName('');
                        }} 
                        style={{ padding: '6px 10px', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                        削除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
