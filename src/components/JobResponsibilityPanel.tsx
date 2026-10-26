import { useEffect, useRef, useState } from 'react';
import type { Job } from '../data/mockDb';
import { getJobResponsibilities, saveJobResponsibilities } from '../lib/jobResponsibilities';
import type { ResponsibilityState } from '../lib/jobResponsibilities';
import { loadResponsibilityList } from '../utils/loadResponsibilityList';
import type { ResponsibilityListItem } from '../utils/loadResponsibilityList';

const selectStyle = {width:'100%',padding:10,border:'1px solid #b9c6d6',borderRadius:8};
export function JobResponsibilityPanel({ jobs, jobsState, onBack }: {
  jobs: Job[]; jobsState: 'loading' | 'ready' | 'error'; onBack: () => void;
}) {
  const [editingJobId,setEditingJobId] = useState<string | null>(null);
  const [items,setItems] = useState<ResponsibilityListItem[]>([]);
  const [loading,setLoading] = useState(true);
  const [notice,setNotice] = useState('');
  const version = useRef(0);
  const active = useRef(true);
  async function reload() {
    const request = ++version.current;
    setItems([]); setLoading(true);
    if (jobsState !== 'ready') return;
    try {
      const next = await loadResponsibilityList(jobs);
      if (active.current && version.current===request) setItems(next);
    } finally { if (active.current && version.current===request) setLoading(false); }
  }
  useEffect(() => {
    active.current = true;
    void reload();
    return () => { active.current = false; ++version.current; };
  }, [jobs,jobsState]);
  function backToList(saved = false) {
    setEditingJobId(null);
    setNotice(saved ? '責任者を保存しました。' : '');
    void reload();
  }
  if (editingJobId !== null) return <JobResponsibilityEditor jobs={jobs} initialJobId={editingJobId}
    onBack={()=>backToList()} onSaved={()=>backToList(true)} />;
  const saved = items.filter(item=>item.status==='saved');
  const unregistered = items.filter(item=>item.status==='unregistered');
  const failed = items.filter(item=>item.status==='error');
  return <div className="overlay-view show" style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
    <header className="solid-header overlay-header"><button onClick={onBack}>管理に戻る</button><h1 style={{fontSize:18}}>案件責任者・保存済み一覧</h1></header>
    <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:90}}>
      <p>保存した責任者を案件ごとに確認できます。画面を開くたびに、保存済みの内容を読み込みます。</p>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
        <button disabled={loading || jobsState!=='ready'} onClick={()=>{setNotice('');void reload();}} style={{padding:10}}>保存済み一覧を更新</button>
        <button disabled={loading || jobsState!=='ready' || jobs.length===0} onClick={()=>{setNotice('');setEditingJobId('');}} style={{padding:10,border:0,borderRadius:8,background:'#0865e8',color:'#fff',fontWeight:700}}>責任者を登録する</button>
      </div>
      {notice && <p role="status" style={{padding:12,background:'#ecfdf5'}}>{notice}</p>}
      {jobsState==='error' ? <p role="alert">自社案件を取得できません。管理画面から案件を再取得してください。</p>
        : loading ? <p role="status">保存済みの責任者を読み込み中…</p> : <>
          <h2 style={{fontSize:17}}>保存済みの案件（{saved.length}件）</h2>
          {saved.length===0 && failed.length===0 && <p>保存済みの責任者はまだありません。「責任者を登録する」から登録してください。</p>}
          {failed.length>0 && <section role="alert" style={{padding:12,background:'#fff7ed',marginBottom:16}}>
            <p>登録状況を確認できない案件が{failed.length}件あります。接続・管理者権限・ログイン期限を確認して一覧を更新してください。</p>
            {failed.map(item=><p key={item.jobId}>{item.title}：取得できませんでした</p>)}
          </section>}
          {saved.map(item=><article key={item.jobId} style={{padding:16,background:'#fff',border:'1px solid #dbe3ed',borderRadius:12,marginBottom:16}}>
            <span style={{color:'#047857',fontWeight:700}}>保存済み</span>
            <h3 style={{fontSize:16,margin:'8px 0'}}>{item.title}</h3>
            {!item.contacts!.is_current && <p style={{color:'#b45309'}}>担当者の所属状態が変わっています。再設定してください。</p>}
            <p>SBとの窓口：{item.contacts!.sb_contact_name}</p>
            <p>二次委託先との窓口：{item.contacts!.agency_contact_name}</p>
            <p>事故対応責任者：{item.contacts!.incident_contact_name}</p>
            <p style={{fontSize:12}}>版：{item.contacts!.version}／更新：{new Date(item.contacts!.updated_at).toLocaleString('ja-JP')}</p>
            <button onClick={()=>setEditingJobId(item.jobId)} style={{padding:'8px 14px'}}>確認・編集</button>
          </article>)}
          {unregistered.length>0 && <details style={{margin:'20px 0'}}><summary>未登録の案件（{unregistered.length}件）</summary>
            {unregistered.map(item=><div key={item.jobId} style={{padding:12,marginTop:8,background:'#fff',borderRadius:8}}>
              <p>{item.title}</p><button onClick={()=>setEditingJobId(item.jobId)}>この案件に登録する</button>
            </div>)}
          </details>}
        </>}
    </main>
  </div>;
}

function JobResponsibilityEditor({ jobs, initialJobId, onBack, onSaved }: {
  jobs: Job[]; initialJobId: string; onBack: () => void; onSaved: () => void;
}) {
  const [jobId,setJobId] = useState(initialJobId);
  const [state,setState] = useState<ResponsibilityState | null>(null);
  const [sb,setSb] = useState('');
  const [agency,setAgency] = useState('');
  const [incident,setIncident] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const generation = useRef(0);
  const active = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    active.current = true;
    if (initialJobId) void load(initialJobId);
    return () => { active.current = false; ++generation.current; };
  }, [initialJobId]);
  async function load(id: string) {
    const request = ++generation.current;
    setState(null); setSb(''); setAgency(''); setIncident(''); setError(''); setMessage('');
    if (!id) { setBusy(false); return; }
    setBusy(true);
    try {
      const next = await getJobResponsibilities(id);
      if (active.current && request===generation.current) {
        setState(next);
        const available = (value?: string) => next.candidates.some(c=>c.id===value) ? value! : '';
        setSb(available(next.contacts?.sb_contact_staff_id));
        setAgency(available(next.contacts?.agency_contact_staff_id));
        setIncident(available(next.contacts?.incident_contact_staff_id));
      }
    } catch (e) {
      if (active.current && request===generation.current) setError(e instanceof Error ? e.message : '登録内容を取得できません。');
    } finally { if (active.current && request===generation.current) setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!state || busy || saving.current) return;
    saving.current = true; setBusy(true); setMessage(''); setError('');
    const request = ++generation.current;
    try {
      const contacts = await saveJobResponsibilities({jobId,sbContact:sb,agencyContact:agency,incidentContact:incident,expectedVersion:state.contacts?.version || 0});
      if (active.current && request===generation.current) {
        setState({...state,contacts}); setMessage('案件の責任者を保存しました。');
        onSaved();
      }
    } catch (e) {
      if (active.current && request===generation.current) {
        setState(null); setError(e instanceof Error ? e.message : '保存結果を確認できません。登録内容を再取得してください。');
      }
    } finally {
      saving.current = false;
      if (active.current && request===generation.current) setBusy(false);
    }
  }
  return <div className="overlay-view show" style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
    <header className="solid-header overlay-header"><button disabled={busy} onClick={onBack}>一覧に戻る</button><h1 style={{fontSize:18}}>案件責任者の登録・編集</h1></header>
    <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:90}}>
      <p>案件ごとに、自社の連絡窓口と事故対応責任者を登録します。同じ担当者の兼任も可能です。</p>
      <p style={{fontSize:13}}>現在は架空データで確認してください。SB担当者の実名や連絡先を入力する項目はありません。</p>
      <label>自社の案件<select value={jobId} disabled={busy} style={selectStyle} onChange={e=>{setJobId(e.target.value);void load(e.target.value);}}>
        <option value="">選択してください</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}
      </select></label>
      <button disabled={!jobId || busy} onClick={()=>void load(jobId)} style={{margin:'12px 0',padding:10}}>登録内容を再取得</button>
      {busy && <p role="status">確認中…</p>}
      {error && <p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
      {message && <p role="status" style={{padding:12,background:'#ecfdf5'}}>{message}</p>}
      {state && <>
        <section style={{padding:16,background:'#fff',borderRadius:12,margin:'12px 0'}}>
          <h2 style={{fontSize:16}}>現在の登録内容</h2>
          {state.contacts ? <>
            {!state.contacts.is_current && <p role="alert">担当者の所属状態が変わっています。有効な担当者へ再設定してください。</p>}
            <p>SBとの窓口：{state.contacts.sb_contact_name}</p>
            <p>二次委託先との窓口：{state.contacts.agency_contact_name}</p>
            <p>事故対応責任者：{state.contacts.incident_contact_name}</p>
            <p style={{fontSize:12}}>版：{state.contacts.version}／更新：{new Date(state.contacts.updated_at).toLocaleString('ja-JP')}</p>
          </> : <p>責任者は未登録です。</p>}
        </section>
        <form onSubmit={save} style={{display:'grid',gap:14}}>
          {([{label:'SBとの窓口（自社担当者）',value:sb,set:setSb},
            {label:'二次委託先との窓口（自社担当者）',value:agency,set:setAgency},
            {label:'事故対応責任者（自社担当者）',value:incident,set:setIncident}]).map(field=><label key={field.label}>{field.label}
            <select required disabled={busy} value={field.value} style={selectStyle} onChange={e=>{field.set(e.target.value);setMessage('');}}>
              <option value="">選択してください</option>{state.candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>)}
          {state.candidates.length===0 && <p>選択できる有効な自社担当者がいません。所属設定を確認してください。</p>}
          <button disabled={busy || !sb || !agency || !incident} style={{padding:12,border:0,borderRadius:8,background:'#0865e8',color:'#fff',fontWeight:700}}>保存して一覧に戻る</button>
        </form>
      </>}
      <p style={{fontSize:13,marginTop:20}}>スタッフへの業務指示・連絡は二次委託先の管理責任者を経由します。この登録によってスタッフへの直接指示や追加の閲覧権限を許可することはありません。</p>
    </main>
  </div>;
}
