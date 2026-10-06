"use client";

export type AnalyticsCell = string | number | boolean | null | undefined;
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
}

type CellStyle = Record<string, unknown>;

const COLORS = {
  navy: "FF16324F",
  blue: "FF2563EB",
  sky: "FFEFF6FF",
  pale: "FFF8FAFC",
  border: "FFD9E2EC",
  text: "FF172033",
  muted: "FF64748B",
  white: "FFFFFFFF",
  green: "FF047857",
  red: "FFB91C1C",
  amber: "FFB45309",
};

const BORDER = {
  top: { style: "thin", color: { rgb: COLORS.border } },
  bottom: { style: "thin", color: { rgb: COLORS.border } },
  left: { style: "thin", color: { rgb: COLORS.border } },
  right: { style: "thin", color: { rgb: COLORS.border } },
};

function safeSheetName(name: string) {
  return name.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "Sheet";
}

function colName(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function applyStyle(ws: any, row: number, startCol: number, endCol: number, style: CellStyle) {
  for (let c = startCol; c <= endCol; c += 1) {
    const addr = `${colName(c)}${row}`;
    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
    ws[addr].s = style;
  }
}

function applyCellFormat(cell: any, format?: AnalyticsCellFormat) {
  if (!cell || !format) return;
  if (format === "integer") cell.z = "#,##0";
  if (format === "number1") cell.z = "#,##0.0";
  if (format === "won") cell.z = '#,##0"원";[Red]-#,##0"원"';
  if (format === "percent1") cell.z = '0.0"%"';
  if (format === "date") cell.z = "yyyy-mm-dd";
}

function styleWorkbookSheet(XLSX: any, spec: AnalyticsMeetingSheet, periodLabel: string, scopeLabel: string) {
  const rows: AnalyticsCell[][] = [];
  const meta: Array<{ row: number; kind: "title" | "subtitle" | "meta" | "kpiLabel" | "kpiValue" | "section" | "header" | "data" | "note"; start: number; end: number; formats?: AnalyticsCellFormat[] }> = [];
  const merges: any[] = [];
  const widths: number[] = [];

  const maxColumns = Math.max(
    8,
    ...(spec.sections ?? []).map((section) => section.headers.length || 1),
  );

  const pushMerged = (values: AnalyticsCell[], kind: "title" | "subtitle" | "meta" | "section" | "note", span = maxColumns) => {
    rows.push(values);
    const row = rows.length;
    if (span > 1) merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: span - 1 } });
    meta.push({ row, kind, start: 0, end: span - 1 });
  };

  pushMerged([spec.title], "title");
  if (spec.subtitle) pushMerged([spec.subtitle], "subtitle");
  pushMerged([`조회기간  ${periodLabel}    ·    범위  ${scopeLabel}`], "meta");
  pushMerged([`생성일시  ${new Date().toLocaleString("ko-KR")}`], "meta");
  rows.push([]);

  const kpis = spec.kpis ?? [];
  if (kpis.length) {
    const kpiColumns = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(kpis.length))));
    for (let i = 0; i < kpis.length; i += kpiColumns) {
      const slice = kpis.slice(i, i + kpiColumns);
      const row: AnalyticsCell[] = [];
      slice.forEach((kpi) => row.push(kpi.label, kpi.value));
      rows.push(row);
      const rowIndex = rows.length;
      slice.forEach((kpi, idx) => {
        meta.push({ row: rowIndex, kind: "kpiLabel", start: idx * 2, end: idx * 2 });
        meta.push({ row: rowIndex, kind: "kpiValue", start: idx * 2 + 1, end: idx * 2 + 1, formats: [kpi.format ?? "text"] });
        widths[idx * 2] = Math.max(widths[idx * 2] ?? 0, 20);
        widths[idx * 2 + 1] = Math.max(widths[idx * 2 + 1] ?? 0, 18);
      });
    }
    rows.push([]);
  }

  for (const section of spec.sections ?? []) {
    const sectionCols = Math.max(1, section.headers.length);
    pushMerged([section.title], "section", sectionCols);
    if (section.note) pushMerged([section.note], "note", sectionCols);
    rows.push(section.headers);
    meta.push({ row: rows.length, kind: "header", start: 0, end: sectionCols - 1 });
    section.headers.forEach((h, i) => {
      const base = section.widths?.[i] ?? Math.max(12, Math.min(34, String(h).length * 2 + 4));
      widths[i] = Math.max(widths[i] ?? 0, base);
    });
    for (const row of section.rows) {
      rows.push(row);
      meta.push({ row: rows.length, kind: "data", start: 0, end: sectionCols - 1, formats: section.formats });
      row.forEach((value, i) => {
        const valueWidth = Math.min(42, Math.max(10, String(value ?? "").length + 3));
        widths[i] = Math.max(widths[i] ?? 0, section.widths?.[i] ?? valueWidth);
      });
    }
    rows.push([]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = Array.from({ length: Math.max(maxColumns, widths.length) }, (_, i) => ({ wch: Math.min(44, Math.max(11, widths[i] ?? 14)) }));
  ws["!rows"] = rows.map((_, idx) => ({ hpt: idx === 0 ? 28 : idx < 4 ? 19 : 18 }));
  ws["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", activePane: "bottomLeft", state: "frozen" };
  ws["!margins"] = { left: 0.25, right: 0.25, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 };

  const titleStyle: CellStyle = { font: { name: "맑은 고딕", sz: 18, bold: true, color: { rgb: COLORS.white } }, fill: { fgColor: { rgb: COLORS.navy } }, alignment: { vertical: "center" }, border: BORDER };
  const subtitleStyle: CellStyle = { font: { name: "맑은 고딕", sz: 11, bold: true, color: { rgb: COLORS.navy } }, fill: { fgColor: { rgb: "FFE8EEF5" } }, alignment: { vertical: "center" }, border: BORDER };
  const metaStyle: CellStyle = { font: { name: "맑은 고딕", sz: 9, color: { rgb: COLORS.muted } }, fill: { fgColor: { rgb: COLORS.pale } }, alignment: { vertical: "center" }, border: BORDER };
  const sectionStyle: CellStyle = { font: { name: "맑은 고딕", sz: 11, bold: true, color: { rgb: COLORS.navy } }, fill: { fgColor: { rgb: "FFDCEAFB" } }, alignment: { vertical: "center" }, border: BORDER };
  const noteStyle: CellStyle = { font: { name: "맑은 고딕", sz: 9, color: { rgb: COLORS.muted } }, fill: { fgColor: { rgb: "FFF7FAFC" } }, alignment: { vertical: "center", wrapText: true }, border: BORDER };
  const headerStyle: CellStyle = { font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: COLORS.white } }, fill: { fgColor: { rgb: COLORS.blue } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: BORDER };
  const dataStyle: CellStyle = { font: { name: "맑은 고딕", sz: 9, color: { rgb: COLORS.text } }, alignment: { vertical: "center", wrapText: true }, border: BORDER };
  const kpiLabelStyle: CellStyle = { font: { name: "맑은 고딕", sz: 9, bold: true, color: { rgb: COLORS.muted } }, fill: { fgColor: { rgb: COLORS.sky } }, alignment: { vertical: "center" }, border: BORDER };
  const kpiValueStyle: CellStyle = { font: { name: "맑은 고딕", sz: 12, bold: true, color: { rgb: COLORS.navy } }, fill: { fgColor: { rgb: COLORS.white } }, alignment: { horizontal: "right", vertical: "center" }, border: BORDER };

  for (const item of meta) {
    const style = item.kind === "title" ? titleStyle
      : item.kind === "subtitle" ? subtitleStyle
      : item.kind === "meta" ? metaStyle
      : item.kind === "section" ? sectionStyle
      : item.kind === "note" ? noteStyle
      : item.kind === "header" ? headerStyle
      : item.kind === "kpiLabel" ? kpiLabelStyle
      : item.kind === "kpiValue" ? kpiValueStyle
      : dataStyle;
    applyStyle(ws, item.row, item.start, item.end, style);
    if (item.formats) {
      for (let c = item.start; c <= item.end; c += 1) {
        const addr = `${colName(c)}${item.row}`;
        applyCellFormat(ws[addr], item.formats[c - item.start]);
        if (typeof ws[addr]?.v === "number" && ws[addr].v < 0) {
          ws[addr].s = { ...ws[addr].s, font: { ...(ws[addr].s?.font ?? {}), color: { rgb: COLORS.red }, bold: true } };
        }
      }
    }
  }

  return ws;
}

export async function exportAnalyticsMeetingWorkbook(input: AnalyticsMeetingWorkbookInput) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: "로파워 데이터집계 회의자료",
    Subject: `${input.periodLabel} 데이터집계`,
    Author: "LawPower",
    Company: "LawPower",
    Comments: "CRM 데이터집계 화면의 조회기간 기준 데이터를 회의자료용으로 내보낸 파일입니다.",
    CreatedDate: new Date(),
  };

  for (const sheet of input.sheets) {
    const ws = styleWorkbookSheet(XLSX, sheet, input.periodLabel, input.scopeLabel);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheet.name));
  }

  XLSX.writeFile(wb, input.filename);
}
