const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function setup(response){
 const calls=[];const exports={};
 const code=ts.transpileModule(fs.readFileSync('src/lib/contractConfirmation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,crypto:require('node:crypto').webcrypto,TextEncoder,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);return response;},from:()=>{throw new Error('DIRECT_WRITE_FORBIDDEN');}}})});
 return {api:exports,calls};
}
test('条件提示は専用RPCだけを使い、クライアントから金額・役割・承諾済みフラグを送らない',async()=>{
 const {api,calls}=setup({data:'offer-id',error:null});
 assert.equal(await api.createContractOffer({requestId:'same-retry-id',jobId:'ja',agencyId:' demob ',staffId:' demobstaff ',terms:' conditions ',details:{tax:'税込'}}),'offer-id');
 assert.equal(calls[0][0],'connexy_create_contract_offer');
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{request_id:'same-retry-id',target_job:'ja',target_agency:'demob',target_staff:'demobstaff',contract_terms:'conditions',contract_details:{tax:'税込'}});
});
test('確定は提示IDと操作だけを送り、保存結果の契約番号を返す',async()=>{
 const {api,calls}=setup({data:'ct_1',error:null});assert.equal(await api.respondContractOffer('offer-1','confirm'),'ct_1');
 assert.equal(calls[0][0],'connexy_respond_contract_offer');assert.equal(calls[0][1].target_offer,'offer-1');
 assert.deepEqual(Object.keys(calls[0][1]).sort(),['action','target_offer']);
});
test('権限・期限・重複・通信エラーを成功にせず、生のエラーやトークンを表示しない',async()=>{
 for(const code of ['42501','22023','23505','NETWORK']){
  const {api}=setup({data:null,error:{code,message:'SECRET_TOKEN_TEST'}});
  await assert.rejects(api.respondContractOffer('offer-1','confirm'),e=>!e.message.includes('SECRET_TOKEN_TEST'));
 }
});
test('確定結果が欠落・形式不正なら確定成功と扱わない',async()=>{
 for(const data of [null,{},[]]){
  const {api}=setup({data,error:null});await assert.rejects(api.respondContractOffer('offer-1','confirm'));
 }
});
test('一覧は契約テーブル全件取得をせず専用RPCで取得し、不正応答は拒否',async()=>{
 const {api,calls}=setup({data:[],error:null});assert.equal((await api.listContractOffers()).length,0);assert.equal(calls[0][0],'connexy_list_contract_offers');
 await assert.rejects(setup({data:null,error:null}).api.listContractOffers());
});

test('確定文書は対象・版・署名なし表示とSHA256の一致を検証してから返す',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const canonical_payload=JSON.stringify({record_type:'confirmed_contract',version:1,offer_id:id,signature:'none'});
 const sha256=require('node:crypto').createHash('sha256').update(canonical_payload).digest('hex');
 const data={canonical_payload,sha256,filename:`Connexy_contract_${id}_v1.json`};
 const good=setup({data,error:null});assert.equal(JSON.parse((await good.api.exportContractDocument(id)).text).sha256,sha256);
 assert.equal(good.calls[0][0],'connexy_export_contract_document');assert.deepEqual(Object.keys(good.calls[0][1]),['target_offer']);
 const pdf=setup({data,error:null});await pdf.api.exportContractDocument(id,'pdf');assert.equal(pdf.calls[0][0],'connexy_read_contract_pdf_source');assert.deepEqual(Object.keys(pdf.calls[0][1]),['target_offer']);
 for(const bad of [{...data,sha256:'0'.repeat(64)},{...data,canonical_payload:'null'},{...data,filename:'other.json'},{...data,canonical_payload:'SECRET_BROKEN_JSON'}])await assert.rejects(setup({data:bad,error:null}).api.exportContractDocument(id),e=>!e.message.includes('SECRET_BROKEN_JSON'));
});
