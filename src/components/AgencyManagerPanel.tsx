import { useEffect, useRef, useState } from 'react';
import { listAgencyManagers, saveAgencyManager } from '../lib/agencyManagers';
import type { AgencyManagerState, AgencyManagerScope } from '../lib/agencyManagers';

export function AgencyManagerPanel({ onBack }: { onBack: () => void }) {
  const [state,setState] = useState<AgencyManagerState | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [editing,setEditing] = useState<string | null>(null);
  const [managerId,setManagerId] = useState('');
  const active = useRef(true);
  const version = useRef(0);
  const saving = useRef(false);
  async function reload() {
    const request = ++version.current;
    setState(null); setEditing(null); setManagerId(''); setError(''); setBusy(true);
    try {
      const next = await listAgencyManagers();
      if (active.current && request===version.current) setState(next);
    } catch(e) {
      if (active.current && request===version.current) setError(e instanceof Error ? e.message : '一覧を取得できません。');
    } finally { if (active.current && request===version.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true; void reload();
    return () => { active.current = false; ++version.current; };
  }, []);
  async function save(scope: AgencyManagerScope,event: React.FormEvent) {
    event.preventDefault();
    if (busy || saving.current || !managerId) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await saveAgencyManager(scope.approval_id,managerId,scope.manager?.version || 0);
      if (active.current) { setNotice('二次委託先の管理責任者を保存しました。'); await reload(); }
    } catch(e) {
      if (active.current) { setState(null); setEditing(null); setError(e instanceof Error ? e.message : '保存結果を確認できません。一覧を更新してください。'); }
    } finally { saving.current = false; if (active.current) setBusy(false); }
  }
  function card(scope: AgencyManagerScope) {
    return <article key={scope.approval_id} style={{padding:16,marginBottom:16,background:'#fff',border:'1px solid #dbe3ed',borderRadius:12}}>
      <strong style={{color:scope.has_assignment?'#047857':'#b45309'}}>{scope.has_assignment ? '保存済み' : '管理責任者は未登録'}</strong>
      <h3 style={{fontSize:16,margin:'10px 0'}}>{scope.job_title}</h3>
      <p style={{fontSize:13}}>{scope.side==='agency' ? '自社が二次委託先の案件' : '自社が一次委託先の案件'}</p>
      {!scope.approved && <p role="note" style={{color:'#b45309'}}>承諾の再確認が必要です。相手会社の詳細と連絡窓口は非公開です。</p>}
      {scope.approved && <>
        <p>一次委託先：{scope.client_name}／二次委託先：{scope.agency_name}</p>
        <p>一次委託先の窓口：{scope.primary_contacts?.agency_contact_name || '未登録・再確認が必要'}</p>
        <p>一次委託先の事故対応責任者：{scope.primary_contacts?.incident_contact_name || '未登録・再確認が必要'}</p>
      </>}
      {scope.manager ? <>
        <p>二次委託先の管理責任者：<strong>{scope.manager.manager_name}</strong></p>
        {!scope.manager.is_current && <p style={{color:'#b45309'}}>担当者の所属状態が変わっています。再設定してください。</p>}
        <p style={{fontSize:12}}>版：{scope.manager.version}／更新：{new Date(scope.manager.updated_at).toLocaleString('ja-JP')}</p>
      </> : scope.has_assignment ? <p>管理責任者の有効性を再確認してください。</p> : null}
      {scope.approved && <p style={{padding:12,background:'#eff6ff',fontSize:13}}>業務連絡の経路：一次委託先の窓口 → 二次委託先の管理責任者 → 二次委託先の自社スタッフ</p>}
      {scope.can_edit && (editing===scope.approval_id ? <form onSubmit={event=>void save(scope,event)} style={{display:'grid',gap:12}}>
        <label>自社の管理責任者<select required disabled={busy} value={managerId} onChange={e=>setManagerId(e.target.value)} style={{width:'100%',padding:10,border:'1px solid #b9c6d6',borderRadius:8}}>
          <option value="">選択してください</option>{state!.candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select></label>
        <button disabled={busy || !managerId} style={{padding:10}}>保存して一覧に反映</button>
        <button type="button" disabled={busy} onClick={()=>setEditing(null)}>編集を閉じる</button>
      </form> : <button disabled={busy} onClick={()=>{
        setEditing(scope.approval_id); setManagerId(state!.candidates.some(c=>c.id===scope.manager?.manager_staff_id) ? scope.manager!.manager_staff_id : '');setNotice('');
      }}>{scope.has_assignment?'確認・編集':'管理責任者を登録'}</button>)}
      {scope.side==='client' && <p style={{fontSize:12}}>二次委託先の管理責任者は、二次委託先の管理者が登録・変更します。</p>}
    </article>;
  }
  return <div className="overlay-view show" style={{zIndex:1150,display:'flex',flexDirection:'column'}}>
    <header className="solid-header overlay-header"><button disabled={busy} onClick={onBack}>管理に戻る</button><h1 style={{fontSize:17}}>二次委託先の管理責任者</h1></header>
    <main className="list-area bg-gray" style={{padding:20,overflowY:'auto',paddingBottom:90}}>
      <p>二次委託先が自社の管理責任者を登録し、双方の窓口を確認する画面です。現在は架空データで確認してください。</p>
      <button disabled={busy} onClick={()=>{setNotice('');void reload();}} style={{padding:10,marginBottom:12}}>保存済み一覧を更新</button>
      {notice && <p role="status" style={{padding:12,background:'#ecfdf5'}}>{notice}</p>}
      {error && <p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
      {busy && <p role="status">確認中…</p>}
      {state && <>
        <h2 style={{fontSize:17}}>保存済みの登録（{state.items.filter(item=>item.has_assignment).length}件）</h2>
        {state.items.filter(item=>item.has_assignment).map(card)}
        {state.items.every(item=>!item.has_assignment) && <p>保存済みの登録はまだありません。</p>}
        <h2 style={{fontSize:17,marginTop:24}}>承諾済み・未登録の案件</h2>
        {state.items.filter(item=>!item.has_assignment).map(card)}
        {state.items.every(item=>item.has_assignment) && <p>登録できる承諾済み案件はありません。</p>}
      </>}
      <p style={{fontSize:13}}>責任者の登録でスタッフの閲覧権限は増えません。スタッフへの直接連絡やチャット送信は、この画面では行いません。</p>
    </main>
  </div>;
}
