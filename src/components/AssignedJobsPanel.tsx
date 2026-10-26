import type { Job } from '../data/mockDb';
import { formatJobDates } from '../utils/dateFormatter';

interface Props {
  jobs: Job[];
  state: 'loading' | 'ready' | 'error';
  onBack: () => void;
  onReload: () => void;
}

// 取得済みの許可範囲だけを表示する。選考・契約確定・権限変更の操作は持たない。
export function AssignedJobsPanel({ jobs, state, onBack, onReload }: Props) {
  return (
    <div className="overlay-view show" style={{ zIndex: 1100, display: 'flex', flexDirection: 'column' }}>
      <header className="solid-header overlay-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="icon-btn-dark" onClick={onBack} aria-label="管理画面へ戻る">
          <span className="material-symbols-outlined">arrow_back_ios_new</span>
        </button>
        <h1 style={{ fontSize: '16px', fontWeight: 'bold' }}>担当案件</h1>
        <div style={{ width: '40px' }} />
      </header>
      <main className="list-area bg-gray" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {state === 'loading' && <p role="status">担当案件を読み込み中…</p>}
        {state === 'error' && <div role="alert">担当案件を取得できませんでした。<button onClick={onReload}>再読み込み</button></div>}
        {state === 'ready' && <>
          <h2 style={{ fontSize: '14px' }}>担当案件一覧（{jobs.length}件）</h2>
          {jobs.length === 0 && <p>現在、閲覧できる担当案件はありません。</p>}
          {jobs.map(job => <article key={job.id} style={{ background: 'var(--surface-color)', padding: '16px', border: '1px solid var(--border-color)', borderRadius: '12px', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', margin: '0 0 8px' }}>{job.title}</h3>
            {job.jobCode && <p style={{ fontSize: '12px' }}>案件コード：{job.jobCode}</p>}
            <p>{job.description}</p>
            <dl style={{ fontSize: '13px' }}>
              <dt>日程</dt><dd>{job.eventDate ? formatJobDates(job.eventDate) : '未設定'}</dd>
              <dt>場所</dt><dd>{job.locationName || '未設定'}</dd>
              <dt>時間</dt><dd>{job.workHours || '未設定'}</dd>
            </dl>
          </article>)}
        </>}
      </main>
    </div>
  );
}
