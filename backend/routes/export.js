// =============================================================
// backend/routes/export.js — Exportación a Word (.docx real)
//
// POST /api/export/docx  Body: { html, title?, filename? }
//
// El frontend genera el HTML del documento (el mismo que la vista
// previa) y aquí se convierte a .docx:
//   1. juice   → pasa los estilos de <style> a atributos style=""
//   2. ajustes → html-to-docx solo entiende background-color
//   3. html-to-docx → documento Word con numeración de páginas
//   4. docx-fix     → reordena el XML según el esquema OOXML (si no, Word no lo abre)
// =============================================================
const express    = require('express');
const juice      = require('juice');
const HTMLtoDOCX = require('html-to-docx');
const { requireAuth } = require('../middleware/auth');
const { fixDocx } = require('../docx-fix');

const router = express.Router();

router.post('/docx', requireAuth, async (req, res) => {
  let { html, title, filename } = req.body || {};
  if (typeof html !== 'string' || !html.trim()) {
    return res.status(400).json({ error: 'Falta el contenido del documento.' });
  }

  try {
    // Sin imágenes remotas: html-to-docx las descargaría desde el servidor
    html = html.replace(/<img\b(?![^>]*\bsrc\s*=\s*["']?data:)[^>]*>/gi, '');
    html = juice(html, { removeStyleTags: true, preserveMediaQueries: false, preserveFontFaces: false });
    html = html.replace(/background:\s*(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*;?/g, 'background-color: $1;');

    const buf = await HTMLtoDOCX(html, null, {
      orientation: 'portrait',
      // header/footer/gutter obligatorios: si faltan, html-to-docx escribe "undefined"
      margins: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 567, footer: 567, gutter: 0 }, // 2 cm / 1 cm
      font: 'Calibri',
      fontSize: 22,                     // 11 pt (medios puntos)
      title: String(title || 'Programación didáctica').slice(0, 200),
      creator: 'Programaciones Didácticas FP Aragón',
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    }, null);
    const fixed = await fixDocx(buf);

    // Solo se quitan caracteres no válidos en nombres de archivo (Windows/macOS);
    // se conservan acentos y espacios, como en exportBaseName() del frontend
    const safeName = String(filename || 'programacion')
      .replace(/[\\/:*?"<>|\x00-\x1F]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\.docx?$/i, '').slice(0, 150) + '.docx';

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}"`,
    });
    res.send(fixed);
  } catch (e) {
    console.error('[Export] docx:', e.message);
    res.status(500).json({ error: 'No se pudo generar el documento Word.' });
  }
});

module.exports = router;
