import { useState, useEffect } from 'react';
import { api } from '../data/mockDb';
import type { ContractTask, Announcement } from '../data/mockDb';

type DetailType = 'none' | 'income' | 'transfer';

export function HomePage() {
  const [tasks, setTasks] = useState<ContractTask[]>([]);
  const [detailType, setDetailType] = useState<DetailType>('none');
  const [hasPendingReports, setHasPendingReports] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [selectedAnn, setSelectedAnn] = useState<Announcement | null>(null);

  // GPS States (fused from TaskPage)
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [checkinTime, setCheckinTime] = useState<string | null>(null);
  const [isSimulatingGps, setIsSimulatingGps] = useState(false);
  const [isVerifyingGps, setIsVerifyingGps] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const fetchedTasks = await api.getContractTasks();
      setTasks(fetchedTasks);
      setHasPendingReports(fetchedTasks.some(t => t.status === 'report_pending'));

      try {
        setAnnouncements(await api.getAnnouncements());
      } catch (e) {
        console.error('Failed to load announcements:', e);
      }

      // Restore GPS state from storage if any
      const savedCheckin = localStorage.getItem('connexy_checkin_time');
      if (savedCheckin) {
        setIsCheckedIn(true);
        setCheckinTime(savedCheckin);
      }
    };
    loadData();
  }, []);

  const handleWithdraw = () => {
    if (hasPendingReports) {
      alert("【振込申請不可】\n完了報告が未完了のタスクが残っているため、振込申請を行えません。\n「管理」タブの出勤ログ/クイズ、または未完了チャットから報告をすべて完了させてください。");
    } else {
      alert("早期出金（即時振込）の申請を受付しました。(モック)\n登録口座へ24時間以内にお振込みいたします。");
    }
  };

  const handleGpsSimulateToggle = () => {
    setIsSimulatingGps(!isSimulatingGps);
  };

  const handleCheckin = () => {
    setIsVerifyingGps(true);
    setTimeout(() => {
      setIsVerifyingGps(false);
      if (isSimulatingGps) {
        const nowStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        if (!isCheckedIn) {
          setIsCheckedIn(true);
          setCheckinTime(nowStr);
          localStorage.setItem('connexy_checkin_time', nowStr);
          alert('出勤を打刻しました。本日もがんばりましょう！');
        } else {
          setIsCheckedIn(false);
          setCheckinTime(null);
          localStorage.removeItem('connexy_checkin_time');
          alert('退勤を打刻しました。お疲れ様でした！');
        }
      } else {
        alert('位置情報を取得できませんでした。GPSシミュレーターをONにするか、電波のよい場所でお試しください。');
      }
    }, 1000);
  };

  const openSettings = () => {
    window.dispatchEvent(new Event('open-settings-menu'));
  };

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;

  // Counts for summary
  const pendingReportCount = tasks.filter(t => t.status === 'report_pending').length;
  const offeredCount = tasks.filter(t => t.status === 'offered').length;

  if (detailType === 'income') {
    return (
      <div className="view active" style={{ animation: 'fadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <header className="solid-header overlay-header">
          <button type="button" className="icon-btn-dark" onClick={() => setDetailType('none')}>
            <span className="material-symbols-outlined">arrow_back_ios_new</span>
          </button>
          <h1 style={{ margin: 0, fontSize: '18px', textAlign: 'center', flex: 1 }}>入金予定明細</h1>
          <div style={{ width: '40px' }}></div>
        </header>
        <main className="list-area p-16" style={{ background: '#F8FAFC', flex: 1, overflowY: 'auto' }}>
          <div style={{ background: 'var(--surface-color)', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)', border: '1px solid #E2E8F0', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: '#64748B', fontWeight: 'bold', marginBottom: '6px' }}>
              {nextMonth}月入金予定総額（{currentMonth}月稼働分）
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', borderBottom: '2px dashed #E2E8F0', paddingBottom: '16px', marginBottom: '16px' }}>
              <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#1E3A8A' }}>¥</span>
              <span style={{ fontSize: '32px', fontWeight: 'bold', color: '#1E3A8A' }}>520,000</span>
              <span style={{ fontSize: '14px', color: '#64748B', marginLeft: 'auto', fontWeight: 'bold' }}>(総額 52.0万円)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', color: '#0F172A' }}>
                  <span>A社</span>
                  <span>33.0万円</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', paddingLeft: '12px', borderLeft: '2px solid #3B82F6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>【JOB-108273】</span>
                    <span>18.0万円</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>【JOB-492715】</span>
                    <span>15.0万円</span>
                  </div>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', color: '#0F172A' }}>
                  <span>B社</span>
                  <span>19.0万円</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', paddingLeft: '12px', borderLeft: '2px solid #3B82F6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>【JOB-882371】</span>
                    <span>19.0万円</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ background: 'var(--surface-color)', borderRadius: '12px', padding: '16px', border: '1px solid #E2E8F0', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <span className="material-symbols-outlined" style={{ color: '#3B82F6', fontSize: '20px' }}>info</span>
            <div style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5' }}>
              この金額は元請け企業から支払われる予定の売上額（手数料差引前）です。実際の銀行口座への振込予定額は「振込予定額」の明細をご確認ください。
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (detailType === 'transfer') {
    return (
      <div className="view active" style={{ animation: 'fadeIn 0.2s ease-out', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <header className="solid-header overlay-header">
          <button type="button" className="icon-btn-dark" onClick={() => setDetailType('none')}>
            <span className="material-symbols-outlined">arrow_back_ios_new</span>
          </button>
          <h1 style={{ margin: 0, fontSize: '18px', textAlign: 'center', flex: 1 }}>振込予定明細</h1>
          <div style={{ width: '40px' }}></div>
        </header>
        <main className="list-area p-16" style={{ background: '#F8FAFC', flex: 1, overflowY: 'auto' }}>
          <div style={{ background: 'var(--surface-color)', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)', border: '1px solid #E2E8F0', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: '#64748B', fontWeight: 'bold', marginBottom: '6px' }}>
              {nextMonth}月振込予定総額（{currentMonth}月稼働分）
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', borderBottom: '2px dashed #E2E8F0', paddingBottom: '16px', marginBottom: '16px' }}>
              <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#4F46E5' }}>¥</span>
              <span style={{ fontSize: '32px', fontWeight: 'bold', color: '#4F46E5' }}>430,500</span>
              <span style={{ fontSize: '14px', color: '#64748B', marginLeft: 'auto', fontWeight: 'bold' }}>(総額 43.05万円)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', color: '#0F172A' }}>
                  <span>A社</span>
                  <span>33.0万円</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', paddingLeft: '12px', borderLeft: '2px solid #818CF8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>【JOB-108273】</span>
                    <span>18.0万円</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>【JOB-492715】</span>
                    <span>15.0万円</span>
                  </div>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', color: '#0F172A' }}>
                  <span>B社</span>
                  <span>19.0万円</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', paddingLeft: '12px', borderLeft: '2px solid #818CF8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                    <span>【JOB-882371】</span>
                    <span>19.0万円</span>
                  </div>
                </div>
              </div>
              <div style={{ height: '1px', background: '#E2E8F0', margin: '4px 0' }}></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#EF4444', fontWeight: '600' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>handshake</span>
                    マッチング手数料 (10%)
                  </span>
                  <span>-5.2万円</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#EF4444', fontWeight: '600' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>percent</span>
                    早期出金手数料 (7.5%)
                  </span>
                  <span>-3.75万円</span>
                </div>
              </div>
            </div>
          </div>
          <div style={{ background: 'var(--surface-color)', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)', border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <button 
              className="btn-primary" 
              onClick={handleWithdraw}
              style={{
                background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                color: '#FFFFFF',
                border: 'none',
                padding: '14px',
                borderRadius: '10px',
                fontWeight: 'bold',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
                width: '100%',
                ...(hasPendingReports ? { opacity: 0.6, cursor: 'not-allowed', backgroundColor: '#9CA3AF', backgroundImage: 'none' } : {})
              }}
            >
              <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '6px' }}>speed</span>
              早期出金（即時振込）を申請する
            </button>
            <p className="wallet-note" style={{ color: '#64748B', marginTop: '10px', fontSize: '11px', lineHeight: '1.4' }}>
              ※早期出金を利用すると、通常支払日を待たずに最短当日に入金されます。<br />
              手数料として振込金額の7.5%が発生します。
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="view active" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Home Header */}
      <header className="solid-header" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-main)' }}>Connexy</div>
          <span style={{ fontSize: '10px', background: 'var(--primary)', color: 'white', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>ホーム</span>
        </div>
        <button className="icon-btn-dark" onClick={openSettings}>
          <span className="material-symbols-outlined">menu</span>
        </button>
      </header>

      {/* Home Main Content */}
      <main className="list-area bg-gray" style={{ flex: 1, overflowY: 'auto', padding: '16px', paddingBottom: '90px' }}>

        {/* 運営からのお知らせ掲示板 */}
        <div style={{ background: 'var(--surface-color)', borderRadius: '14px', padding: '16px', border: '1px solid var(--border-color)', marginBottom: '16px', boxShadow: '0 2px 6px rgba(0,0,0,0.01)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '20px' }}>campaign</span>
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>運営からのお知らせ</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {announcements.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--text-sub)', padding: '4px 8px' }}>現在お知らせはありません。</div>
            )}
            {announcements.map(ann => (
              <div 
                key={ann.id} 
                onClick={() => setSelectedAnn(ann)}
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '4px', 
                  cursor: 'pointer', 
                  padding: '8px', 
                  borderRadius: '8px', 
                  background: ann.isImportant ? '#FEF2F2' : '#F8FAFC',
                  border: ann.isImportant ? '1px solid #FEE2E2' : '1px solid transparent',
                  transition: 'background 0.2s'
                }}
                className="announcement-item-hover"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-sub)' }}>
                  <span>{ann.date}</span>
                  {ann.isImportant && (
                    <span style={{ background: '#EF4444', color: 'white', padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' }}>重要</span>
                  )}
                </div>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ann.title}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expected Finances (Dashboard fusion) */}
        <div style={{ background: 'var(--surface-color)', borderRadius: '14px', padding: '16px', border: '1px solid var(--border-color)', marginBottom: '16px', boxShadow: '0 2px 6px rgba(0,0,0,0.01)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '20px' }}>savings</span>
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>売上・入出金状況</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Expected Income Card */}
            <div 
              onClick={() => setDetailType('income')}
              style={{ background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)', padding: '12px', borderRadius: '10px', border: '1px solid #BFDBFE', cursor: 'pointer' }}
            >
              <div style={{ fontSize: '11px', color: '#1E3A8A', fontWeight: 'bold' }}>{nextMonth}月入金予定額</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px', marginTop: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#1E3A8A' }}>¥</span>
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#1E3A8A' }}>520,000</span>
              </div>
              <div style={{ fontSize: '9px', color: '#60A5FA', marginTop: '4px' }}>タップで内訳表示</div>
            </div>

            {/* Expected Payout Card */}
            <div 
              onClick={() => setDetailType('transfer')}
              style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)', padding: '12px', borderRadius: '10px', border: '1px solid #C7D2FE', cursor: 'pointer' }}
            >
              <div style={{ fontSize: '11px', color: '#312E81', fontWeight: 'bold' }}>{nextMonth}月振込予定額</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px', marginTop: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#312E81' }}>¥</span>
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#312E81' }}>430,500</span>
              </div>
              <div style={{ fontSize: '9px', color: '#818CF8', marginTop: '4px' }}>タップで内訳・早期出金</div>
            </div>
          </div>
        </div>

        {/* GPS Clock-in/out (Task fusion) */}
        <div style={{ background: 'var(--surface-color)', borderRadius: '14px', padding: '16px', border: '1px solid var(--border-color)', marginBottom: '16px', boxShadow: '0 2px 6px rgba(0,0,0,0.01)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '20px' }}>location_on</span>
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>本日の現場・出退勤打刻</span>
          </div>

          <div style={{ background: '#F8FAFC', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifySelf: 'space-between', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', background: '#D1FAE5', color: '#065F46', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>出勤対象現場</span>
              <span style={{ fontSize: '11px', color: 'var(--text-sub)', fontWeight: 'bold' }}>10:00 〜 19:00</span>
            </div>
            <strong style={{ fontSize: '13px', display: 'block', color: 'var(--text-main)' }}>auショップ新宿西口店 イベント</strong>
            <div style={{ fontSize: '11px', color: 'var(--text-sub)', marginTop: '2px' }}>現場コード: 【JOB-108273】</div>

            {isCheckedIn && checkinTime && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: '6px', padding: '6px 10px', marginTop: '8px', fontSize: '12px', color: '#065F46', display: 'flex', justifyContent: 'space-between' }}>
                <span>✓ 出勤打刻済み</span>
                <strong>打刻時刻: {checkinTime}</strong>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* GPS verification checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#F1F5F9', padding: '8px 12px', borderRadius: '8px' }}>
              <input 
                type="checkbox" 
                id="gpsSimulate" 
                checked={isSimulatingGps}
                onChange={handleGpsSimulateToggle} 
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="gpsSimulate" style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-main)', cursor: 'pointer', flex: 1 }}>
                GPSシミュレーター（打刻可能エリア内）
              </label>
            </div>

            <button 
              className={`btn-primary ${isCheckedIn ? 'btn-danger' : ''}`}
              onClick={handleCheckin}
              disabled={isVerifyingGps}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '10px',
                border: 'none',
                fontWeight: 'bold',
                fontSize: '14px',
                color: 'white',
                background: isVerifyingGps ? '#94A3B8' : isCheckedIn ? '#EF4444' : 'var(--primary)',
                cursor: isVerifyingGps ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              {isVerifyingGps ? (
                <>
                  <span className="material-symbols-outlined spin-anim" style={{ fontSize: '18px' }}>progress_activity</span>
                  位置情報を確認中...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                    {isCheckedIn ? 'logout' : 'login'}
                  </span>
                  {isCheckedIn ? '退勤を打刻する' : '出勤を打刻する'}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick Summaries & Badges */}
        <div style={{ background: 'var(--surface-color)', borderRadius: '14px', padding: '16px', border: '1px solid var(--border-color)', marginBottom: '16px', boxShadow: '0 2px 6px rgba(0,0,0,0.01)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: '20px' }}>assignment</span>
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-main)' }}>タスクサマリー</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#C2410C', fontWeight: 'bold' }}>報告待ち</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#EA580C', marginTop: '2px' }}>{pendingReportCount}</div>
            </div>
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: '#15803D', fontWeight: 'bold' }}>内定回答待ち</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#16A34A', marginTop: '2px' }}>{offeredCount}</div>
            </div>
          </div>
        </div>
      </main>

      {/* Announcement Detail Popup Modal */}
      {selectedAnn && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 5000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {/* Backdrop */}
          <div onClick={() => setSelectedAnn(null)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }} />

          {/* Modal Content */}
          <div style={{ position: 'relative', background: 'var(--surface-color)', width: '90%', maxWidth: '420px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', maxHeight: '80%', overflow: 'hidden', animation: 'scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-sub)' }}>{selectedAnn.date}</span>
                {selectedAnn.isImportant && <span style={{ background: '#EF4444', color: 'white', padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', marginLeft: '6px' }}>重要</span>}
              </div>
              <button className="icon-btn-dark" onClick={() => setSelectedAnn(null)} style={{ padding: '4px' }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>
            <main style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-main)', margin: '0 0 16px 0', lineHeight: '1.4' }}>{selectedAnn.title}</h2>
              <p style={{ fontSize: '13px', color: '#334155', margin: 0, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{selectedAnn.content}</p>
            </main>
          </div>
        </div>
      )}
    </div>
  );
}
