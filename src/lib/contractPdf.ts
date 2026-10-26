import {jsPDF} from 'jspdf';

type ContractDetails = {tax:string;expenses:string;payment_due:string;inspection_due:string;termination:string;intellectual_property:string;liability:string};
export type ContractPdfSource = {
  offerId:string;contractId:string;version:1;presentedAt:string;confirmedAt:string;
  clientName:string;agencyName:string;staffName:string;jobTitle:string;description:string;detailedDescription:string|null;
  location:string;hours:string;requirements:string[];dates:string[];dailyPrice:number;totalPrice:number;additionalTerms:string;
  approvalId:string;approvalNumber:string;details:ContractDetails;sourceSha256:string;testOnly:boolean;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function invalid():never {throw new Error('確定内容をPDFとして確認できません。一覧を更新して再取得してください。');}
function text(value:unknown,max=20000):string {if(typeof value!=='string'||!value.trim()||value.length>max||Array.from(value).some(c=>{const n=c.charCodeAt(0);return(n<32&&![9,10,13].includes(n))||n===127;}))invalid();return value;}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>;}
function date(value:unknown):string {const s=text(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)invalid();return s;}
function timestamp(value:unknown):string{const s=text(value,50);if(!/^\d{4}-\d{2}-\d{2}T/.test(s)||!Number.isFinite(Date.parse(s)))invalid();return s;}
function money(value:unknown):number{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)invalid();return value;}
export function parseContractPdfSource(canonical:string,hash:string,offerId:string):ContractPdfSource {
  let raw:unknown;try{raw=JSON.parse(canonical);}catch{invalid();}
  const p=object(raw);if(p.record_type!=='confirmed_contract'||p.version!==1||p.signature!=='none'||p.offer_id!==offerId||!uuid.test(offerId)||p.contract_id!==`ct_${offerId}`||!uuid.test(String(p.approval_id))||!/^([a-f0-9]{64})$/.test(hash))invalid();
  const snapshot=object(p.snapshot),job=object(snapshot.job),details=object(p.contract_details);
  if(!Array.isArray(p.work_dates)||p.work_dates.length<1||p.work_dates.length>366)invalid();
  const dates=p.work_dates.map(date);if(new Set(dates).size!==dates.length)invalid();
  const daily=money(p.daily_price),total=money(p.total_price);if(Math.abs(daily*dates.length-total)>0.001)invalid();
  if(job.requirements!=null&&!Array.isArray(job.requirements))invalid();
  const requirements=((job.requirements||[]) as unknown[]).map(v=>text(v,2000)).filter(v=>!v.startsWith('__'));
  const typedDetails:ContractDetails={tax:text(details.tax,2000),expenses:text(details.expenses,2000),payment_due:date(details.payment_due),inspection_due:date(details.inspection_due),termination:text(details.termination,2000),intellectual_property:text(details.intellectual_property,2000),liability:text(details.liability,2000)};
  return {offerId,contractId:String(p.contract_id),version:1,presentedAt:timestamp(p.presented_at),confirmedAt:timestamp(p.confirmed_at),clientName:text(snapshot.client_name,1000),agencyName:text(snapshot.agency_name,1000),staffName:text(snapshot.staff_name,1000),
    jobTitle:text(job.title,2000),description:text(job.description),detailedDescription:job.detailed_description?text(job.detailed_description):null,
    location:text(job.exact_location||job.work_location||job.location_name||'案件に指定なし',2000),hours:text(job.work_hours||'案件に指定なし',2000),requirements,dates,dailyPrice:daily,totalPrice:total,additionalTerms:text(p.additional_terms),
    approvalId:String(p.approval_id),approvalNumber:text(p.approval_number,1000),details:typedDetails,sourceSha256:hash,testOnly:job.id==='connexy-browser-contract-test'};
}

export function buildContractPdf(source:ContractPdfSource,fontBase64:string):ArrayBuffer {
  if(fontBase64.length<1000||!fontBase64.startsWith('AAEAAA'))throw new Error('PDF用の日本語フォントを確認できません。');
  const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  doc.addFileToVFS('MPLUS1p-Regular.ttf',fontBase64);doc.addFont('MPLUS1p-Regular.ttf','ConnexyJapanese','normal');doc.setFont('ConnexyJapanese');
  const font=doc.getFont() as unknown as {metadata?:{characterToGlyph?:(code:number)=>number}};
  if(!font.metadata?.characterToGlyph)throw new Error('日本語フォントを読み込めません。PDFの生成を停止しました。');
  const glyph=font.metadata.characterToGlyph.bind(font.metadata);
  const left=18,width=174,bottom=272;let y=38;
  const drawText=(value:string,x:number,lineY:number,size=10)=>{
    // 存在しない字を黙って欠落させない。絵文字・未対応の異体字等は出力を停止。
    for(const char of value){if(char==='\n'||char==='\r'||char==='\t')continue;const code=char.codePointAt(0)!;if(code>65535||!glyph(code))throw new Error('PDF用フォントに対応していない文字があります。JSON出力で内容を確認してください。');}
    doc.setFontSize(size);doc.text(value,x,lineY);
  };
  function header(){doc.setFillColor(18,38,62);doc.rect(0,0,210,25,'F');doc.setTextColor(255);drawText('Connexy  /  個別業務委託契約書',left,15,15);doc.setTextColor(35,48,65);}
  function next(){doc.addPage();header();y=38;}
  function room(height:number){if(y+height>bottom)next();}
  function lines(value:string,size=10){doc.setFontSize(size);return doc.splitTextToSize(value.replace(/\r\n?/g,'\n').replace(/\t/g,'    '),width) as string[];}
  function paragraph(value:string,size=10){for(const line of lines(value,size)){room(5.8);drawText(line,left,y,size);y+=5.8;}y+=2;}
  function section(label:string,value:string){room(20);doc.setDrawColor(210,220,230);doc.line(left,y-4,192,y-4);doc.setTextColor(25,75,125);drawText(label,left,y+1,11);y+=9;doc.setTextColor(35,48,65);paragraph(value);}
  function jpTime(value:string){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))+'（日本時間）';}
  header();
  if(source.testOnly){doc.setTextColor(160,55,20);paragraph('架空検証専用 / 実契約・支払・稼働は発生しません。',11);doc.setTextColor(35,48,65);}
  paragraph('確定済みの保存内容を表示した文書です。電子署名は付与されていません。',9);
  section('01  契約の識別',`契約番号：${source.contractId}\n提示番号：${source.offerId}\n保存文書の版：${source.version}\n提示日時：${jpTime(source.presentedAt)}\n確定日時：${jpTime(source.confirmedAt)}`);
  section('02  契約当事者・従事者',`一次委託先：${source.clientName}\n二次委託先：${source.agencyName}\n対象スタッフ：${source.staffName}`);
  section('03  業務内容',`${source.jobTitle}\n${source.description}${source.detailedDescription?'\n'+source.detailedDescription:''}${source.requirements.length?'\n要件：\n'+source.requirements.join('\n'):''}`);
  section('04  業務場所・日程',`場所：${source.location}\n時間：${source.hours}\n日程：${source.dates.join('、')}`);
  section('05  単価・合計・税・経費',`単価：${source.dailyPrice.toLocaleString('ja-JP')} 円 / 日\n日数分の合計：${source.totalPrice.toLocaleString('ja-JP')} 円（${source.dates.length}日）\n税の取扱い：${source.details.tax}\n経費の負担・精算方法：${source.details.expenses}`);
  section('06  支払日・検査期限',`支払日：${source.details.payment_due}\n検査期限：${source.details.inspection_due}`);
  section('07  中途解約の条件',source.details.termination);
  section('08  成果物・知的財産の取扱い',source.details.intellectual_property);
  section('09  責任・損害賠償の条件',source.details.liability);
  section('10  追加条件',source.additionalTerms);
  section('11  再委託承諾の照合記録',`承諾照合番号：${source.approvalNumber}\n照合記録ID：${source.approvalId}\n承諾書の原本は本PDFに含みません。`);
  section('12  保存内容の確認',`原データのSHA256：\n${source.sourceSha256}\nこの値は保存済み原データの内容確認用です。PDF自体のハッシュ、電子署名、第三者による時刻証明ではありません。\nPDFへの出力は契約条件を変更せず、新しい合意や承諾を与える操作ではありません。`);
  const pages=doc.getNumberOfPages();if(pages>100)throw new Error('PDFのページ数が上限を超えました。JSON出力を利用してください。');
  for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor(210,220,230);doc.line(18,281,192,281);doc.setTextColor(90);drawText(`Connexy / 保存文書 版1 / 電子署名なし`,18,287,8);drawText(`${page} / ${pages}`,181,287,8);}
  doc.setProperties({title:'個別業務委託契約書（確定内容）',subject:'確定済みの保存内容・電子署名なし',creator:'Connexy',author:'Connexy'});
  return doc.output('arraybuffer');
}
