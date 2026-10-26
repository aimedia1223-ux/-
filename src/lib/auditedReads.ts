import {supabase} from './supabase';
import {readColumns} from '../data/readColumns';
export type ReadTable=keyof typeof readColumns;
export async function readAuditedRows(table:ReadTable,options:{id?:string;company?:string;limit?:number;offset?:number}={}):Promise<Record<string,unknown>[]>{
 const result:Record<string,unknown>[]=[];let offset=options.offset??0;let scope:string|undefined;
 if(options.limit!==undefined&&(!Number.isSafeInteger(options.limit)||options.limit<1))throw new Error('取得件数を確認してください。');
 if(!Number.isSafeInteger(offset)||offset<0)throw new Error('取得位置を確認してください。');
 do{
  const size=options.limit===undefined?200:Math.min(options.limit-result.length,200);
  const {data,error}=await supabase.rpc('connexy_read_data',{target_table:table,target_id:options.id??null,target_company:options.company??null,page_size:size,page_offset:offset});
  if(error)throw error;
  if(!data||!Array.isArray(data.rows)||!Array.isArray(data.scope)||data.scope.length!==4||data.scope.some((v:unknown)=>typeof v!=='string')
    ||data.rows.some((r:{id?:unknown})=>!r||typeof r.id!=='string'))throw new Error('監査付き一覧の取得結果を確認できません。');
  const currentScope=JSON.stringify(data.scope);
  if(scope!==undefined&&scope!==currentScope)throw new Error('取得中にアカウント・所属・権限が変更されました。一覧を開き直してください。');
  scope=currentScope;
  const columns=readColumns[table].split(',');
  result.push(...data.rows.map((r:Record<string,unknown>)=>Object.fromEntries(columns.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]))));
  if(data.rows.length<size||(options.limit!==undefined&&result.length>=options.limit))break;
  offset+=size;
 }while(options.limit===undefined||result.length<options.limit);
 return result;
}
export async function getStaffCsv():Promise<{csv:string;filename:string;count:number}>{
 const{data,error}=await supabase.rpc('connexy_export_staff_csv');
 if(error)throw new Error(error.code==='42501'?'自社管理者の追加認証を確認してください。':'出力結果を確認できません。接続と125番SQLの適用を確認してください。');
 if(!data||typeof data.csv!=='string'||data.filename!=='Connexy_staffs.csv'||!Number.isSafeInteger(data.count)||data.count<0)throw new Error('出力結果を確認できません。');
 return{csv:data.csv,filename:data.filename,count:data.count};
}
