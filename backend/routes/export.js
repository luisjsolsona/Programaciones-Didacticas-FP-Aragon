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
// =============================================================
const express    = require('express');
const juice      = require('juice');
const HTMLtoDOCX = require('html-to-docx');
const { requireAuth } = require('../middleware/auth');

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
      margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2 cm
      font: 'Calibri',
      fontSize: 22,                     // 11 pt (medios puntos)
      title: String(title || 'Programación didáctica').slice(0, 200),
      creator: 'Programaciones Didácticas FP Aragón',
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    }, null);

    const safeName = String(filename || 'programacion')
      .replace(/[^\w.\-]+/g, '_').replace(/\.docx?$/i, '').slice(0, 120) + '.docx';

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}"`,
    });
    res.send(buf);
  } catch (e) {
    console.error('[Export] docx:', e.message);
    res.status(500).json({ error: 'No se pudo generar el documento Word.' });
  }
});

module.exports = router;
