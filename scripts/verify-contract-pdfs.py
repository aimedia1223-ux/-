from pathlib import Path
import json
import pdfplumber
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parents[1]
proof = root / 'tmp' / 'pdfs' / 'contract-preview'
proof.mkdir(parents=True, exist_ok=True)
results = []
for name in ['Connexy-contract-example', 'Connexy-contract-long-example', 'Connexy-contract-v2-example']:
    path = root / 'output' / 'pdf' / (name + '.pdf')
    reader = PdfReader(path)
    text = '\n'.join(p.extract_text() for p in reader.pages)
    for required in ['個別業務委託契約書', '架空検証会社A', '架空検証会社B', '2026-11-30', '2026-11-05', '電子署名', '原データのSHA256', 'TEST-ONLY-NOT-SB-APPROVAL']:
        assert required in text, (name, required)
    assert '__JOB_CODE__' not in text
    assert 'SECRET_INTERNAL' not in text
    if 'v2' in name:
        assert '保存文書の版：2' in text
        assert '架空の変更合意による経費条件です。' in text
        assert '保存文書 版2' in text
    if 'long' in name:
        assert '長文末尾確認印' in text
        assert '責任末尾確認印' in text
        assert len(reader.pages) > 3
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            for c in p.chars:
                assert c['x0'] >= 45 and c['x1'] <= 550, (name, p.page_number, c)
                assert c['top'] >= 12 and c['bottom'] <= 830, (name, p.page_number, c)
    doc = pdfium.PdfDocument(path)
    thumbs = []
    for i in range(len(doc)):
        page = doc[i]
        rendered = page.render(scale=1.5).to_pil().convert('RGB')
        rendered.save(proof / f'{name}-{i+1}.png')
        thumb = ImageOps.contain(rendered, (360, 510))
        tile = Image.new('RGB', (380, 550), '#e2e8f0')
        tile.paste(thumb, ((380-thumb.width)//2, 10))
        ImageDraw.Draw(tile).text((12, 525), f'Page {i+1}/{len(doc)}', fill='black')
        thumbs.append(tile)
        page.close()
    sheet = Image.new('RGB', (380*min(3, len(thumbs)), 550*((len(thumbs)+2)//3)), 'white')
    for i, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((i % 3)*380, (i//3)*550))
    sheet.save(proof / f'{name}-contact-sheet.png')
    doc.close()
    results.append({'file': name, 'pages': len(reader.pages), 'characters': len(text), 'text_and_page_bounds': 'OK'})
print(json.dumps(results, ensure_ascii=False))
