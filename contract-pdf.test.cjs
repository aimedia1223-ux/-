const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {createHash}=require('node:crypto');
const exportsPdf={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/contractPdf.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsPdf,require,Intl,Date,ArrayBuffer,Uint8Array});
const {parseContractPdfSource,buildContractPdf}=exportsPdf;
const id='00000000-0000-4000-8000-000000000001',approval='00000000-0000-4000-9000-000000000113';
const font=fs.readFileSync('public/fonts/MPLUS1p-Regular.ttf').toString('base64');
function payload(){return{record_type:'confirmed_contract',version:1,signature:'none',offer_id:id,contract_id:`ct_${id}`,approval_id:approval,approval_number:'TEST-ONLY-NOT-SB-APPROVAL',presented_at:'2026-10-25T13:51:36+00:00',confirmed_at:'2026-10-25T13:56:04+00:00',
 snapshot:{client_name:'架空検証会社A',agency_name:'架空検証会社B',staff_name:'架空担当者B',job:{id:'connexy-browser-contract-test',title:'【ブラウザ検証専用】A社からB社への契約確認',description:'架空データの確認専用です。実契約・支払・稼働ではありません。',detailed_description:'架空会場での表示確認です。実在する店舗や顧客の情報を含みません。',location_name:'架空の検証会場（実在しません）',work_hours:'10:00〜18:00（架空）',requirements:['架空の要件を確認します。','__JOB_CODE__::TEST-ONLY']}},
 work_dates:['2026-11-04'],daily_price:10000,total_price:10000,additional_terms:'ブラウザ検証専用です。実契約・支払・稼働は発生しません。確認後に検証データを削除します。',contract_details:{tax:'架空検証用の税込単価です。',expenses:'架空検証用：経費なし。',payment_due:'2026-11-30',inspection_due:'2026-11-05',termination:'架空検証用：確認後にデータを削除します。',intellectual_property:'成果物・権利移転は発生しません。',liability:'実取引の責任・賠償条件を定めるものではありません。'}};}
function parse(p){const canonical=JSON.stringify(p);return parseContractPdfSource(canonical,createHash('sha256').update(canonical).digest('hex'),id);}
test('確定内容だけを固定の項目へ投影し、内部メタデータを本文に含めない',()=>{
 const p=payload();p.snapshot.extra='SECRET_INTERNAL';p.snapshot.job.secret='SECRET_INTERNAL';const source=parse(p);
 assert.equal(source.contractId,`ct_${id}`);assert.equal(source.version,1);assert.equal(source.testOnly,true);assert.equal(source.requirements.length,1);assert.equal(JSON.stringify(source).includes('SECRET_INTERNAL'),false);
});
test('不正な対象・版・署名・欠落・日付・金額・制御文字はPDF生成前に拒否',()=>{
 for(const change of [p=>p.version=2,p=>p.signature='signed',p=>p.contract_id='other',p=>p.approval_id='broken',p=>p.total_price=1,p=>p.work_dates=['2026-02-30'],p=>p.contract_details.payment_due='broken',p=>p.snapshot.client_name=null,p=>p.confirmed_at='bad',p=>p.additional_terms='bad\u0001text']){const p=payload();change(p);assert.throws(()=>parse(p));}
 assert.throws(()=>parseContractPdfSource('SECRET_BROKEN_JSON','0'.repeat(64),id),e=>!e.message.includes('SECRET_BROKEN_JSON'));
});
test('同梱日本語フォントで通常文書と長文の複数ページを生成',()=>{
 fs.mkdirSync('output/pdf',{recursive:true});
 const normal=buildContractPdf(parse(payload()),font);assert.equal(Buffer.from(normal).subarray(0,4).toString(),'%PDF');fs.writeFileSync('output/pdf/Connexy-contract-example.pdf',Buffer.from(normal));
 const long=payload();long.additional_terms=('長文検証です。文章を省略せず改ページして保持します。'.repeat(180))+'長文末尾確認印';long.contract_details.liability='責任条件の改ページ検証です。'.repeat(65)+'責任末尾確認印';
 fs.writeFileSync('output/pdf/Connexy-contract-long-example.pdf',Buffer.from(buildContractPdf(parse(long),font)));
});
test('未対応文字や壊れたフォントを成功PDFとして扱わない',()=>{
 const p=payload();p.snapshot.staff_name='架空担当者😀';assert.throws(()=>buildContractPdf(parse(p),font),/対応していない文字/);assert.throws(()=>buildContractPdf(parse(payload()),''));
});

test('版2は指定した版でのみ読み、PDFにも版2と改訂条件を反映する',()=>{
 const p=payload();p.version=2;p.amendment_id='00000000-0000-4000-8000-000000000002';p.change_reason='架空の経費条件の変更を確認します。';p.previous_version_sha256='a'.repeat(64);p.contract_details.expenses='架空の変更合意による経費条件です。';p.confirmed_at='2026-10-26T02:00:00Z';const canonical=JSON.stringify(p),hash=createHash('sha256').update(canonical).digest('hex');
 assert.throws(()=>parseContractPdfSource(canonical,hash,id,1));const source=parseContractPdfSource(canonical,hash,id,2);assert.equal(source.version,2);assert.equal(source.details.expenses,p.contract_details.expenses);
 fs.writeFileSync('output/pdf/Connexy-contract-v2-example.pdf',Buffer.from(buildContractPdf(source,font)));
});
