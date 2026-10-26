const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');const{webcrypto,createHash}=require('node:crypto');
const id='00000000-0000-4000-8000-000000000011';
const checks=['return','external_files','downloads','backups','subcontractor'].map(category=>({category,status:'pending',evidence_reference:null,evidence_sha256:null,version:1,updated_at:null}));
const record={id,deletion_event_id:'25',action:'approval.deleted',target_type:'approval',target_id:'test',deleted_at:'2026-10-25T00:00:00Z',created_at:'2026-10-25T01:00:00Z',recorded_by_staff_id:'s',scope:'application_target_only',external_verification:'unverified',checks};
function load(response){const calls=[],exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/deletionRecords.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
 {exports,crypto:webcrypto,TextEncoder,Uint8Array,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);return response;}}})});return{api:exports,calls};}
test('一覧と作成には会社・権限・削除済みの自己申告を渡さず、余分なUIDを破棄する',async()=>{
 let{api,calls}=load({data:{records:[{...record,created_by:'SECRET'}],candidates:[]},error:null});assert.equal(JSON.stringify(await api.listDeletionRecords()).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_list_deletion_records']]);
 ({api,calls}=load({data:id,error:null}));assert.equal(await api.createDeletionRecord('25'),id);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_create_deletion_record',{target_event:'25'}]]);
});
test('確認状況は版付きで保存し、未確認に戻す時は証跡の自己申告を消す',async()=>{
 const{api,calls}=load({data:null,error:null});await api.saveDeletionCheck(id,checks[0],'pending','SECRET','SECRET');
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_save_deletion_check',{target_record:id,target_category:'return',check_status:'pending',evidence_reference:null,evidence_sha256:null,expected_version:1}]]);
});
test('未検証表示の出力だけを許し、ハッシュ・対象・ファイル名・完全削除への偽装を検出する',async()=>{
 const payload=JSON.stringify({record_type:'application_deletion_execution_record',record,signature:'none'});
 const file={canonical_payload:payload,sha256:createHash('sha256').update(payload).digest('hex'),filename:`Connexy_deletion_record_${id}.json`};
 const{api}=load({data:file,error:null});assert.equal((await api.exportDeletionRecord(id)).filename,file.filename);
 for(const data of [{...file,sha256:'0'.repeat(64)},{...file,filename:'../../bad.json'},
  {...file,canonical_payload:JSON.stringify({record_type:'complete_deletion_certificate',record,signature:'verified'})},
  {...file,canonical_payload:'SECRET-invalid-json'}]){const bad=load({data,error:null});await assert.rejects(bad.api.exportDeletionRecord(id),e=>!e.message.includes('SECRET'));}
});
test('権限・競合・未適用・壊れた外部確認状態を成功扱いにしない',async()=>{
 for(const code of ['42501','40001','22023','PGRST202']){const{api}=load({data:null,error:{code,message:'SECRET'}});await assert.rejects(api.listDeletionRecords(),e=>!e.message.includes('SECRET'));await assert.rejects(api.createDeletionRecord('25'));await assert.rejects(api.exportDeletionRecord(id));}
 for(const r of [{...record,external_verification:'verified'},{...record,checks:[]},{...record,deleted_at:'bad'}]){const{api}=load({data:{records:[r],candidates:[]},error:null});await assert.rejects(api.listDeletionRecords());}
});
