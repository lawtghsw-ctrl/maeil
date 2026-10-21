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

// A4 portrait, with no fit-to-page scaling: values stay at 10 pt even for long records.
const PAGE = { left: 9, right: 201, width: 192, top: 15, bottom: 282 };
const BODY_SIZE = 10, LABEL_SIZE = 9, LINE_HEIGHT = 4.2, PADDING = 1.2, ROW_PADDING = 0.8;
interface Cell { lines: string[]; width: number; label?: boolean }

function textLines(doc: jsPDF, text: string, width: number, size = BODY_SIZE): string[] {
  doc.setFontSize(size);
  // jsPDF wraps Korean and ordinary words; enforce the bound again for long unbroken
  // input and font-metric edge cases. Array.from never cuts a UTF-16 surrogate pair.
  const lines: string[] = [];
  for (const line of doc.splitTextToSize(text || " ", width) as string[]) {
    if (doc.getTextWidth(line) <= width + 0.01) { lines.push(line); continue; }
    let part = "";
    for (const character of Array.from(line)) {
      if (part && doc.getTextWidth(part + character) > width) { lines.push(part); part = ""; }
      part += character;
    }
    lines.push(part);
  }
  return lines.length ? lines : [""];
}

function drawSections(doc: jsPDF, sections: ConsultationPdfSection[], startY: number): void {
  let y = startY;
  const setInk = () => { doc.setFont(FONT_NAME, "normal"); doc.setTextColor(30, 41, 59); };
  const rowHeight = (cells: Cell[]) => Math.max(1, ...cells.map(cell => cell.lines.length)) * LINE_HEIGHT + ROW_PADDING * 2;
  function drawCells(cells: Cell[], offset: number, count: number, header = false, alternate = false): void {
    const height = count * LINE_HEIGHT + ROW_PADDING * 2;
    let x = PAGE.left;
    doc.setDrawColor(218, 224, 231); doc.setLineWidth(0.12);
    for (const cell of cells) {
      const shade = header || cell.label;
      if (shade) doc.setFillColor(242, 245, 248);
      else if (alternate) doc.setFillColor(251, 252, 253);
      else doc.setFillColor(255, 255, 255);
      doc.rect(x, y, cell.width, height, "FD");
      const size = shade ? LABEL_SIZE : BODY_SIZE;
      setInk(); doc.setFontSize(size);
      cell.lines.slice(offset, offset + count).forEach((line, index) => {
        doc.text(line, x + PADDING, y + ROW_PADDING + size / doc.internal.scaleFactor * 0.8 + index * LINE_HEIGHT);
      });
      x += cell.width;
    }
    y += height;
  }
  for (const section of sections) {
    const fields = section.layout === "fields", memo = section.layout === "memo";
    const sourceWidths = section.widths ?? section.head.map(() => 1);
    const totalWidth = sourceWidths.reduce((sum, width) => sum + width, 0);
    const widths = sourceWidths.map(width => width / totalWidth * PAGE.width);
    const cellsFor = (values: string[], header = false): Cell[] => values.map((value, index) => ({
      width: widths[index], label: fields && index % 2 === 0,
      lines: textLines(doc, value, widths[index] - PADDING * 2, header || (fields && index % 2 === 0) ? LABEL_SIZE : BODY_SIZE),
    }));
    const memoRows = memo ? section.rows.map(row => ({
      metadata: row.length > 1 ? textLines(doc, row[0].replace(/\n/g, " · "), PAGE.width - PADDING * 2, LABEL_SIZE) : [],
      body: textLines(doc, row[row.length - 1], PAGE.width - PADDING * 2),
    })) : [];
    const lineBlockHeight = (lines: string[]) => lines.length ? lines.length * LINE_HEIGHT + ROW_PADDING * 2 : 0;
    const minimumLine = LINE_HEIGHT + ROW_PADDING * 2;
    const headingHeight = 6;
    const head = !fields && !memo ? cellsFor(section.head, true) : [];
    const headHeight = head.length ? rowHeight(head) : 0;
    const freshBody = PAGE.bottom - PAGE.top - headingHeight - headHeight;
    function heading(continued = false): void {
      doc.setFillColor(230, 235, 241); doc.rect(PAGE.left, y, PAGE.width, 5.4, "F");
      setInk(); doc.setFontSize(10);
      doc.text(`${section.title}${continued ? " (계속)" : ""}`, PAGE.left + PADDING, y + 3.9);
      y += headingHeight;
      if (head.length) drawCells(head, 0, Math.max(...head.map(cell => cell.lines.length)), true);
    }
    function nextPage(): void { doc.addPage(); y = PAGE.top; heading(true); }
    // Keep a heading with a complete ordinary first row when possible. Huge rows
    // need only their first line here; they are safely split below.
    const firstMemo = memoRows[0];
    const firstRow = firstMemo ? lineBlockHeight(firstMemo.metadata) + lineBlockHeight(firstMemo.body)
      : section.rows.length ? rowHeight(cellsFor(section.rows[0])) : minimumLine;
    const memoStart = firstMemo ? lineBlockHeight(firstMemo.metadata) + minimumLine : minimumLine;
    const minimumBody = firstRow <= freshBody ? firstRow : memoStart <= freshBody ? memoStart : minimumLine;
    if (y + headingHeight + headHeight + minimumBody > PAGE.bottom) { doc.addPage(); y = PAGE.top; }
    heading();
    if (memo) {
      memoRows.forEach(({ metadata: metaLines, body: bodyLines }, rowIndex) => {
        const metaHeight = lineBlockHeight(metaLines), height = metaHeight + lineBlockHeight(bodyLines);
        const minimumStart = metaHeight + minimumLine <= freshBody ? metaHeight + minimumLine : minimumLine;
        // Keep ordinary memo metadata with its text, but split even a pathological
        // author/tag value safely when the metadata alone exceeds a whole page.
        if (y + minimumStart > PAGE.bottom || (height <= freshBody && y + height > PAGE.bottom)) nextPage();
        let metaOffset = 0;
        while (metaOffset < metaLines.length) {
          const available = Math.floor((PAGE.bottom - y - ROW_PADDING * 2 + 0.001) / LINE_HEIGHT);
          const remaining = metaLines.length - metaOffset;
          let count = Math.min(available, remaining);
          if (count === remaining && y + count * LINE_HEIGHT + ROW_PADDING * 2 + minimumLine > PAGE.bottom) count--;
          if (count < 1) { nextPage(); continue; }
          drawCells([{ lines: metaLines, width: PAGE.width }], metaOffset, count, true);
          metaOffset += count;
          if (metaOffset < metaLines.length) nextPage();
        }
        let offset = 0;
        while (offset < bodyLines.length) {
          const available = Math.floor((PAGE.bottom - y - ROW_PADDING * 2 + 0.001) / LINE_HEIGHT);
          if (available < 1) { nextPage(); continue; }
          const count = Math.min(available, bodyLines.length - offset);
          drawCells([{ lines: bodyLines, width: PAGE.width }], offset, count, false, rowIndex % 2 === 1);
          offset += count;
          if (offset < bodyLines.length) nextPage();
        }
      });
    } else {
      section.rows.forEach((row, rowIndex) => {
        const cells = cellsFor(row), lineCount = Math.max(1, ...cells.map(cell => cell.lines.length));
        const height = rowHeight(cells);
        if (height <= freshBody && y + height > PAGE.bottom) nextPage();
        let offset = 0;
        while (offset < lineCount) {
          const available = Math.floor((PAGE.bottom - y - ROW_PADDING * 2 + 0.001) / LINE_HEIGHT);
          if (available < 1) { nextPage(); continue; }
          const count = Math.min(available, lineCount - offset);
          drawCells(cells, offset, count, false, rowIndex % 2 === 1);
          offset += count;
          if (offset < lineCount) nextPage();
        }
      });
    }
    y += 1.8;
  }
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
  doc.setFontSize(16); doc.text("상담일지", PAGE.left, 15);
  doc.setFontSize(9); doc.setTextColor(71, 85, 105);
  doc.text(`로파워 | ${consultationPdfDateTime(snapshot.exportedAt)} (한국시간)`, PAGE.right, 14, { align: "right" });
  doc.text(snapshot.hasUnsavedChanges ? "내보내기 시점의 작성본 · 저장되지 않은 내용 포함" : "내보내기 시점의 상담일지", PAGE.left, 21);
  doc.setDrawColor(203, 213, 225); doc.line(PAGE.left, 24, PAGE.right, 24);
  drawSections(doc, consultationPdfSections(snapshot), 27);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont(FONT_NAME, "normal"); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    if (page > 1) doc.text("로파워 | 상담일지", PAGE.left, 10);
    doc.setDrawColor(226, 232, 240); doc.line(PAGE.left, 285, PAGE.right, 285);
    doc.text("현재 작성본 · 첨부파일 내용 미포함", PAGE.left, 291);
    doc.text(`${page} / ${pages}`, PAGE.right, 291, { align: "right" });
  }
  return doc.output("blob");
}

/** A supplied URL belongs to the modal and stays usable for its direct links. */
export function downloadConsultationPdf(blob: Blob, snapshot: ConsultationPdfSnapshot, preparedUrl?: string): void {
  const url = preparedUrl ?? URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = consultationPdfFilename(snapshot);
  document.body.appendChild(anchor);
  try { anchor.click(); } finally {
    anchor.remove();
    if (!preparedUrl) setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
