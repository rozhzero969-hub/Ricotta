/* Ricotta Orders -- Excel and PDF files, in Ricotta's own look.
   - Excel (.xlsx): the ricotta mark, a title and a line about what the file holds, then a dark green
     header row (frozen, with filters), banded rows, a totals row where totals make sense, and
     right-to-left sheets for Kurdish and Arabic. Built here with no library (zipStore in transfers.js).
   - PDF: each A4 page is drawn on a canvas, so Kurdish and Arabic text is shaped exactly as on the
     screen, and the pages are written into a small PDF file by hand. It opens the phone's share sheet
     (WhatsApp, Files, Print...) or downloads on a computer; nothing opens in a new window, so there is
     always a way back.
   Files: the items and the suppliers (Manage, Export), this month's orders (History, the report card)
   and one supplier's order sheet (Send to suppliers, PDF). Depends on (runtime only): state, t, esc, api,
   toast, showAlert, openKitchenSheet, formatIraqDateTime, erbilDate, supplierName, unitLabel, unitName,
   accountLabel, sortedByName, sortedSupplierItems, reminderDays, DAY_ORDER, deliverFile, zipStore,
   xmlText, XML_HEAD, SHEET_NS, isRtl, canDo, monthName, reportData, weekdayName. */

/* ---------- Excel ---------- */
const XL_COL = n=>{ let s = ''; n++; while(n){ const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const XL_STYLES = XML_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="7"><font><sz val="11"/><color rgb="FF1C1C1E"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="20"/><color rgb="FF14382C"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="14"/><color rgb="FF1C1C1E"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><sz val="10"/><color rgb="FF6E6E73"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><sz val="11"/><color rgb="FF1C1C1E"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><b/><sz val="11"/><color rgb="FF14382C"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF14382C"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F8F4"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE3F1E8"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFDCE8DF"/></left><right style="thin"><color rgb="FFDCE8DF"/></right><top style="thin"><color rgb="FFDCE8DF"/></top><bottom style="thin"><color rgb="FFDCE8DF"/></bottom><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFDCE8DF"/></left><right style="thin"><color rgb="FFDCE8DF"/></right><top style="medium"><color rgb="FF14382C"/></top><bottom style="thin"><color rgb="FFDCE8DF"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="6" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="6" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0"/></styleSheet>';
/* One sheet: the mark, a title, a line about the file, then the table from row 5 (frozen and filtered). */
function brandedSheetXml(sheet, {title, subtitle, rtl}){
  const cols = sheet.columns, last = XL_COL(cols.length - 1);
  const cell = (c, r, v, style) => typeof v === 'number' && Number.isFinite(v)
    ? `<c r="${XL_COL(c)}${r}" s="${style}"><v>${v}</v></c>`
    : `<c r="${XL_COL(c)}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(v ?? '')}</t></is></c>`;
  const num = c=>cols[c].type === 'number';
  const rows = [
    `<row r="1" ht="30" customHeight="1">${cell(0, 1, 'ricotta.', 1)}</row>`,
    `<row r="2" ht="22" customHeight="1">${cell(0, 2, title, 2)}</row>`,
    `<row r="3" ht="18" customHeight="1">${cell(0, 3, subtitle, 3)}</row>`,
    `<row r="4" ht="8" customHeight="1"></row>`,
    `<row r="5" ht="26" customHeight="1">${cols.map((col, c)=>cell(c, 5, col.label, num(c) ? 11 : 4)).join('')}</row>`,
  ];
  sheet.rows.forEach((line, i)=>{
    const r = i + 6, band = i % 2 === 1;
    rows.push(`<row r="${r}" ht="20" customHeight="1">${line.map((v, c)=>cell(c, r, v, num(c) ? (band ? 8 : 7) : (band ? 6 : 5))).join('')}</row>`);
  });
  const end = sheet.rows.length + 5;
  if(sheet.totals) rows.push(`<row r="${end + 1}" ht="22" customHeight="1">${sheet.totals.map((v, c)=>cell(c, end + 1, v, num(c) ? 10 : 9)).join('')}</row>`);
  const lastRow = end + (sheet.totals ? 1 : 0);
  return XML_HEAD + `<worksheet ${SHEET_NS}><sheetPr><tabColor rgb="FF14382C"/><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<dimension ref="A1:${last}${lastRow}"/>`
    + `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${rtl ? ' rightToLeft="1"' : ''}${sheet.first ? ' tabSelected="1"' : ''}><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="20"/>'
    + `<cols>${cols.map((col, i)=>`<col min="${i + 1}" max="${i + 1}" width="${col.width || 16}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows.join('')}</sheetData>`
    + (sheet.rows.length ? `<autoFilter ref="A5:${last}${end}"/>` : '')
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + `<pageSetup paperSize="9" orientation="${cols.length > 6 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`
    + `<headerFooter><oddHeader>${xmlText('&L&"-,Bold"Ricotta&R' + title)}</oddHeader><oddFooter>${xmlText('&L' + subtitle + '&R&P / &N')}</oddFooter></headerFooter>`
    + '</worksheet>';
}
/* A workbook from sheets [{name, columns:[{label, width, type}], rows, totals}]. */
function brandedWorkbook({title, subtitle, sheets, at = new Date()}){
  const rtl = isRtl();
  sheets.forEach((s, i)=>{ s.first = i === 0; });
  const created = at.toISOString().replace(/\.\d+Z$/, 'Z');
  const parts = [
    ['[Content_Types].xml', XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((_, i)=>`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ['_rels/.rels', XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
    ['docProps/core.xml', XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(title)}</dc:title><dc:creator>Ricotta Orders</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`],
    ['xl/workbook.xml', XML_HEAD + `<workbook ${SHEET_NS}><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i)=>`<sheet name="${xmlText(String(s.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
      + `<definedNames>${sheets.map((s, i)=>s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlText(String(s.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}'!$A$5:$${XL_COL(s.columns.length - 1)}$${s.rows.length + 5}</definedName>` : '').join('')}</definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i)=>`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', XL_STYLES],
    ...sheets.map((s, i)=>[`xl/worksheets/sheet${i + 1}.xml`, brandedSheetXml(s, {title:s.title || title, subtitle, rtl})]),
  ];
  return zipStore(parts);
}

/* ---------- PDF ---------- */
/* A4 in points, drawn at 2 pixels per point. */
const PDF_W = 595.28, PDF_H = 841.89, PDF_SCALE = 2, PDF_M = 40;
const PDF_FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Kufi Arabic", Arial, sans-serif`;
const PDF_COLORS = {deep:'#14382C', green:'#1F7A4D', accent:'#34C27A', ink:'#1C1C1E', soft:'#6E6E73', line:'#DCE8DF', band:'#F2F8F4', head:'#14382C', total:'#E3F1E8'};
/* The fonts the page draws with are loaded first (Noto Kufi Arabic where there is no system Arabic font). */
async function pdfFonts(){
  try{ await Promise.race([Promise.all([document.fonts.load(`800 22px Manrope`), document.fonts.load(`12px "Noto Kufi Arabic"`)]), new Promise(r=>setTimeout(r, 1500))]); }catch(_){}
}
/* Lays out a document {title, subtitle, info:[[label, value]], sections:[{heading, columns:[{label, w, align, bold}], rows, totals}],
   note} over as many pages as it needs, and returns a PDF Blob. */
async function brandedPdf(doc){
  await pdfFonts();
  const rtl = isRtl(), pages = [];
  let canvas, ctx, y = 0;
  const X = x=>rtl ? PDF_W - x : x;               // a left-to-right position, mirrored for Kurdish and Arabic
  const font = (size, weight = 400)=>{ ctx.font = `${weight} ${size}px ${PDF_FONT}`; };
  const text = (s, x, yy, {size = 10, weight = 400, color = PDF_COLORS.ink, align = 'start'} = {})=>{
    font(size, weight); ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = align === 'end' ? (rtl ? 'left' : 'right') : align === 'center' ? 'center' : (rtl ? 'right' : 'left');
    ctx.fillText(String(s ?? ''), X(x), yy);
  };
  const wrap = (s, width, size, weight = 400)=>{
    font(size, weight);
    const words = String(s ?? '').split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for(const w of words){
      const next = line ? line + ' ' + w : w;
      if(ctx.measureText(next).width <= width || !line) line = next; else { lines.push(line); line = w; }
    }
    if(line) lines.push(line);
    return lines.length ? lines : [''];
  };
  const newPage = ()=>{
    canvas = document.createElement('canvas');
    canvas.width = Math.round(PDF_W * PDF_SCALE); canvas.height = Math.round(PDF_H * PDF_SCALE);
    ctx = canvas.getContext('2d');
    ctx.scale(PDF_SCALE, PDF_SCALE);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, PDF_W, PDF_H);
    pages.push(canvas);
    // The header on every page: the ricotta mark, the document's name and the date.
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
    ctx.font = `800 21px Manrope, ${PDF_FONT}`; ctx.fillStyle = PDF_COLORS.deep;
    const markX = rtl ? PDF_W - PDF_M - ctx.measureText('ricotta').width - 7 : PDF_M;
    ctx.fillText('ricotta', markX, PDF_M + 16);
    ctx.fillStyle = PDF_COLORS.accent; ctx.beginPath(); ctx.arc(markX + ctx.measureText('ricotta').width + 4, PDF_M + 13, 2.6, 0, Math.PI * 2); ctx.fill();
    text(doc.title, PDF_W - PDF_M, PDF_M + 7, {size:9, weight:600, color:PDF_COLORS.ink, align:'end'});
    text(doc.stamp, PDF_W - PDF_M, PDF_M + 19, {size:8, color:PDF_COLORS.soft, align:'end'});
    ctx.fillStyle = PDF_COLORS.green; ctx.fillRect(PDF_M, PDF_M + 28, PDF_W - 2 * PDF_M, 1.4);
    y = PDF_M + 52;
  };
  const room = need=>{ if(y + need > PDF_H - PDF_M - 26){ newPage(); return true; } return false; };
  newPage();
  // Title and the line under it.
  text(doc.title, PDF_M, y + 6, {size:20, weight:700}); y += 22;
  if(doc.subtitle){ for(const l of wrap(doc.subtitle, PDF_W - 2 * PDF_M, 10)){ text(l, PDF_M, y + 6, {size:10, color:PDF_COLORS.soft}); y += 14; } }
  y += 10;
  // Info tiles: a row of small labelled boxes (supplier, phone, date, items...).
  if(doc.info?.length){
    const n = Math.min(4, doc.info.length), gap = 8, w = (PDF_W - 2 * PDF_M - gap * (n - 1)) / n;
    doc.info.slice(0, 4).forEach(([label, value], i)=>{
      const x = PDF_M + i * (w + gap);
      ctx.fillStyle = PDF_COLORS.band; pdfRound(ctx, rtl ? PDF_W - x - w : x, y, w, 40, 7); ctx.fill();
      text(label, x + 10, y + 15, {size:7.5, weight:600, color:PDF_COLORS.soft});
      text(wrap(value, w - 20, 11, 700)[0], x + 10, y + 31, {size:11, weight:700, color:PDF_COLORS.deep});
    });
    y += 54;
  }
  for(const section of doc.sections){
    const cols = section.columns, width = PDF_W - 2 * PDF_M;
    const total = cols.reduce((n, c)=>n + c.w, 0);
    const xs = []; let acc = PDF_M;
    cols.forEach(c=>{ xs.push(acc); acc += c.w / total * width; });
    const colW = i=>cols[i].w / total * width;
    const headRow = ()=>{
      ctx.fillStyle = PDF_COLORS.head; pdfRound(ctx, PDF_M, y, width, 22, 5); ctx.fill();
      cols.forEach((c, i)=>text(c.label, c.align === 'end' ? xs[i] + colW(i) - 8 : xs[i] + 8, y + 14.5, {size:8.5, weight:700, color:'#FFFFFF', align:c.align}));
      y += 22;
    };
    if(section.heading){ room(60); text(section.heading, PDF_M, y + 12, {size:12, weight:700, color:PDF_COLORS.deep}); y += 22; }
    room(50); headRow();
    section.rows.forEach((row, r)=>{
      if(row.group){
        if(room(44)) headRow();
        ctx.fillStyle = PDF_COLORS.total; ctx.fillRect(PDF_M, y, width, 20);
        text(row.group, PDF_M + 8, y + 13.5, {size:9, weight:700, color:PDF_COLORS.deep});
        y += 20; return;
      }
      const lines = row.map((v, i)=>wrap(v, colW(i) - 16, 9.5, cols[i].bold ? 700 : 400));
      const h = Math.max(...lines.map(l=>l.length)) * 12.5 + 9;
      if(room(h)) headRow();
      if(r % 2 === 1){ ctx.fillStyle = PDF_COLORS.band; ctx.fillRect(PDF_M, y, width, h); }
      lines.forEach((l, i)=>l.forEach((part, k)=>text(part, cols[i].align === 'end' ? xs[i] + colW(i) - 8 : xs[i] + 8, y + 13.5 + k * 12.5,
        {size:9.5, weight:cols[i].bold ? 700 : 400, color:cols[i].bold ? PDF_COLORS.deep : PDF_COLORS.ink, align:cols[i].align})));
      ctx.fillStyle = PDF_COLORS.line; ctx.fillRect(PDF_M, y + h - .6, width, .6);
      y += h;
    });
    if(section.totals){
      room(24);
      ctx.fillStyle = PDF_COLORS.total; ctx.fillRect(PDF_M, y, width, 22);
      ctx.fillStyle = PDF_COLORS.deep; ctx.fillRect(PDF_M, y, width, 1.2);
      section.totals.forEach((v, i)=>text(v, cols[i].align === 'end' ? xs[i] + colW(i) - 8 : xs[i] + 8, y + 14.5, {size:9.5, weight:700, color:PDF_COLORS.deep, align:cols[i].align}));
      y += 22;
    }
    y += 18;
  }
  if(doc.note){
    const lines = wrap(doc.note, PDF_W - 2 * PDF_M - 24, 10, 600);
    room(lines.length * 14 + 20);
    ctx.fillStyle = PDF_COLORS.band; pdfRound(ctx, PDF_M, y, PDF_W - 2 * PDF_M, lines.length * 14 + 18, 8); ctx.fill();
    lines.forEach((l, k)=>text(l, PDF_M + 12, y + 18 + k * 14, {size:10, weight:600, color:PDF_COLORS.deep}));
  }
  // Page numbers and the maker on every page.
  pages.forEach((c, i)=>{
    ctx = c.getContext('2d');
    text(t('pdfFooter'), PDF_M, PDF_H - PDF_M + 14, {size:7.5, color:PDF_COLORS.soft});
    text(t('pdfPage')(i + 1, pages.length), PDF_W - PDF_M, PDF_H - PDF_M + 14, {size:7.5, color:PDF_COLORS.soft, align:'end'});
  });
  const jpegs = await Promise.all(pages.map(c=>new Promise(res=>c.toBlob(b=>res(b), 'image/jpeg', .9)).then(b=>b.arrayBuffer()).then(a=>new Uint8Array(a))));
  return new Blob([pdfFile(jpegs, doc.title)], {type:'application/pdf'});
}
function pdfRound(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/* A PDF with one full-page JPEG per page. The title is written as UTF-16, so any language works. */
function pdfFile(jpegs, title){
  const enc = new TextEncoder(), chunks = [], offsets = [];
  let size = 0;
  const push = part=>{ const b = typeof part === 'string' ? enc.encode(part) : part; chunks.push(b); size += b.length; };
  const obj = (n, body)=>{ offsets[n] = size; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const utf16 = s=>'<FEFF' + [...String(s)].map(ch=>{ const c = ch.codePointAt(0); if(c < 0x10000) return c.toString(16).padStart(4, '0'); const v = c - 0x10000; return ((v >> 10) + 0xD800).toString(16) + ((v & 0x3FF) + 0xDC00).toString(16); }).join('').toUpperCase() + '>';
  const kids = jpegs.map((_, i)=>`${4 + i * 3} 0 R`).join(' ');
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, ()=>push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, ()=>push(`<< /Type /Pages /Kids [${kids}] /Count ${jpegs.length} >>`));
  obj(3, ()=>push(`<< /Title ${utf16(title)} /Producer (Ricotta Orders) /Creator (Ricotta Orders) >>`));
  jpegs.forEach((jpg, i)=>{
    const page = 4 + i * 3, image = page + 1, content = page + 2;
    const w = Math.round(PDF_W * PDF_SCALE), h = Math.round(PDF_H * PDF_SCALE);
    const draw = `q ${PDF_W} 0 0 ${PDF_H} 0 0 cm /Im0 Do Q`;
    obj(page, ()=>push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
    obj(image, ()=>{ push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream'); });
    obj(content, ()=>push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });
  const count = 4 + jpegs.length * 3, xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n` + offsets.slice(1).map(o=>String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  for(const c of chunks){ out.set(c, at); at += c.length; }
  return out;
}

/* ---------- What the files hold ---------- */
const fileStamp = (at = new Date())=>formatIraqDateTime(at, {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
const fileDay = (at = new Date())=>erbilDate(at.toISOString());
const safeFileName = s=>String(s || '').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Ricotta';
/* This month's orders per item and per supplier: from the server (the exports role), or worked out from
   the orders on this phone when it is offline. */
async function catalogReport(){
  const r = await api('reports/catalog');
  if(r.ok && r.data) return r.data;
  const items = {}, suppliers = {};
  for(const o of state.history) for(const e of o.entries || []){
    if(e.supplierId){ const s = suppliers[e.supplierId] ||= {orders:0, lines:0, last:null, ids:new Set()}; s.ids.add(o.id); s.lines += (e.items || []).length; if(!s.last || o.date > s.last) s.last = o.date; s.orders = s.ids.size; }
    for(const it of e.items || []){ const x = items[it.itemId] ||= {orders:0, qty:0, last:null, ids:new Set()}; x.ids.add(o.id); x.qty += Number(it.qty) || 0; if(!x.last || o.date > x.last) x.last = o.date; x.orders = x.ids.size; }
  }
  return {items, suppliers, lastOrdered:{}};
}
const shortDate = iso=>iso ? formatIraqDateTime(iso, {day:'numeric', month:'short'}) : '';
const roundQty = q=>Math.round((Number(q) || 0) * 1000) / 1000;
function itemsTable(rep){
  const rows = [...state.items].sort((a, b)=>{
    const sa = a.supplierId ? supplierName(a.supplierId) : '￿', sb = b.supplierId ? supplierName(b.supplierId) : '￿';
    return sa.localeCompare(sb) || String(a.name).localeCompare(String(b.name));
  });
  return rows.map(i=>{
    const m = rep.items?.[i.id] || {}, last = m.last || rep.lastOrdered?.[i.id] || i.lastOrderedAt;
    return {item:i, cells:[i.name, i.supplierId ? supplierName(i.supplierId) : t('noSupplier'), unitLabel(i.unit), i.available === false ? t('fileNo') : t('fileYes'),
      Number(m.orders || 0), roundQty(m.qty), shortDate(last), (i.aliases || []).join(', '), i.note || '']};
  });
}
function suppliersTable(rep){
  return sortedByName(state.suppliers).map(s=>{
    const m = rep.suppliers?.[s.id] || {}, r = s.reminder;
    const days = r && r.enabled ? (reminderDays(r).length === 7 ? t('everyDay') : DAY_ORDER.filter(d=>reminderDays(r).includes(d)).map(d=>t('daysShort')[d]).join(', ')) : '';
    return {supplier:s, cells:[s.name, s.phone || '', state.items.filter(i=>i.supplierId === s.id).length, r && r.enabled ? r.time : '', days, s.cutoff || '', Number(m.orders || 0), Number(m.lines || 0), shortDate(m.last)]};
  });
}
async function exportCatalog(kind, format){
  const at = new Date(), rep = await catalogReport();
  const month = monthName();
  if(kind === 'items'){
    const table = itemsTable(rep);
    const title = t('fileItemsTitle'), subtitle = t('fileItemsSub')(state.items.length, month, fileStamp(at));
    if(format === 'excel'){
      const columns = [{label:t('fileItem'), width:34}, {label:t('supplier'), width:24}, {label:t('unit'), width:12}, {label:t('fileAvailable'), width:11},
        {label:t('fileOrdersMonth'), width:15, type:'number'}, {label:t('fileQtyMonth'), width:15, type:'number'}, {label:t('fileLastOrdered'), width:15}, {label:t('searchAliases'), width:30}, {label:t('itemNoteLabel'), width:28}];
      return deliverExcel(brandedWorkbook({title, subtitle, at, sheets:[{name:title, columns, rows:table.map(r=>r.cells)}]}), `${t('fileItemsTitle')} ${fileDay(at)}`);
    }
    // The PDF groups the items under their supplier.
    const rows = [];
    let group = null;
    for(const r of table){
      const g = r.cells[1];
      if(g !== group){ rows.push({group:g}); group = g; }
      rows.push([r.cells[0], r.cells[2], r.cells[3], String(r.cells[4] || '·'), r.cells[5] ? String(r.cells[5]) : '·', r.cells[6]]);
    }
    return deliverPdf({title, subtitle, stamp:fileStamp(at), info:[[t('items'), String(state.items.length)], [t('suppliers'), String(state.suppliers.length)], [t('fileOrderedMonth'), String(table.filter(r=>r.cells[4]).length)], [t('fileUnavailable'), String(state.items.filter(i=>i.available === false).length)]],
      sections:[{columns:[{label:t('fileItem'), w:34, bold:true}, {label:t('unit'), w:11}, {label:t('fileAvailable'), w:11}, {label:t('fileOrdersMonth'), w:13, align:'end'}, {label:t('fileQtyMonth'), w:13, align:'end'}, {label:t('fileLastOrdered'), w:14}], rows}]},
      `${t('fileItemsTitle')} ${fileDay(at)}`);
  }
  const table = suppliersTable(rep);
  const title = t('fileSuppliersTitle'), subtitle = t('fileSuppliersSub')(state.suppliers.length, month, fileStamp(at));
  const sum = i=>table.reduce((n, r)=>n + (Number(r.cells[i]) || 0), 0);
  if(format === 'excel'){
    const columns = [{label:t('supplier'), width:28}, {label:t('phone'), width:18}, {label:t('items'), width:9, type:'number'}, {label:t('fileReminder'), width:12}, {label:t('reminderDaysLabel'), width:26},
      {label:t('cutoffShort'), width:11}, {label:t('fileOrdersMonth'), width:15, type:'number'}, {label:t('fileLinesMonth'), width:15, type:'number'}, {label:t('fileLastOrder'), width:14}];
    return deliverExcel(brandedWorkbook({title, subtitle, at, sheets:[{name:title, columns, rows:table.map(r=>r.cells), totals:[t('fileTotal'), '', sum(2), '', '', '', sum(6), sum(7), '']}]}), `${t('fileSuppliersTitle')} ${fileDay(at)}`);
  }
  return deliverPdf({title, subtitle, stamp:fileStamp(at), info:[[t('suppliers'), String(state.suppliers.length)], [t('items'), String(state.items.length)], [t('fileOrdersMonth'), String(sum(6))], [t('fileLinesMonth'), String(sum(7))]],
    sections:[{columns:[{label:t('supplier'), w:26, bold:true}, {label:t('phone'), w:18}, {label:t('items'), w:8, align:'end'}, {label:t('fileReminder'), w:16}, {label:t('fileOrdersMonth'), w:12, align:'end'}, {label:t('fileLastOrder'), w:13}],
      rows:table.map(r=>[r.cells[0], r.cells[1] || '·', String(r.cells[2]), [r.cells[3], r.cells[4]].filter(Boolean).join(' · ') || '·', String(r.cells[6]), r.cells[8] || '·']),
      totals:[t('fileTotal'), '', String(sum(2)), '', String(sum(6)), '']}]}, `${t('fileSuppliersTitle')} ${fileDay(at)}`);
}
/* One supplier's order sheet (Send to suppliers, PDF): what to prepare, with quantities in bold. */
async function orderSheetPdf(entry, supplier){
  const at = new Date();
  const name = supplier?.name || t('noSupplier');
  const noteOf = id=>(state.items.find(x=>x.id === id) || {}).note || '';
  const rows = sortedSupplierItems(entry.items).map((item, n)=>[String(n + 1), item.name + (noteOf(item.itemId) ? ` (${noteOf(item.itemId)})` : ''), `${item.qty}`, unitLabel(item.unit)]);
  return deliverPdf({title:t('fileOrderTitle'), subtitle:t('fileOrderSub')(name), stamp:fileStamp(at),
    info:[[t('supplier'), name], [t('phone'), supplier?.phone || '·'], [t('fileDate'), formatIraqDateTime(at, {day:'numeric', month:'short', year:'numeric'})], [t('items'), String(entry.items.length)]],
    sections:[{columns:[{label:'#', w:6}, {label:t('fileItem'), w:56}, {label:t('fileQty'), w:16, align:'end', bold:true}, {label:t('unit'), w:22}], rows}],
    note:t('fileOrderNote')}, `${safeFileName(name)} ${fileDay(at)}`);
}
/* This month's orders (History, the report card): every line in Excel, or the month's report as a PDF. */
async function exportMonth(format){
  const at = new Date(), d = reportData(), month = monthName();
  const orders = [...state.history].sort((a, b)=>Date.parse(a.date) - Date.parse(b.date));
  const title = t('fileMonthTitle')(month), subtitle = t('fileMonthSub')(d.orders, d.days, fileStamp(at));
  if(format === 'excel'){
    const rows = [];
    orders.forEach(h=>(h.entries || []).forEach(e=>(e.items || []).forEach(it=>rows.push([erbilDate(h.date), formatIraqDateTime(h.date, {hour:'2-digit', minute:'2-digit', hour12:false}),
      accountLabel(h.by) || '', e.supplierId ? supplierName(e.supplierId) : (e.supplierName || t('noSupplier')), it.name, Number(it.qty), unitLabel(it.unit)]))));
    const summary = [[t('reportOrders'), d.orders], [t('reportDays'), d.days], [t('reportLines'), d.lines], [t('reportGrade'), d.grade],
      ...d.top.map((x, i)=>[i ? '' : t('reportTop'), `${x.name} · ${t('reportTimes')(x.times)}`]), ...(d.busiest >= 0 ? [[t('reportBusiest'), weekdayName(d.busiest)]] : []),
      [t('reportWho'), `${accountLabel('rozha')} ${d.who.rozha} · ${accountLabel('yunis')} ${d.who.yunis}`]];
    return deliverExcel(brandedWorkbook({title, subtitle, at, sheets:[
      {name:t('fileOrdersSheet'), columns:[{label:t('fileDate'), width:12}, {label:t('fileTime'), width:8}, {label:t('fileSentBy'), width:10}, {label:t('supplier'), width:24}, {label:t('fileItem'), width:30}, {label:t('fileQty'), width:10, type:'number'}, {label:t('unit'), width:12}], rows},
      {name:t('fileSummarySheet'), title:t('fileSummarySheet'), columns:[{label:t('fileWhat'), width:24}, {label:t('fileValue'), width:44}], rows:summary.map(([a, b])=>[a, typeof b === 'number' ? b : String(b)])},
    ]}), `${t('fileMonthFile')} ${fileDay(at).slice(0, 7)}`);
  }
  const rows = orders.flatMap(h=>[{group:`${formatIraqDateTime(h.date, {weekday:'short', day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})} · ${accountLabel(h.by) || ''}`},
    ...(h.entries || []).flatMap(e=>(e.items || []).map(it=>[e.supplierId ? supplierName(e.supplierId) : (e.supplierName || t('noSupplier')), it.name, String(it.qty), unitLabel(it.unit)]))]);
  return deliverPdf({title, subtitle, stamp:fileStamp(at),
    info:[[t('reportOrders'), String(d.orders)], [t('reportDays'), `${d.days} / ${d.elapsed}`], [t('reportLines'), String(d.lines)], [t('reportGrade'), d.grade]],
    sections:[...(d.top.length ? [{heading:t('reportTop'), columns:[{label:t('fileItem'), w:60, bold:true}, {label:t('fileTimes'), w:20, align:'end'}], rows:d.top.map(x=>[x.name, String(x.times)])}] : []),
      {heading:t('fileOrdersSheet'), columns:[{label:t('supplier'), w:30}, {label:t('fileItem'), w:40, bold:true}, {label:t('fileQty'), w:12, align:'end'}, {label:t('unit'), w:18}], rows}]},
    `${t('fileMonthFile')} ${fileDay(at).slice(0, 7)}`);
}
async function deliverExcel(bytes, name){
  const done = await deliverFile(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), `${safeFileName(name)}.xlsx`);
  if(done) toast(t('fileExcelReady'));
  return done;
}
async function deliverPdf(doc, name){
  const blob = await brandedPdf(doc);
  const done = await deliverFile(blob, `${safeFileName(name)}.pdf`);
  if(done) toast(t('filePdfReady'));
  return done;
}

/* ---------- Choosing a file ---------- */
/* Manage, Export: the items or the suppliers, as Excel or PDF. */
function openExportSheet(kind){
  if(!canDo('exports')) return;
  const choice = (format, icon, title, hint)=>`<button type="button" class="export-choice" data-export-as="${format}"><span class="ad-tile ${format === 'excel' ? 'green' : 'red'}" aria-hidden="true">${icon}</span><span><b>${esc(title)}</b><small>${esc(hint)}</small></span><i class="sheet-chevron" aria-hidden="true"></i></button>`;
  const {el, close} = openKitchenSheet('export-sheet', `<div class="sel-title">${esc(t(kind === 'items' ? 'exportItemsTitle' : kind === 'suppliers' ? 'exportSuppliersTitle' : 'exportMonthTitle'))}</div>
    <p class="notif-sub">${esc(t(kind === 'month' ? 'exportMonthHint' : 'exportHint'))}</p>
    <div class="export-choices">${choice('excel', ICON_SHEET, t('exportExcel'), t('exportExcelHint'))}${choice('pdf', NAV_ICONS.record, t('exportPdf'), t('exportPdfHint'))}</div>`, t('exportBtn'));
  el.querySelectorAll('[data-export-as]').forEach(b=>b.onclick = async()=>{
    if(el.querySelector('.export-choice.is-busy')) return;
    b.classList.add('is-busy'); b.setAttribute('aria-busy', 'true');
    try{
      if(kind === 'month') await exportMonth(b.dataset.exportAs); else await exportCatalog(kind, b.dataset.exportAs);
      close();
    }catch(e){
      console.error('Export failed', e);
      b.classList.remove('is-busy'); b.removeAttribute('aria-busy');
      await showAlert(esc(t('exportFailed')));
    }
  });
}
