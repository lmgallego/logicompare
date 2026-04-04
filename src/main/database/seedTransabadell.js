const { getDb } = require('./connection')

const db = getDb()
db.pragma('foreign_keys = OFF')

// ── Mapeo CP → Zona ────────────────────────────────────────────────────────
const CP_ZONA = {
  '43': 1,
  '08': 2,
  '03': 3, '12': 3, '17': 3, '22': 3, '25': 3,
  '46': 4, '50': 4,
  '28': 5,
  '01': 6, '02': 6, '20': 6, '26': 6, '30': 6, '31': 6, '48': 6,
  '19': 7, '42': 7, '44': 7,
  '04': 8, '09': 8, '13': 8, '14': 8, '18': 8, '23': 8, '29': 8,
  '39': 8, '40': 8, '41': 8, '45': 8, '47': 8,
  '15': 9, '16': 9, '24': 9, '27': 9, '32': 9, '33': 9, '36': 9,
  '05': 10, '06': 10, '07': 10, '10': 10, '11': 10, '21': 10,
  '34': 10, '37': 10, '49': 10,
  // Z11: Baleares Menorca/Ibiza/Formentera (CP 07, multiple_zones)
  '38': 13,
  '35': 15, '51': 15, '52': 15,
}

// Baleares CP 07: Zone 10 (normal) + Zone 11 (multiple_zones=1)
const BALEARES_MULTI_ZONE = 11

// ── Tramos de peso ─────────────────────────────────────────────────────────
// [kilos_desde, kilos_hasta, es_por_tonelada]
const TRAMOS = [
  [0, 5, 0],
  [5, 10, 0],
  [10, 20, 0],
  [20, 30, 0],
  [30, 40, 0],
  [40, 50, 0],
  [50, 60, 0],
  [60, 70, 0],
  [70, 80, 0],
  [80, 90, 0],
  [90, 100, 0],
  [100, 125, 0],
  [125, 150, 0],
  [150, 175, 0],
  [175, 200, 0],
  [200, 250, 0],
  [250, 300, 0],
  [300, 350, 0],
  [350, 400, 0],
  [400, 450, 0],
  [450, 500, 0],
  [500, 550, 0],
  [550, 600, 0],
  [600, 650, 0],
  [650, 700, 0],
  [700, 750, 0],
  [750, 800, 0],
  [800, 850, 0],
  [850, 900, 0],
  [900, 950, 0],
  [950, 1000, 0],
  [1000, 1100, 0],
  [1100, 1200, 0],
  [1200, 1300, 0],
  [1300, 1400, 0],
  [1400, 1500, 0],
  [1500, 1600, 0],
  [1600, 1700, 0],
  [1700, 1800, 0],
  [1800, 1900, 0],
  [1900, 2000, 0],
  [2000, 3000, 1],
  [3000, 4000, 1],
  [4000, 5000, 1],
  [5000, 99999, 1],
]

// ── Precios por zona (null = sin tarifa "—") ───────────────────────────────
// Índice de tramo corresponde al array TRAMOS
const PRECIOS = {
  1:  [null, 5.61, 7.59, 8.25, 8.96, 9.23, 9.52, 10.04, 10.36, 10.71, 11.00, 13.73, 16.49, 19.30, 20.35, 22.62, 27.12, 31.64, 36.16, 40.68, 45.20, 47.20, 51.49, 55.79, 60.08, 64.37, 64.96, 69.09, 73.11, 77.15, 81.22, null, null, null, null, null, null, null, null, null, null, 68.37, 55.51, 45.47, null],
  2:  [null, 6.34, 8.44, 9.80, 10.59, 10.90, 11.26, 11.85, 12.25, 12.67, 13.03, 16.26, 19.49, 22.81, 24.08, 26.73, 32.07, 37.42, 42.78, 47.96, 53.48, 55.84, 60.91, 65.98, 71.05, 76.00, 76.84, 81.66, 86.49, 91.25, 96.06, null, null, null, null, null, null, null, null, null, null, 80.85, 66.49, 53.78, null],
  3:  [null, 6.64, 8.89, 10.52, 12.14, 14.06, 15.97, 17.76, 19.53, 21.30, 23.08, 26.09, 29.05, 32.24, 34.19, 39.70, 46.26, 53.98, 61.69, 69.38, 77.10, 77.10, 80.28, 86.94, 93.65, 100.34, 100.34, 100.34, 102.00, 107.67, 113.31, null, null, null, null, null, null, null, null, null, null, 101.59, 99.37, 89.46, null],
  4:  [null, 6.34, 8.44, 9.80, 10.59, 11.75, 13.26, 14.66, 16.54, 17.37, 19.26, 23.87, 26.19, 30.02, 31.83, 36.71, 38.79, 49.82, 51.71, 62.77, 64.67, 66.55, 68.43, 70.33, 72.22, 76.89, 79.01, 85.39, 88.61, 95.07, 98.04, null, null, null, null, null, null, null, null, null, null, 87.91, 85.86, 74.18, null],
  5:  [null, 6.34, 8.44, 9.80, 11.37, 13.31, 15.13, 16.86, 19.06, 20.20, 22.39, 27.78, 30.88, 35.50, 38.10, 44.74, 48.23, 60.83, 64.27, 76.92, 80.38, 83.84, 87.31, 90.76, 94.23, 99.26, 102.71, 112.09, 115.56, 124.96, 128.39, null, null, null, null, null, null, null, null, null, null, 117.31, 117.31, 103.58, null],
  6:  [null, 6.34, 8.44, 10.35, 12.52, 14.86, 16.78, 18.74, 21.15, 22.56, 24.94, 30.53, 33.85, 38.60, 41.39, 48.41, 52.97, 65.89, 70.59, 83.57, 88.24, 88.27, 91.99, 96.34, 100.70, 106.43, 109.67, 118.04, 121.51, 130.85, 135.02, null, null, null, null, null, null, null, null, null, null, 119.27, 117.61, 105.60, null],
  7:  [null, 8.19, 10.33, 13.03, 15.40, 17.18, 19.05, 21.15, 23.02, 25.14, 27.11, 33.23, 38.45, 43.40, 48.79, 58.80, 65.67, 74.03, 81.75, 89.28, 95.68, 98.56, 101.46, 112.40, 115.28, 128.87, 131.78, 145.34, 148.25, 161.82, 164.71, null, null, null, null, null, null, null, null, null, null, 146.85, 142.18, 128.09, null],
  8:  [null, 8.05, 10.82, 13.93, 17.07, 20.39, 23.71, 26.95, 30.21, 33.39, 36.57, 41.67, 44.97, 48.39, 52.15, 58.80, 68.85, 80.35, 91.81, 103.27, 114.77, 114.77, 118.89, 128.78, 138.68, 148.60, 148.60, 148.60, 150.03, 158.40, 166.72, null, null, null, null, null, null, null, null, null, null, 150.33, 146.16, 141.33, null],
  9:  [null, 8.05, 10.82, 13.93, 17.07, 17.79, 20.43, 22.96, 25.91, 28.07, 31.08, 38.01, 42.93, 49.21, 53.73, 63.86, 71.72, 87.63, 95.61, 111.55, 119.55, 120.99, 128.50, 136.03, 143.56, 152.42, 158.46, 169.85, 177.23, 189.54, 196.92, null, null, null, null, null, null, null, null, null, null, 184.94, 176.42, 162.15, null],
  10: [null, 10.33, 13.42, 16.92, 20.38, 23.90, 27.43, 30.06, 32.71, 35.99, 39.28, 44.35, 49.37, 55.13, 60.85, 67.60, 76.10, 88.79, 101.46, 114.15, 126.85, 131.20, 143.13, 155.04, 166.95, 178.88, 178.88, 189.89, 201.08, 212.25, 223.41, null, null, null, null, null, null, null, null, null, null, 195.59, 181.71, 175.15, null],
  11: [null, 12.17, 15.40, 19.01, 21.68, 24.19, 27.59, 31.26, 33.87, 34.51, 38.02, 50.41, 55.80, 68.08, 73.33, 95.77, 97.91, 127.02, 130.49, 159.63, 163.12, 190.05, 191.94, 220.75, 223.92, 252.75, 255.93, 284.74, 287.90, 316.72, 319.89, null, null, null, null, null, null, null, null, null, null, 245.39, 238.78, 225.05, null],
  12: [10.57, 17.26, 21.58, 25.31, 29.37, 33.61, 37.43, 42.39, 46.60, 48.70, 50.54, 56.72, 63.01, 69.16, 72.60, 82.27, 91.88, 101.52, 111.14, 123.38, 137.24, null, 151.38, null, 165.55, null, 179.72, null, 193.84, null, 209.70, 222.99, 236.28, 249.62, 262.90, 276.23, 280.97, 298.56, 316.11, 333.69, null, 329.01, 158.59, 150.13, null],
  13: [null, 8.21, 11.11, 13.67, 16.25, 18.81, 21.24, 23.49, 25.87, 27.90, 30.25, 36.33, 39.95, 46.96, 51.27, 61.98, 72.12, 84.13, 93.70, 104.58, 116.32, null, 132.63, null, 153.36, null, 175.26, null, 197.14, null, 205.61, null, null, null, null, 198.75, null, null, null, null, null, 195.33, 189.12, null, 184.94],
  14: [null, 9.23, 13.17, 16.61, 19.43, 22.50, 25.47, 28.49, 31.11, 33.20, 36.31, 41.99, 46.64, 52.86, 57.68, 71.64, 82.49, 95.21, 107.29, 121.44, 136.32, null, 156.70, null, 176.56, null, 195.51, null, 213.76, null, 219.84, null, null, null, null, 212.54, null, null, null, null, null, 210.82, 207.55, null, 197.06],
  15: [null, 9.94, 14.72, 17.65, 20.38, 23.47, 27.13, 30.64, 33.69, 37.08, 40.16, 49.69, 56.97, 66.22, 72.71, 79.78, 94.26, 109.98, 119.11, 128.49, 142.75, null, 160.46, null, 187.18, null, 213.95, null, 240.70, null, 255.80, null, null, null, null, 241.49, null, null, null, null, null, 241.49, 227.94, null, 217.14],
  16: [null, 21.69, 24.12, 26.43, 28.81, 31.08, 37.97, 39.88, 41.94, 43.64, 45.71, 60.95, 64.95, 75.31, 80.07, 98.51, 109.68, 120.77, 130.07, 143.65, 159.78, null, 185.55, null, 214.98, null, 245.64, null, 276.35, null, 303.27, null, null, null, null, 297.37, null, null, null, null, null, 293.42, 288.16, null, 276.43],
}

// ── Seed ────────────────────────────────────────────────────────────────────
const insertAll = db.transaction(() => {
  // Delete existing Transabadell entries
  const existing = db.prepare("SELECT id, nombre FROM agencias WHERE nombre LIKE 'Transabadell%'").all()
  for (const row of existing) {
    const zonaIds = db.prepare('SELECT id FROM zonas_agencia WHERE agencia_id = ?').all(row.id).map(z => z.id)
    for (const zId of zonaIds) {
      db.prepare('DELETE FROM tarifas_kg_adicional WHERE zona_id = ?').run(zId)
    }
    db.prepare('DELETE FROM tarifas_agencia WHERE agencia_id = ?').run(row.id)
    db.prepare('DELETE FROM zonas_provincias WHERE agencia_id = ?').run(row.id)
    db.prepare('DELETE FROM zonas_agencia WHERE agencia_id = ?').run(row.id)
    db.prepare('DELETE FROM recargos_agencia WHERE agencia_id = ?').run(row.id)
    db.prepare('DELETE FROM agencias WHERE id = ?').run(row.id)
    console.log(`[seed] Eliminada agencia ID ${row.id} ("${row.nombre}").`)
  }

  const ag = db.prepare(
    `INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa)
     VALUES ('Transabadell', 'Nacional', 1, 0, 0, NULL, 1)`
  ).run()
  const agId = ag.lastInsertRowid
  console.log(`[seed] Agencia "Transabadell" creada. ID: ${agId}`)

  const insertZona = db.prepare(
    'INSERT INTO zonas_agencia (agencia_id, nombre_zona, kg_adicional, solo_debidos, multiple_zones) VALUES (?, ?, 0, 0, ?)'
  )
  const insertCp = db.prepare(
    'INSERT INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)'
  )
  const insertTarifa = db.prepare(
    'INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base, es_por_tonelada) VALUES (?, ?, ?, ?, ?, ?)'
  )

  // Create zones 1-16
  const zonaIds = {}
  for (let z = 1; z <= 16; z++) {
    const multiZone = (z === BALEARES_MULTI_ZONE) ? 1 : 0
    const res = insertZona.run(agId, `Zona ${z}`, multiZone)
    zonaIds[z] = res.lastInsertRowid
  }

  // Map CPs to zones
  for (const [cp, zona] of Object.entries(CP_ZONA)) {
    insertCp.run(agId, zonaIds[zona], cp)
  }
  // Zone 11 (Baleares multi) also gets CP 07
  insertCp.run(agId, zonaIds[11], '07')

  // Insert tariffs — skip null (—) entries
  let tarifaCount = 0
  for (let z = 1; z <= 16; z++) {
    const precios = PRECIOS[z]
    for (let i = 0; i < TRAMOS.length; i++) {
      const precio = precios[i]
      if (precio === null) continue
      const [desde, hasta, esPorTonelada] = TRAMOS[i]
      insertTarifa.run(agId, zonaIds[z], desde, hasta, precio, esPorTonelada)
      tarifaCount++
    }
  }

  console.log(`[seed] ✅ "Transabadell" insertada.`)
  console.log(`[seed]    16 zonas, ${tarifaCount} tarifas`)
  console.log(`[seed]    CP 07 → Zona 10 (general) + Zona 11 (Baleares Menorca/Ibiza/Formentera)`)
  console.log(`[seed]    Tramos ≥2000kg → €/Tonelada`)
  console.log(`[seed]    Baremo=1 por defecto — configúralo desde la UI`)
})

insertAll()
