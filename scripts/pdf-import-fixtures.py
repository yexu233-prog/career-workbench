"""Fictional import-regression PDFs. No user documents or personal data."""
import io
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from pypdf import PdfReader, PdfWriter

output = Path("tmp/pdf-import-regression/fixtures")
output.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))

def make_pdf(path, pages=1, chinese=False, blank=False):
    data = io.BytesIO()
    doc = canvas.Canvas(data, pagesize=(595.276, 841.89))
    for page in range(1, pages + 1):
        if not blank:
            doc.setFont("Helvetica", 14)
            doc.drawString(42, 770, f"FICTIONAL RESUME - PAGE {page} / {pages}")
            doc.drawString(42, 745, "Example University | Example Company | Product Manager")
            if chinese:
                doc.setFont("STSong-Light", 14)
                doc.drawString(42, 710, "虚构测试简历：示例大学、示例公司、产品经理。")
                doc.drawString(42, 685, "推动需求交付，复盘项目成果。")
        doc.showPage()
    doc.save()
    path.write_bytes(data.getvalue())

make_pdf(output / "fictional-mixed-multipage.pdf", pages=3, chinese=True)
make_pdf(output / "no-text.pdf", blank=True)
make_pdf(output / "too-many-pages.pdf", pages=301, blank=True)
writer = PdfWriter()
writer.append(PdfReader(output / "fictional-mixed-multipage.pdf"))
writer.encrypt("fictional-test-password", algorithm="AES-256")
with (output / "password-protected.pdf").open("wb") as handle:
    writer.write(handle)
print("Created 4 fictional PDF test fixtures")
