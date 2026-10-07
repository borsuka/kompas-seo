import ExcelJS from 'exceljs';
import type { Response } from 'express';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  width?: number;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens Cyrillic text correctly. */
export function toCsv<T>(columns: readonly ExportColumn<T>[], rows: readonly T[]): Buffer {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Neutralize spreadsheet formula injection (=, +, -, @ at the start).
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(c.value(row))).join(','));
  const bom = '﻿';
  return Buffer.from(`${bom}${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function toXlsx<T>(
  sheetName: string,
  columns: readonly ExportColumn<T>[],
  rows: readonly T[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kompas SEO';
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || 'Sheet1', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = columns.map((c, i) => ({ header: c.header, key: String(i), width: c.width ?? 16 }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(Object.fromEntries(columns.map((c, i) => [String(i), c.value(row) ?? null])));
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function sendExport<T>(
  res: Response,
  format: 'csv' | 'xlsx',
  baseName: string,
  columns: readonly ExportColumn<T>[],
  rows: readonly T[],
) {
  const safe = baseName.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'export';
  const body = format === 'xlsx' ? await toXlsx(safe, columns, rows) : toCsv(columns, rows);
  res.setHeader(
    'Content-Type',
    format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv; charset=utf-8',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="export.${format}"; filename*=UTF-8''${encodeURIComponent(`${safe}.${format}`)}`,
  );
  res.send(body);
}

/** Column headers for keyword exports in the UI languages. */
export const KEYWORD_EXPORT_HEADERS = {
  bg: {
    keyword: 'Ключова дума',
    volume: 'Обем',
    kd: 'KD',
    cpc: 'CPC (USD)',
    competition: 'Конкуренция',
    intent: 'Намерение',
    features: 'SERP функции',
    words: 'Брой думи',
    source: 'Източник',
    cluster: 'Клъстер',
    tags: 'Етикети',
    note: 'Бележка',
  },
  en: {
    keyword: 'Keyword',
    volume: 'Volume',
    kd: 'KD',
    cpc: 'CPC (USD)',
    competition: 'Competition',
    intent: 'Intent',
    features: 'SERP features',
    words: 'Words',
    source: 'Source',
    cluster: 'Cluster',
    tags: 'Tags',
    note: 'Note',
  },
} as const;
