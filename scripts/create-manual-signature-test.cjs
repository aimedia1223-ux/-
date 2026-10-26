// 架空文書だけをローカル生成。電子署名や第三者の時刻証明はここでは発行しない。
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{jsPDF}=require('jspdf');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'output/pdf');fs.mkdirSync(dir,{recursive:true});
if(fs.existsSync(path.join(dir,'Connexy-signature-test.pdf'))||fs.existsSync(path.join(dir,'Connexy-signature-test-manifest.json')))throw new Error('検証用原本は既にあります。送信前後の照合用に保持し、上書きしません。新しい検証は別の文書番号で作成してください。');
const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
doc.addFileToVFS('MPLUS1p-Regular.ttf',fs.readFileSync(path.join(root,'public/fonts/MPLUS1p-Regular.ttf')).toString('base64'));
doc.addFont('MPLUS1p-Regular.ttf','Japanese','normal');doc.setFont('Japanese');
doc.setFillColor(18,38,62);doc.rect(0,0,210,28,'F');doc.setTextColor(255);doc.setFontSize(16);doc.text('Connexy / 電子署名・時刻証明の検証',18,17);
doc.setTextColor(30,45,62);let y=43;
function paragraph(value,size=11){doc.setFontSize(size);for(const line of doc.splitTextToSize(value,174)){doc.text(line,18,y);y+=6.2;}y+=4;}
function section(title,value){doc.setTextColor(25,75,125);paragraph(title,12);doc.setTextColor(30,45,62);paragraph(value);}
doc.setTextColor(160,55,20);paragraph('検証専用文書 / 実契約・実取引なし',14);doc.setTextColor(30,45,62);
paragraph('検証文書番号：CONNEXY-SIGNATURE-TEST-20261026-01\n作成日：2026-10-26\n版：1');
section('1. 検証の目的','外部の電子契約サービスで、文書の送信・受信・確認操作、電子署名の付与、第三者によるタイムスタンプの付与と検証ができるか確認します。');
section('2. 取引条件を定めないこと','本書は操作確認のための架空文書です。業務の発注・受注、金銭の支払、スタッフの稼働、成果物の納品、知的財産の移転、損害賠償その他の実取引の条件は定めません。');
section('3. 確認する内容','送信者と受信者は、それぞれ自身で管理する検証用の連絡先を使用します。確認操作は検証の実施を確認するために行い、実際の業務委託契約の締結を目的としません。');
section('4. 完了後の確認','電子契約サービスから署名済みPDFと締結の証跡を取得し、書類IDが一致すること、電子署名とタイムスタンプの検証結果を確認します。文書の見た目の押印画像や入力された日時だけを検証結果とは扱いません。');
section('5. 署名・時刻証明の状態','電子署名とタイムスタンプの付与・有効性は、外部サービスの検証画面または取得したPDFの署名情報で確認してください。この本文自体は、署名や時刻証明の完了を示すものではありません。');
if(y>274)throw new Error('検証文書が1ページに収まりません。');
doc.setDrawColor(210,220,230);doc.line(18,280,192,280);doc.setFontSize(8);doc.setTextColor(85);doc.text('検証専用 / 本文と署名情報を併せて確認してください。',18,287);doc.text('1 / 1',181,287);
doc.setProperties({title:'電子署名・時刻証明の検証（実取引なし）',author:'Connexy',creator:'Connexy'});
const file=path.join(dir,'Connexy-signature-test.pdf'),bytes=Buffer.from(doc.output('arraybuffer'));fs.writeFileSync(file,bytes);
fs.writeFileSync(path.join(dir,'Connexy-signature-test-manifest.json'),JSON.stringify({document_id:'CONNEXY-SIGNATURE-TEST-20261026-01',version:1,filename:path.basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),signature:'not_issued',trusted_timestamp:'not_issued',purpose:'test_only_no_real_transaction'},null,2));
console.log(JSON.stringify({pdf:file,pages:doc.getNumberOfPages(),size:bytes.length}));
