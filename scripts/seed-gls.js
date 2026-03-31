/**
 * Seed script: inserta datos de ejemplo para GLS Express
 * Ejecutar con: node scripts/seed-gls.js
 *
 * NOTA: Debe ejecutarse DESPUÉS de haber lanzado la app al menos una vez
 * (para que la BD y tablas existan en userData).
 */

const path = require('path')
const os = require('os')
const Database = require('better-sqlite3')

const USERDATA = path.join(os.homedir(), 'AppData', 'Roaming', 'logicompare')
const DB_PATH = path.join(USERDATA, 'logicompare.db')

console.log('Conectando a DB:', DB_PATH)

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

const insertAll = db.transaction(() => {
  // ── Agencia GLS ──────────────────────────────────────────────────
  const existing = db.prepare("SELECT id FROM agencias WHERE nombre = 'GLS Express'").get()
  if (existing) {
    console.log('GLS Express ya existe, omitiendo...')
    return
  }

  const agencia = db.prepare(
    "INSERT INTO agencias (nombre, ambito, logo_path, activa) VALUES ('GLS Express', 'Nacional', NULL, 1)"
  ).run()
  const agenciaId = agencia.lastInsertRowid
  console.log('Agencia creada. ID:', agenciaId)

  // ── Zonas ─────────────────────────────────────────────────────────
  const zonas = [
    { nombre: 'Zona 1 - Madrid/Barcelona' },
    { nombre: 'Zona 2 - Peninsula' },
    { nombre: 'Zona 3 - Baleares' },
    { nombre: 'Zona 4 - Canarias' },
  ]

  const insertZona = db.prepare('INSERT INTO zonas_agencia (agencia_id, nombre_zona) VALUES (?, ?)')
  const zonaIds = {}
  for (const z of zonas) {
    const res = insertZona.run(agenciaId, z.nombre)
    zonaIds[z.nombre] = res.lastInsertRowid
  }
  console.log('Zonas creadas:', Object.keys(zonaIds))

  // ── Mapeo CP → Zona ──────────────────────────────────────────────
  const insertCp = db.prepare(
    'INSERT OR REPLACE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)'
  )

  const zona1Cps = ['28', '08', '17', '25', '43'] // Madrid, Barcelona, Girona, Lleida, Tarragona
  const zona2Cps = [
    '01','02','03','04','05','06','09','10','11','12','13','14','15',
    '16','18','19','20','21','22','23','24','26','27','29','30','31',
    '32','33','34','36','37','38','39','40','41','42','44','45','46',
    '47','48','49','50','51','52',
  ]
  const zona3Cps = ['07'] // Baleares
  const zona4Cps = ['35', '38'] // Canarias (Las Palmas y Sta Cruz de Tenerife)

  for (const cp of zona1Cps) insertCp.run(agenciaId, zonaIds['Zona 1 - Madrid/Barcelona'], cp)
  for (const cp of zona2Cps) insertCp.run(agenciaId, zonaIds['Zona 2 - Peninsula'], cp)
  for (const cp of zona3Cps) insertCp.run(agenciaId, zonaIds['Zona 3 - Baleares'], cp)
  for (const cp of zona4Cps) insertCp.run(agenciaId, zonaIds['Zona 4 - Canarias'], cp)
  console.log('CPs asignados a zonas')

  // ── Tarifas (precio base sin recargos) ───────────────────────────
  const insertTarifa = db.prepare(
    'INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)'
  )

  const tarifasZona1 = [
    [0, 1, 4.50], [1, 2, 5.00], [2, 3, 5.50], [3, 5, 6.20],
    [5, 10, 7.80], [10, 15, 9.50], [15, 20, 11.20], [20, 30, 14.00],
    [30, 50, 18.50], [50, 70, 24.00],
  ]
  const tarifasZona2 = [
    [0, 1, 5.20], [1, 2, 5.80], [2, 3, 6.40], [3, 5, 7.20],
    [5, 10, 9.00], [10, 15, 11.00], [15, 20, 13.00], [20, 30, 16.50],
    [30, 50, 22.00], [50, 70, 29.00],
  ]
  const tarifasZona3 = [
    [0, 1, 7.00], [1, 2, 7.80], [2, 3, 8.60], [3, 5, 9.80],
    [5, 10, 12.50], [10, 15, 15.50], [15, 20, 18.50], [20, 30, 23.00],
    [30, 50, 30.00], [50, 70, 40.00],
  ]
  const tarifasZona4 = [
    [0, 1, 9.50], [1, 2, 10.50], [2, 3, 11.50], [3, 5, 13.00],
    [5, 10, 17.00], [10, 15, 21.00], [15, 20, 25.00], [20, 30, 32.00],
    [30, 50, 42.00], [50, 70, 55.00],
  ]

  const allTarifas = [
    { zonaKey: 'Zona 1 - Madrid/Barcelona', filas: tarifasZona1 },
    { zonaKey: 'Zona 2 - Peninsula', filas: tarifasZona2 },
    { zonaKey: 'Zona 3 - Baleares', filas: tarifasZona3 },
    { zonaKey: 'Zona 4 - Canarias', filas: tarifasZona4 },
  ]

  for (const { zonaKey, filas } of allTarifas) {
    for (const [desde, hasta, precio] of filas) {
      insertTarifa.run(agenciaId, zonaIds[zonaKey], desde, hasta, precio)
    }
  }
  console.log('Tarifas insertadas')

  // ── Recargos ──────────────────────────────────────────────────────
  const insertRecargo = db.prepare(
    'INSERT INTO recargos_agencia (agencia_id, nombre, es_porcentaje, valor, minimo_aplicable, sobre_total) VALUES (?, ?, ?, ?, ?, ?)'
  )

  insertRecargo.run(agenciaId, 'Combustible', 1, 8.5, null, 0)   // 8.5% sobre tarifa base
  insertRecargo.run(agenciaId, 'Seguro', 1, 0.3, 0.50, 1)        // 0.3% sobre total, mín 0.50€
  console.log('Recargos insertados')

  console.log('\n✅ GLS Express insertado correctamente.')
  console.log('   Para probarlo: CP 28 (Madrid), dimensiones 40×30×30, peso 5kg')
})

try {
  insertAll()
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
}

db.close()
