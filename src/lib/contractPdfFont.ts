// 自社配信の公開フォントだけをキャッシュする。契約データは保存しない。
let pending:Promise<string>|null=null;
export function loadContractPdfFont():Promise<string>{
  pending ||= fetch(`${import.meta.env.BASE_URL}fonts/MPLUS1p-Regular.ttf`,{credentials:'same-origin'})
    .then(async response=>{
      if(!response.ok)throw new Error('PDF用の日本語フォントを取得できません。再度お試しください。');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length<1000||bytes.length>3000000||bytes[0]!==0||bytes[1]!==1||bytes[2]!==0||bytes[3]!==0)throw new Error('PDF用の日本語フォントを確認できません。');
      let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
    }).catch(error=>{pending=null;throw error;});
  return pending;
}
