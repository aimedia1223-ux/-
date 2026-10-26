from pathlib import Path
import json, hashlib
from pypdf import PdfReader
import pdfplumber
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
file = root / 'output/pdf/Connexy-signature-test.pdf'
manifest = json.loads((root / 'output/pdf/Connexy-signature-test-manifest.json').read_text())
assert hashlib.sha256(file.read_bytes()).hexdigest() == manifest['sha256']
reader = PdfReader(file)
assert len(reader.pages) == 1
text = reader.pages[0].extract_text()
for word in ['実契約・実取引なし', 'CONNEXY-SIGNATURE-TEST-20261026-01', '第三者によるタイムスタンプ', '実際の業務委託契約の締結を目的としません', '完了を示すものではありません']:
    assert ''.join(word.split()) in ''.join(text.split()), word
assert '/AcroForm' not in reader.trailer['/Root']
with pdfplumber.open(file) as pdf:
    for c in pdf.pages[0].chars:
        assert c['x0'] >= 45 and c['x1'] <= 550
        assert c['top'] >= 12 and c['bottom'] <= 830
target = root / 'tmp/pdfs/manual-signature'
target.mkdir(parents=True, exist_ok=True)
doc = pdfium.PdfDocument(file)
page = doc[0]
page.render(scale=1.5).to_pil().save(target / 'unsigned-test-preview.png')
page.close()
doc.close()
print(json.dumps({'pages': 1, 'text_and_bounds': 'OK', 'unsigned': True, 'original_sha256': manifest['sha256']}))
