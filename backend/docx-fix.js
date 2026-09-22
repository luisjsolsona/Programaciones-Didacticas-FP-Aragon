// =============================================================
// backend/docx-fix.js — Corrige el .docx que genera html-to-docx
//
// html-to-docx produce XML que LibreOffice abre pero Microsoft Word
// rechaza ("Word detectó un error al intentar abrir el archivo"),
// porque no respeta el orden de elementos del esquema OOXML:
//   · <w:sectPr> al principio del <w:body> (debe ir al final)
//   · <w:tblGrid> repetido y detrás de filas <w:tr>
//   · hijos de pPr / rPr / tblPr / tcPr / sectPr en orden incorrecto
//   · enlaces internos (#seccion) como relaciones externas
// Aquí se reordena todo según el esquema (ECMA-376).
// =============================================================
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Orden de hijos según el esquema
const ORDER = {
  pPr: ['pStyle','keepNext','keepLines','pageBreakBefore','framePr','widowControl','numPr','suppressLineNumbers',
        'pBdr','shd','tabs','suppressAutoHyphens','kinsoku','wordWrap','overflowPunct','topLinePunct','autoSpaceDE',
        'autoSpaceDN','bidi','adjustRightInd','snapToGrid','spacing','ind','contextualSpacing','mirrorIndents',
        'suppressOverlap','jc','textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle',
        'rPr','sectPr','pPrChange'],
  rPr: ['rStyle','rFonts','b','bCs','i','iCs','caps','smallCaps','strike','dstrike','outline','shadow','emboss',
        'imprint','noProof','snapToGrid','vanish','webHidden','color','spacing','w','kern','position','sz','szCs',
        'highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout',
        'specVanish','oMath'],
  tblPr: ['tblStyle','tblpPr','tblOverlap','bidiVisual','tblStyleRowBandSize','tblStyleColBandSize','tblW','jc',
          'tblCellSpacing','tblInd','tblBorders','shd','tblLayout','tblCellMar','tblLook','tblCaption','tblDescription'],
  tcPr: ['cnfStyle','tcW','gridSpan','hMerge','vMerge','tcBorders','shd','noWrap','tcMar','textDirection',
         'tcFitText','vAlign','hideMark'],
  trPr: ['cnfStyle','divId','gridBefore','gridAfter','wBefore','wAfter','cantSplit','trHeight','tblHeader',
         'tblCellSpacing','jc','hidden'],
  sectPr: ['headerReference','footerReference','endnotePr','footnotePr','type','pgSz','pgMar','paperSrc',
           'pgBorders','lnNumType','pgNumType','cols','formProt','vAlign','noEndnote','titlePg','textDirection',
           'bidi','rtlGutter','docGrid','printerSettings'],
  tblBorders: ['top','left','start','bottom','right','end','insideH','insideV'],
  tcBorders:  ['top','left','start','bottom','right','end','insideH','insideV','tl2br','tr2bl'],
  tblCellMar: ['top','left','start','bottom','right','end'],
  tcMar:      ['top','left','start','bottom','right','end'],
};

const kids = el => { const a = []; for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) a.push(n); return a; };
const byTag = (doc, tag) => Array.from(doc.getElementsByTagNameNS(W, tag));

function reorder(el, order) {
  const children = kids(el);
  const rank = c => { const i = order.indexOf(c.localName); return i === -1 ? order.length : i; };
  const sorted = children.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
  if (sorted.every((c, i) => c === children[i])) return;
  children.forEach(c => el.removeChild(c));
  sorted.forEach(c => el.appendChild(c));
}

function fixDocument(doc, rels) {
  // 1. sectPr al final del body
  const body = byTag(doc, 'body')[0];
  kids(body).filter(c => c.localName === 'sectPr').forEach(s => { body.removeChild(s); body.appendChild(s); });

  // 2. Tablas: tblPr → un único tblGrid → filas
  byTag(doc, 'tbl').forEach(tbl => {
    const ch    = kids(tbl);
    const tblPr = ch.find(c => c.localName === 'tblPr');
    const grids = ch.filter(c => c.localName === 'tblGrid');
    grids.forEach(g => tbl.removeChild(g));
    // La rejilla con más columnas
    const grid = grids.sort((a, b) => kids(b).length - kids(a).length)[0];
    if (grid) {
      const after = tblPr ? tblPr.nextSibling : tbl.firstChild;
      tbl.insertBefore(grid, after);
    }
    if (tblPr && tbl.firstChild !== tblPr) { tbl.removeChild(tblPr); tbl.insertBefore(tblPr, tbl.firstChild); }
  });

  // 3. Orden de propiedades
  for (const [tag, order] of Object.entries(ORDER)) byTag(doc, tag).forEach(el => reorder(el, order));

  // 4. Enlaces internos (#ancla) → w:anchor (sin relación externa)
  byTag(doc, 'hyperlink').forEach(h => {
    const id = h.getAttributeNS(R, 'id');
    const target = id && rels[id];
    if (target && target.startsWith('#')) {
      h.removeAttributeNS(R, 'id');
      h.setAttributeNS(W, 'w:anchor', target.slice(1));
      delete rels[id];
      rels.__removed.push(id);
    }
  });
}

async function fixDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser(), ser = new XMLSerializer();

  // Relaciones del documento
  const relsPath = 'word/_rels/document.xml.rels';
  const relsDoc  = parser.parseFromString(await zip.file(relsPath).async('string'), 'application/xml');
  const rels = { __removed: [] };
  Array.from(relsDoc.getElementsByTagName('Relationship')).forEach(r => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });

  const docXml = parser.parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  fixDocument(docXml, rels);
  zip.file('word/document.xml', ser.serializeToString(docXml));

  if (rels.__removed.length) {
    Array.from(relsDoc.getElementsByTagName('Relationship'))
      .filter(r => rels.__removed.includes(r.getAttribute('Id')))
      .forEach(r => r.parentNode.removeChild(r));
    zip.file(relsPath, ser.serializeToString(relsDoc));
  }

  // Resto de partes con propiedades (estilos, numeración, pie)
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(styles|numbering|footer\d*|header\d*)\.xml$/.test(name)) continue;
    const d = parser.parseFromString(await zip.file(name).async('string'), 'application/xml');
    for (const [tag, order] of Object.entries(ORDER)) byTag(d, tag).forEach(el => reorder(el, order));
    zip.file(name, ser.serializeToString(d));
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { fixDocx };
