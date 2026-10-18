// Loaded only by the download button. No API or customer-data upload is used.
import { jsPDF } from "jspdf";
import { consultationPdfDateTime, consultationPdfFilename, consultationPdfSections, type ConsultationPdfSection, type ConsultationPdfSnapshot } from "./consultation-pdf-data";

const FONT_FILE = "NanumGothic-Regular.ttf";
const FONT_NAME = "NanumGothic";
let fontPromise: Promise<string> | undefined;

function fontBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + 8192)));
  return btoa(binary);
}
async function loadFont(): Promise<string> {
  if (!fontPromise) fontPromise = (async () => {
    const response = await fetch(`/fonts/${FONT_FILE}`, { credentials: "same-origin", cache: "force-cache", redirect: "error" });
    if (!response.ok) throw new Error("한글 PDF 글꼴을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 1000 || bytes[0] !== 0 || bytes[1] !== 1 || bytes[2] !== 0 || bytes[3] !== 0) throw new Error("한글 PDF 글꼴 파일을 확인할 수 없습니다.");
    return fontBase64(bytes);
  })().catch(error => { fontPromise = undefined; throw error; });
  return fontPromise;
}

// Explicit line-height pagination keeps Korean multi-line rows deterministic,
// including a single memo longer than an entire page. All dimensions are mm.
function drawTable(doc: jsPDF, section: ConsultationPdfSection, startY: number): number {
  const widths = section.widths ?? section.head.map(() => 182 / section.head.length);
  const padding = 2.5, lineHeight = 4.2, bottom = 277;
  let y = startY;
  function drawCells(cells: string[][], offset: number, count: number, height: number, header: boolean, alternate = false) {
    let x = 14;
    doc.setFont(FONT_NAME, "normal"); doc.setFontSize(9);
    doc.setTextColor(30, 41, 59); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15);
    cells.forEach((lines, column) => {
      if (header) doc.setFillColor(226, 232, 240);
      else if (alternate) doc.setFillColor(250, 251, 253);
      else doc.setFillColor(255, 255, 255);
      doc.rect(x, y, widths[column], height, "FD");
      lines.slice(offset, offset + count).forEach((line, index) => doc.text(line, x + padding, y + padding + 3 + index * lineHeight));
      x += widths[column];
    });
    y += height;
  }
  doc.setFont(FONT_NAME, "normal"); doc.setFontSize(9);
  const head = section.head.map((label, column) => doc.splitTextToSize(label, widths[column] - padding * 2) as string[]);
  const headLines = Math.max(...head.map(lines => lines.length));
  const headHeight = headLines * lineHeight + padding * 2;
  const pageBodyHeight = bottom - 23 - headHeight;
  function nextPage() { doc.addPage(); y = 23; drawCells(head, 0, headLines, headHeight, true); }
  drawCells(head, 0, headLines, headHeight, true);
  section.rows.forEach((row, rowIndex) => {
    doc.setFont(FONT_NAME, "normal"); doc.setFontSize(9);
    const cells = row.map((value, column) => doc.splitTextToSize(value || " ", widths[column] - padding * 2) as string[]);
    const lineCount = Math.max(1, ...cells.map(lines => lines.length));
    const height = lineCount * lineHeight + padding * 2;
    if (height <= pageBodyHeight && y + height > bottom) nextPage();
    let offset = 0;
    while (offset < lineCount) {
      const available = Math.floor((bottom - y - padding * 2) / lineHeight);
      if (available < 1) { nextPage(); continue; }
      const count = Math.min(available, lineCount - offset);
      drawCells(cells, offset, count, count * lineHeight + padding * 2, false, rowIndex % 2 === 1);
      offset += count;
      if (offset < lineCount) nextPage();
    }
  });
  return y;
}

/** fontData is supplied only by offline render verification; browsers load our static font asset. */
export async function createConsultationPdf(snapshot: ConsultationPdfSnapshot, fontData?: string): Promise<Blob> {
  const font = fontData ?? await loadFont();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS(FONT_FILE, font);
  doc.addFont(FONT_FILE, FONT_NAME, "normal");
  doc.setFont(FONT_NAME, "normal");
  doc.setProperties({ title: "상담일지", subject: "상담일지 현재 작성본", creator: "LawPower" });
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(23); doc.text("상담일지", 14, 25);
  doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`로파워 | ${consultationPdfDateTime(snapshot.exportedAt)} (한국시간)`, 14, 34);
  doc.text(snapshot.hasUnsavedChanges ? "내보내기 시점의 작성본 · 저장되지 않은 내용 포함" : "내보내기 시점의 상담일지", 14, 40);
  doc.setDrawColor(203, 213, 225); doc.line(14, 45, 196, 45);
  let y = 51;
  for (const section of consultationPdfSections(snapshot)) {
    if (y > 248) { doc.addPage(); y = 24; }
    doc.setFillColor(241, 245, 249); doc.rect(14, y - 2, 182, 9, "F");
    doc.setTextColor(30, 41, 59); doc.setFontSize(11);
    doc.text(section.title, 17, y + 4);
    y = drawTable(doc, section, y + 10) + 9;
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont(FONT_NAME, "normal"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    if (page > 1) doc.text("로파워 | 상담일지", 14, 13);
    doc.setDrawColor(226, 232, 240); doc.line(14, 282, 196, 282);
    doc.text("현재 작성본 · 첨부파일 내용 미포함", 14, 288);
    doc.text(`${page} / ${pages}`, 196, 288, { align: "right" });
  }
  return doc.output("blob");
}

export function downloadConsultationPdf(blob: Blob, snapshot: ConsultationPdfSnapshot): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = consultationPdfFilename(snapshot);
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
