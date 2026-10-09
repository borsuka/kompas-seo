import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
/** DejaVu Sans covers Latin and Cyrillic (PDFKit's built-in fonts have no Cyrillic). */
const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

const COLORS = {
  text: '#111827',
  muted: '#6b7280',
  line: '#e5e7eb',
  brand: '#2563eb',
  zebra: '#f9fafb',
};
const MARGIN = 48;

export interface Column<T> {
  header: string;
  width: number;
  align?: 'left' | 'right';
  value: (row: T) => string;
}

/** Small layout helper over PDFKit: headings, metric tiles, tables, page footer. */
export class ReportPdf {
  private readonly doc: InstanceType<typeof PDFDocument>;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(
    title: string,
    private readonly footer: string,
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      bufferPages: true,
      info: { Title: title, Creator: 'Kompas SEO' },
    });
    this.doc.registerFont('regular', FONT);
    this.doc.registerFont('bold', FONT_BOLD);
    this.doc.font('regular').fillColor(COLORS.text);
    this.done = new Promise((resolve, reject) => {
      this.doc.on('data', (c: Buffer) => this.chunks.push(c));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
  }

  private get width() {
    return this.doc.page.width - MARGIN * 2;
  }

  private ensure(space: number) {
    if (this.doc.y + space > this.doc.page.height - MARGIN - 24) this.doc.addPage();
  }

  cover(title: string, subtitle: string, meta: string) {
    this.doc
      .font('bold')
      .fontSize(9)
      .fillColor(COLORS.brand)
      .text('KOMPAS SEO', { characterSpacing: 1.5 });
    this.doc.moveDown(0.6);
    this.doc.font('bold').fontSize(22).fillColor(COLORS.text).text(title);
    this.doc.font('regular').fontSize(11).fillColor(COLORS.muted).text(subtitle);
    this.doc.fontSize(9).text(meta);
    this.doc.moveDown(1);
    return this;
  }

  heading(text: string) {
    this.ensure(60);
    this.doc.moveDown(0.8);
    this.doc.font('bold').fontSize(14).fillColor(COLORS.text).text(text);
    const y = this.doc.y + 3;
    this.doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + this.width, y)
      .strokeColor(COLORS.line)
      .lineWidth(1)
      .stroke();
    this.doc.moveDown(0.6);
    return this;
  }

  note(text: string) {
    this.doc.font('regular').fontSize(9).fillColor(COLORS.muted).text(text, { width: this.width });
    this.doc.moveDown(0.4);
    return this;
  }

  /** A row of metric tiles (label above, value below). */
  metrics(items: { label: string; value: string }[]) {
    this.ensure(60);
    const gap = 10;
    const per = Math.min(4, items.length);
    const w = (this.width - gap * (per - 1)) / per;
    for (let i = 0; i < items.length; i += per) {
      const y = this.doc.y;
      items.slice(i, i + per).forEach((m, j) => {
        const x = MARGIN + j * (w + gap);
        this.doc.roundedRect(x, y, w, 46, 4).fillColor(COLORS.zebra).fill();
        this.doc
          .font('regular')
          .fontSize(8)
          .fillColor(COLORS.muted)
          .text(m.label, x + 8, y + 7, { width: w - 16 });
        this.doc
          .font('bold')
          .fontSize(14)
          .fillColor(COLORS.text)
          .text(m.value, x + 8, y + 22, { width: w - 16 });
      });
      this.doc.x = MARGIN;
      this.doc.y = y + 56;
    }
    return this;
  }

  table<T>(columns: Column<T>[], rows: readonly T[], empty: string) {
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const row = (cells: string[], opts: { bold?: boolean; fill?: string }) => {
      this.doc.font(opts.bold ? 'bold' : 'regular').fontSize(8.5);
      const h =
        Math.max(...cells.map((c, i) => this.doc.heightOfString(c, { width: widths[i]! - 8 }))) + 8;
      this.ensure(h);
      const y = this.doc.y;
      if (opts.fill) this.doc.rect(MARGIN, y, this.width, h).fillColor(opts.fill).fill();
      let x = MARGIN;
      cells.forEach((c, i) => {
        this.doc
          .fillColor(opts.bold ? COLORS.muted : COLORS.text)
          .text(c, x + 4, y + 4, { width: widths[i]! - 8, align: columns[i]!.align ?? 'left' });
        x += widths[i]!;
      });
      this.doc.x = MARGIN;
      this.doc.y = y + h;
    };
    row(
      columns.map((c) => c.header),
      { bold: true },
    );
    if (!rows.length) {
      this.note(empty);
      return this;
    }
    rows.forEach((r, i) =>
      row(
        columns.map((c) => c.value(r)),
        { fill: i % 2 ? COLORS.zebra : undefined },
      ),
    );
    this.doc.moveDown(0.5);
    return this;
  }

  async finish(): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.doc
        .font('regular')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(
          `${this.footer} · ${i + 1}/${range.count}`,
          MARGIN,
          this.doc.page.height - MARGIN + 12,
          {
            width: this.width,
            align: 'center',
            lineBreak: false,
          },
        );
    }
    this.doc.end();
    return this.done;
  }
}
