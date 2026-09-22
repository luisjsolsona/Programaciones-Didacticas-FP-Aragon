// =============================================================
// backend/backup-scheduler.js — Copias automáticas de la BD
//
// Cada 24 h (y 1 min después de arrancar) guarda una copia
// consistente de SQLite en /app/data/backups/db-AAAA-MM-DD.sqlite
// y conserva las últimas BACKUP_KEEP (14 por defecto).
// En el host quedan en ./data/backups/ (mismo volumen).
// =============================================================
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const DIR  = path.join('/app/data', 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP || '14', 10);
const DAY  = 24 * 60 * 60 * 1000;

async function runBackup() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `db-${new Date().toISOString().slice(0, 10)}.sqlite`);
    await db.backup(file);

    const old = fs.readdirSync(DIR)
      .filter(f => /^db-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
      .sort()
      .slice(0, -KEEP);
    old.forEach(f => fs.unlinkSync(path.join(DIR, f)));

    console.log(`[Backup] OK → ${path.basename(file)}${old.length ? ` (eliminadas ${old.length} antiguas)` : ''}`);
  } catch (e) {
    console.error('[Backup] Error:', e.message);
  }
}

function startBackupScheduler() {
  setTimeout(runBackup, 60 * 1000);
  setInterval(runBackup, DAY);
}

module.exports = { startBackupScheduler, runBackup };
