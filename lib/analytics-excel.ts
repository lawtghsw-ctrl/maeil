"use client";

import type { Cell, Row, Workbook, Worksheet, PaperSize } from "exceljs";

export type AnalyticsCell = string | number | boolean | Date | null | undefined;
/** percent1 accepts the existing analytics percentage-point values (25 means 25%). */
export type AnalyticsCellFormat = "text" | "integer" | "number1" | "won" | "percent1" | "date";

export interface AnalyticsKpi {
  label: string;
  value: AnalyticsCell;
  format?: AnalyticsCellFormat;
}

export interface AnalyticsSection {
  title: string;
  headers: string[];
  rows: AnalyticsCell[][];
  formats?: AnalyticsCellFormat[];
  widths?: number[];
  note?: string;
  /** Explicit source totals only. Never infer totals for rates, balances or mixed rows. */
  totalRow?: AnalyticsCell[];
}

export interface AnalyticsMeetingSheet {
  name: string;
  title: string;
  subtitle?: string;
  kpis?: AnalyticsKpi[];
  sections?: AnalyticsSection[];
}

export interface AnalyticsMeetingWorkbookInput {
  filename: string;
  periodLabel: string;
  scopeLabel: string;
  sheets: AnalyticsMeetingSheet[];
  /** Cancel stale downloads after a reporting-month/scope change or unmount. */
  canDownload?: () => boolean;
}

const COLORS = {
  header: "FFE6EAE5",
  body: "FFF2F7EE",
  alternate: "FFE8F1E2",
  section: "FFDFE9D9",
  total: "FFD2E2C8",
  border: "FFACBAA6",
  text: "FF233127",
  muted: "FF596558",
  accent: "FF54734A",
};

const FORMATS: Record<AnalyticsCellFormat, string> = {
  text: "@",
  integer: "#,##0;[Red]-#,##0;0",
  number1: "#,##0.0;[Red]-#,##0.0;0.0",
  won: '#,##0"원";[Red]-#,##0"원";0"원"',
  percent1: "0.0%;[Red]-0.0%;0.0%",
  date: "yyyy-mm-dd",
};

type TableSpec = AnalyticsSection & { rowFormats?: AnalyticsCellFormat[][] };
type RowKind = "header" | "data" | "total" | "section" | "note";

function sheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*\[\]:\x00-\x1f]/g, " ").trim().replace(/^'+|'+$/g, "").slice(0, 31).trim().replace(/^'+|'+$/g, "");
  if (!base) base = "Sheet";
  if (base.toLowerCase() === "history") base = "History_";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const ending = ` (${suffix++})`;
    candidate = base.slice(0, 31 - ending.length) + ending;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Only date columns are parsed, and invalid calendar dates remain visible source text. */
function typedValue(value: AnalyticsCell, format?: AnalyticsCellFormat): Exclude<AnalyticsCell, undefined> {
  // Empty strings are genuinely blank cells, not shared-string references.
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("엑셀에 내보낼 수 없는 숫자가 있습니다.");
    return format === "percent1" ? value / 100 : value;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error("엑셀에 내보낼 수 없는 날짜가 있습니다.");
    return new Date(value.getTime());
  }
  if (format === "date" && typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return date;
    }
  }
  // In particular, strings beginning with '=' remain literal text, not formulas.
  return value;
}

function visualLength(value: string) {
  return Array.from(value).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
}

function displayText(value: AnalyticsCell, format?: AnalyticsCellFormat) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "number") return String(value);
  if (format === "percent1") return `${value.toFixed(1)}%`;
  const text = value.toLocaleString("en-US", { minimumFractionDigits: format === "number1" ? 1 : 0, maximumFractionDigits: format === "number1" ? 1 : format === "integer" || format === "won" ? 0 : 10 });
  return format === "won" ? `${text}원` : text;
}

function setStyle(cell: Cell, kind: RowKind, alternate = false) {
  cell.font = {
    name: "맑은 고딕", size: 11, family: 2, charset: 129,
    bold: kind === "header" || kind === "total" || kind === "section",
    color: { argb: kind === "note" ? COLORS.muted : COLORS.text },
  };
  cell.alignment = { vertical: "middle", horizontal: kind === "header" ? "center" : "left", wrapText: true };
  if (kind === "note") return;
  const fill = kind === "header" ? COLORS.header
    : kind === "total" ? COLORS.total
    : kind === "section" ? COLORS.section
    : alternate ? COLORS.alternate : COLORS.body;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.border = {
    top: { style: kind === "total" ? "double" : "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    ...(kind !== "section" && {
      left: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    }),
  };
}

function setValue(cell: Cell, value: AnalyticsCell, format?: AnalyticsCellFormat) {
  cell.value = typedValue(value, format);
  cell.numFmt = format ? FORMATS[format] : value instanceof Date ? FORMATS.date : typeof value === "number" ? "#,##0.##########" : FORMATS.text;
  cell.alignment = {
    ...cell.alignment,
    horizontal: format === "date" || value instanceof Date || typeof value === "boolean" ? "center"
      : typeof value === "number" || (format && format !== "text") ? "right" : "left",
  };
}

function tableSpecs(spec: AnalyticsMeetingSheet): TableSpec[] {
  const sections: TableSpec[] = [...(spec.sections ?? [])];
  if (spec.kpis?.length) {
    sections.push({
      title: "핵심 지표", headers: ["지표", "값"],
      rows: spec.kpis.map(kpi => [kpi.label, kpi.value]),
      rowFormats: spec.kpis.map(kpi => ["text", kpi.format ?? "text"]),
      widths: [28, 22],
    });
  }
  return sections.length ? sections : [{ title: "", headers: ["항목", "값"], rows: [] }];
}

function measureColumns(sections: TableSpec[]) {
  const widths: number[] = [];
  for (const section of sections) {
    section.headers.forEach((header, col) => {
      // Leave space for the filter button as well as two-byte Korean characters.
      widths[col] = Math.max(widths[col] ?? 12, section.widths?.[col] ?? 0, Math.min(36, visualLength(header) + 5));
    });
    [...section.rows, ...(section.totalRow ? [section.totalRow] : [])].forEach((row, index) => {
      row.forEach((value, col) => {
        const format = section.rowFormats?.[index]?.[col] ?? section.formats?.[col];
        const length = Math.max(...displayText(value, format).split("\n").map(visualLength));
        widths[col] = Math.max(widths[col] ?? 12, Math.min(42, length + 3));
      });
    });
  }
  return widths.map(width => Math.min(52, width));
}

function fitRow(row: Row, values: AnalyticsCell[], widths: number[], formats?: AnalyticsCellFormat[], header = false) {
  const lines = values.reduce<number>((max, value, col) => {
    const available = Math.max(4, (widths[col] ?? 12) - (header ? 4 : 2));
    const count = displayText(value, formats?.[col]).split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(visualLength(line) / available)), 0);
    return Math.max(max, count);
  }, 1);
  row.height = Math.min(409, Math.max(header ? 32 : 24, lines * 16 + 8));
}

function writeSheet(workbook: Workbook, spec: AnalyticsMeetingSheet, name: string) {
  const sections = tableSpecs(spec);
  for (const section of sections) {
    if (section.rows.some(row => row.length > section.headers.length) || (section.totalRow && section.totalRow.length > section.headers.length)) {
      throw new Error(`${name}: 열 제목보다 데이터 열이 많습니다.`);
    }
  }
  const widths = measureColumns(sections);
  const wide = widths.length > 8;
  const ledger = name === "04 수임매출";
  const ws = workbook.addWorksheet(name, {
    properties: { defaultRowHeight: 24, tabColor: { argb: COLORS.accent } },
    views: [{ state: "frozen", xSplit: ledger ? 5 : 0, ySplit: 1, topLeftCell: ledger ? "F2" : "A2", activeCell: ledger ? "F2" : "A2", showGridLines: false }],
    pageSetup: {
      // Wide accounting ledgers paginate horizontally at readable scale, never shrink to one tiny page.
      // ExcelJS supports A3 (8); its 4.4.0 PaperSize enum omits the documented value.
      paperSize: (wide ? 8 : 9) as PaperSize, orientation: widths.length > 6 ? "landscape" : "portrait",
      fitToPage: !wide, fitToWidth: wide ? 0 : 1, fitToHeight: 0, scale: wide ? 90 : 100,
      ...(ledger ? { printTitlesColumn: "D:E" } : {}),
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
      printTitlesRow: "1:1",
    },
  });
  widths.forEach((width, index) => { ws.getColumn(index + 1).width = width; });

  sections.forEach((section, sectionIndex) => {
    const columns = Math.max(1, section.headers.length);
    if (sectionIndex > 0) {
      ws.addRow([]).height = 10;
      if (section.title) writeLabel(ws, section.title, columns, widths, "section");
    }
    const header = ws.addRow(section.headers.length ? section.headers : ["항목"]);
    for (let col = 1; col <= columns; col++) setStyle(header.getCell(col), "header");
    fitRow(header, section.headers, widths, undefined, true);
    section.rows.forEach((values, index) => {
      const row = ws.addRow([]);
      const formats = section.rowFormats?.[index] ?? section.formats;
      for (let col = 1; col <= columns; col++) {
        const cell = row.getCell(col);
        setStyle(cell, "data", index % 2 === 1);
        setValue(cell, values[col - 1], formats?.[col - 1]);
      }
      if (ledger && sectionIndex === 0) {
        // Bring the three requested accounting measures forward without dropping legacy columns.
        for (const col of [9,10,11]) row.getCell(col).font = { ...row.getCell(col).font, bold: true };
      }
      fitRow(row, values, widths, formats);
    });
    // Excel permits one worksheet-level AutoFilter. Do not include totals or later tables.
    if (sectionIndex === 0) {
      ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number + section.rows.length, column: columns } };
    }
    if (section.totalRow) {
      const row = ws.addRow([]);
      for (let col = 1; col <= columns; col++) {
        const cell = row.getCell(col);
        setStyle(cell, "total");
        setValue(cell, section.totalRow[col - 1], section.formats?.[col - 1]);
      }
      fitRow(row, section.totalRow, widths, section.formats);
    }
    // Keep essential definitions, but below their data rather than above row 1.
    if (section.note) writeLabel(ws, section.note, columns, widths, "note");
  });
  ws.pageSetup.printArea = `A1:${ws.getColumn(Math.max(1, widths.length)).letter}${ws.rowCount}`;
}

function writeLabel(ws: Worksheet, text: string, columns: number, widths: number[], kind: "section" | "note") {
  const row = ws.addRow([text]);
  for (let col = 1; col <= columns; col++) setStyle(row.getCell(col), kind);
  if (columns > 1) ws.mergeCells(row.number, 1, row.number, columns);
  const totalWidth = widths.slice(0, columns).reduce((sum, width) => sum + width, 0);
  fitRow(row, [text], [totalWidth]);
}

/** Build separately from download so exports can be regression-tested without a browser. */
export async function buildAnalyticsMeetingWorkbook(input: AnalyticsMeetingWorkbookInput): Promise<Workbook> {
  if (!input.sheets.length) throw new Error("내보낼 데이터 시트가 없습니다.");
  // ExcelJS's browser bundle persists styles, panes and page setup in the XLSX itself.
  // Keep this lazy so the main analytics screen does not load the exporter upfront.
  const ExcelJS = await import("exceljs");
  const workbook = new (ExcelJS.default ?? ExcelJS).Workbook();
  workbook.creator = "LawPower";
  workbook.title = "로파워 데이터집계";
  workbook.subject = input.periodLabel;
  workbook.description = `조회기간: ${input.periodLabel}. 범위: ${input.scopeLabel}.`;
  workbook.created = new Date();
  const usedNames = new Set<string>();
  for (const sheet of input.sheets) writeSheet(workbook, sheet, sheetName(sheet.name, usedNames));
  const footerLabel = `${input.periodLabel} · ${input.scopeLabel}`.replace(/&/g, "&&");
  for (const sheet of workbook.worksheets) sheet.headerFooter.oddFooter = `&L${footerLabel}&R&P / &N`;
  return workbook;
}

export async function exportAnalyticsMeetingWorkbook(input: AnalyticsMeetingWorkbookInput) {
  const workbook = await buildAnalyticsMeetingWorkbook(input);
  const bytes = await workbook.xlsx.writeBuffer();
  if (input.canDownload && !input.canDownload()) return;
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = input.filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Do not revoke before browsers have started consuming the download URL.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
