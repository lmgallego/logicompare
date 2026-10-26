const path = require('path')
const fs = require('fs')

// Seed DSV System Nacional 2026 (origen Tarragona, solo Salidas).
// A diferencia de los otros seeds NO borra la agencia: las cotizaciones la referencian.
// Upsert: completa zonas/tarifas/áreas que falten y actualiza precios; los recargos
// se insertan con INSERT OR IGNORE por código para no pisar lo que haya editado el usuario.

const datos = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/dsv_system_2026.json'), 'utf8'))
const NOMBRE = 'DSV'

// Recargos marcados por defecto en la cotización (como el Excel)
const POR_DEFECTO = new Set(['incremento_responsabilidad'])

function sembrarDsv(db) {
  db.transaction(() => {
    // ── Agencia ──────────────────────────────────────────────────────────────
    let ag = db.prepare('SELECT * FROM agencias WHERE nombre = ?').get(NOMBRE)
    if (ag) {
      db.prepare("UPDATE agencias SET baremo = ?, motor = 'reglas' WHERE id = ?").run(datos.parametros.baremo_kg_m3, ag.id)
      console.log(`[seed:dsv] Agencia "${NOMBRE}" ya existe (ID ${ag.id}): se actualiza sin borrar.`)
    } else {
      const r = db.prepare(
        // DSV solo trabaja a portes pagados: fuera de Debidos
        `INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa, motor, admite_debidos)
         VALUES (?, 'Nacional', ?, 0, 0, NULL, 1, 'reglas', 0)`
      ).run(NOMBRE, datos.parametros.baremo_kg_m3)
      ag = { id: r.lastInsertRowid }
      console.log(`[seed:dsv] Agencia "${NOMBRE}" creada. ID: ${ag.id}`)
    }
    const agId = ag.id

    // ── Zonas, CPs y tarifas ─────────────────────────────────────────────────
    const getZona = db.prepare('SELECT id FROM zonas_agencia WHERE agencia_id = ? AND nombre_zona = ?')
    const insZona = db.prepare('INSERT INTO zonas_agencia (agencia_id, nombre_zona, kg_adicional, solo_debidos, multiple_zones) VALUES (?, ?, 0, 0, ?)')
    const insCp = db.prepare('INSERT OR IGNORE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)')
    const getTarifa = db.prepare('SELECT id FROM tarifas_agencia WHERE agencia_id = ? AND zona_id = ? AND kilos_desde = ? AND kilos_hasta = ?')
    const updTarifa = db.prepare('UPDATE tarifas_agencia SET precio_base = ? WHERE id = ?')
    const insTarifa = db.prepare('INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)')

    const tramos = datos.tramos_kg_hasta
    let nTarifas = 0
    for (const z of datos.zonas) {
      const precios = datos.tarifa_salidas[String(z.posicion)]
      const zonaId = getZona.get(agId, z.nombre)?.id ?? insZona.run(agId, z.nombre, z.multiple_zones ? 1 : 0).lastInsertRowid
      for (const cp of z.cp_prefix) insCp.run(agId, zonaId, cp)
      tramos.forEach((hasta, i) => {
        const desde = i === 0 ? 0 : tramos[i - 1]
        const t = getTarifa.get(agId, zonaId, desde, hasta)
        if (t) updTarifa.run(precios[i], t.id)
        else insTarifa.run(agId, zonaId, desde, hasta, precios[i])
        nTarifas++
      })
    }

    // ── Áreas remota / metropolitana (CP de 5 dígitos) ───────────────────────
    const insArea = db.prepare('INSERT OR IGNORE INTO cp_areas (agencia_id, tipo, cp5) VALUES (?, ?, ?)')
    let nAreas = 0
    for (const [tipo, lista] of [['remota', datos.cp_remotas], ['metropolitana', datos.cp_metropolitanas]]) {
      for (const cps of Object.values(lista)) for (const cp5 of cps) nAreas += insArea.run(agId, tipo, cp5).changes
    }

    // ── Recargos (no se pisan los existentes) ────────────────────────────────
    // "zonas:9,10,..." del JSON se guarda con nombres de zona, que es lo que conoce el motor
    const nombrePorPosicion = Object.fromEntries(datos.zonas.map(z => [String(z.posicion), z.nombre]))
    const aplicaConNombres = aplica => aplica.startsWith('zonas:')
      ? 'zonas:' + aplica.slice(6).split(',').map(p => nombrePorPosicion[p.trim()] || p.trim()).join(',')
      : aplica
    const insRecargo = db.prepare(
      `INSERT OR IGNORE INTO recargos_agencia
         (agencia_id, nombre, es_porcentaje, valor, minimo_aplicable, sobre_total,
          codigo, tipo, base, aplica, activo, por_defecto, orden, nota, actualizado)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    let nRecargos = 0
    datos.recargos.forEach((r, i) => {
      nRecargos += insRecargo.run(
        agId, r.nombre, r.tipo === 'porcentaje' ? 1 : 0, r.valor, r.minimo,
        r.codigo, r.tipo, r.base, aplicaConNombres(r.aplica),
        r.aplica === 'manual' ? 0 : r.activo, POR_DEFECTO.has(r.codigo) ? 1 : 0, i, r.nota || null
      ).changes
    })

    console.log(`[seed:dsv] ✅ ${datos.zonas.length} zonas, ${nTarifas} tarifas (insertadas/actualizadas), ` +
      `${nAreas} CP de área nuevos, ${nRecargos} recargos nuevos (los existentes no se tocan).`)
    console.log('[seed:dsv]    CP 07 → Mallorca/Menorca/Ibiza/Formentera. Sin cobertura: 35, 38, 00.')
  })()
}

// Arranque: siembra DSV una sola vez en BDs que no la tienen (instalaciones nuevas, BDs de v2.0.0).
// Si DSV ya existe no se toca nada. Queda registrado: si el usuario la borra después, no se recrea.
function sembrarDsvSiFalta(db) {
  const MIGRACION = 'dsv_autoseed'
  if (db.prepare('SELECT 1 FROM migraciones_aplicadas WHERE nombre = ?').get(MIGRACION)) return
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM agencias WHERE nombre = ?').get(NOMBRE)) sembrarDsv(db)
    db.prepare('INSERT OR IGNORE INTO migraciones_aplicadas (nombre) VALUES (?)').run(MIGRACION)
  })()
}

module.exports = { sembrarDsv, sembrarDsvSiFalta }
