const { ipcMain, dialog } = require('electron')
const { calcularTarifas } = require('../services/calculationService')
const { getDb } = require('../database/connection')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

ipcMain.handle('calcular-tarifas', (event, datos) => {
  return calcularTarifas(datos)
})

function redondear5(precio) {
  if (precio == null) return null
  return Math.ceil(precio * 20) / 20
}

ipcMain.handle('save-quote', (event, { largoCm, anchoCm, altoCm, cpPrefix, metrosCubicos, peso, agenciaId, precioFinal }) => {
  try {
    const precioRedondeado = redondear5(precioFinal)
    getDb()
      .prepare(`
        INSERT INTO cotizaciones (largo_cm, ancho_cm, alto_cm, cp_prefix, metros_cubicos, peso, agencia_id, precio_final, precio_redondeado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(largoCm, anchoCm, altoCm, cpPrefix, metrosCubicos || 0, peso || 0, agenciaId, precioFinal, precioRedondeado)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('get-history', (event, { desde, hasta, agenciaId } = {}) => {
  const conds = []
  const params = []
  if (desde) { conds.push('date(c.fecha) >= date(?)'); params.push(desde) }
  if (hasta) { conds.push('date(c.fecha) <= date(?)'); params.push(hasta) }
  if (agenciaId) { conds.push('c.agencia_id = ?'); params.push(agenciaId) }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
  const sql = `SELECT c.*, a.nombre as agencia_nombre FROM cotizaciones c LEFT JOIN agencias a ON a.id = c.agencia_id${where} ORDER BY c.fecha DESC LIMIT 500`
  return getDb().prepare(sql).all(...params)
})

ipcMain.handle('get-agencies-simple', () => {
  return getDb().prepare('SELECT id, nombre FROM agencias ORDER BY nombre').all()
})

ipcMain.handle('delete-history', (event, { desde, hasta } = {}) => {
  let sql = 'DELETE FROM cotizaciones'
  const params = []
  if (desde && hasta) {
    sql += ' WHERE date(fecha) >= date(?) AND date(fecha) <= date(?)'
    params.push(desde, hasta)
  } else if (desde) {
    sql += ' WHERE date(fecha) >= date(?)'
    params.push(desde)
  } else if (hasta) {
    sql += ' WHERE date(fecha) <= date(?)'
    params.push(hasta)
  }
  const result = getDb().prepare(sql).run(...params)
  return { deleted: result.changes }
})

// ── XLSX export via save dialog ──────────────────────────────────────────────
ipcMain.handle('export-xlsx', async (event, { filename, files }) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Guardar como Excel',
    defaultPath: filename,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (!filePath) return { ok: false }

  try {
    const buf = buildZip(files)
    fs.writeFileSync(filePath, buf)
    return { ok: true, filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

function buildZip(files) {
  const entries = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const dataBytes = Buffer.from(content, 'utf8')
    const compressed = zlib.deflateRawSync(dataBytes, { level: 6 })

    // Use stored (no compression) for small files to keep it simple & compatible
    const useDeflate = compressed.length < dataBytes.length
    const method = useDeflate ? 8 : 0
    const fileData = useDeflate ? compressed : dataBytes
    const crc = crc32(dataBytes)
    const modTime = dosTime(new Date())

    const localHeader = Buffer.alloc(30 + nameBytes.length)
    localHeader.writeUInt32LE(0x04034b50, 0)   // signature
    localHeader.writeUInt16LE(20, 4)            // version needed
    localHeader.writeUInt16LE(0, 6)             // flags
    localHeader.writeUInt16LE(method, 8)        // compression
    localHeader.writeUInt16LE(modTime.time, 10) // mod time
    localHeader.writeUInt16LE(modTime.date, 12) // mod date
    localHeader.writeUInt32LE(crc, 14)          // crc32
    localHeader.writeUInt32LE(fileData.length, 18) // compressed size
    localHeader.writeUInt32LE(dataBytes.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26) // filename length
    localHeader.writeUInt16LE(0, 28)            // extra field length
    nameBytes.copy(localHeader, 30)

    entries.push({ name: nameBytes, localHeader, fileData, crc, method, modTime,
      compressedSize: fileData.length, uncompressedSize: dataBytes.length, offset })
    offset += localHeader.length + fileData.length
  }

  const cdirParts = []
  for (const e of entries) {
    const cd = Buffer.alloc(46 + e.name.length)
    cd.writeUInt32LE(0x02014b50, 0)   // central dir signature
    cd.writeUInt16LE(20, 4)           // version made by
    cd.writeUInt16LE(20, 6)           // version needed
    cd.writeUInt16LE(0, 8)            // flags
    cd.writeUInt16LE(e.method, 10)    // compression
    cd.writeUInt16LE(e.modTime.time, 12)
    cd.writeUInt16LE(e.modTime.date, 14)
    cd.writeUInt32LE(e.crc, 16)
    cd.writeUInt32LE(e.compressedSize, 20)
    cd.writeUInt32LE(e.uncompressedSize, 24)
    cd.writeUInt16LE(e.name.length, 28)
    cd.writeUInt16LE(0, 30)           // extra length
    cd.writeUInt16LE(0, 32)           // comment length
    cd.writeUInt16LE(0, 34)           // disk start
    cd.writeUInt16LE(0, 36)           // internal attrs
    cd.writeUInt32LE(0, 38)           // external attrs
    cd.writeUInt32LE(e.offset, 42)    // local header offset
    e.name.copy(cd, 46)
    cdirParts.push(cd)
  }

  const cdir = Buffer.concat(cdirParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  const localParts = entries.map(e => Buffer.concat([e.localHeader, e.fileData]))
  return Buffer.concat([...localParts, cdir, eocd])
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[i] = c
    }
    return t
  })())
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8))
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}
