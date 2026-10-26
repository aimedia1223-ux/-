import {exportContractDocument} from './contractConfirmation';
export async function prepareContractFile(offerId:string,version:number,format:'json'|'pdf',canContinue:()=>boolean):Promise<{blob:Blob;filename:string}|null>{
 if(format==='json'){
  const file=await exportContractDocument(offerId,'json',version);if(!canContinue())return null;
  return{blob:new Blob([file.text],{type:'application/json;charset=utf-8'}),filename:file.filename};
 }
 const[{buildContractPdf,parseContractPdfSource},{loadContractPdfFont}]=await Promise.all([import('./contractPdf'),import('./contractPdfFont')]);
 const font=await loadContractPdfFont();if(!canContinue())return null;
 const file=await exportContractDocument(offerId,'pdf',version);if(!canContinue())return null;
 const envelope=JSON.parse(file.text),source=parseContractPdfSource(envelope.canonical_payload,envelope.sha256,offerId,version);
 const bytes=buildContractPdf(source,font);if(!canContinue())return null;
 return{blob:new Blob([bytes],{type:'application/pdf'}),filename:`Connexy_contract_${offerId}_v${version}.pdf`};
}
export function savePreparedContractFile(file:{blob:Blob;filename:string}){
 const url=URL.createObjectURL(file.blob),link=document.createElement('a');link.href=url;link.download=file.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
