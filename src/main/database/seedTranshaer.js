const { getDb } = require('./connection')

const db = getDb()

// ── Datos de tarifas por zona ──────────────────────────────────────────────
// Tarifas base: [kilos_desde, kilos_hasta, precio]
const TARIFAS_BASE = {
  1:  [[0,25,7.25],[25,50,10.92],[50,75,11.79],[75,100,15.57]],
  2:  [[0,25,8.83],[25,50,13.03],[50,75,14.07],[75,100,17.19]],
  3:  [[0,25,9.27],[25,50,13.92],[50,75,15.03],[75,100,18.37]],
  4:  [[0,25,9.72],[25,50,14.81],[50,75,16.00],[75,100,19.55]],
  5:  [[0,25,10.06],[25,50,15.49],[50,75,16.81],[75,100,20.54]],
  6:  [[0,25,11.12],[25,50,17.49],[50,75,19.13],[75,100,23.38]],
  7:  [[0,25,12.77],[25,50,20.28],[50,75,22.26],[75,100,27.83]],
  8:  [[0,25,17.69],[25,50,22.58],[50,75,27.56],[75,100,31.28]],
  Palma:      [[0,25,16.52],[25,50,21.71],[50,75,28.37],[75,100,33.08]],
  Ibiza:      [[0,25,18.31],[25,50,24.06],[50,75,31.43],[75,100,36.65]],
  Menorca:    [[0,25,18.31],[25,50,24.06],[50,75,31.43],[75,100,36.65]],
  Formentera: [[0,25,38.31],[25,50,50.35],[50,75,65.78],[75,100,76.70]],
}

// Bandas kg adicional >100kg: [kg_desde, kg_hasta(null=sin límite), precio_kg]
const KG_ADICIONAL = {
  1:  [[100,200,0.121],[200,300,0.111],[300,400,0.106],[400,500,0.101],[500,750,0.096],[750,1000,0.091],[1000,1500,0.086],[1500,2000,0.080],[2000,2500,0.075],[2500,3000,0.073],[3000,null,0.069]],
  2:  [[100,200,0.142],[200,300,0.133],[300,400,0.126],[400,500,0.122],[500,750,0.119],[750,1000,0.116],[1000,1500,0.108],[1500,2000,0.105],[2000,2500,0.102],[2500,3000,0.098],[3000,null,0.094]],
  3:  [[100,200,0.149],[200,300,0.140],[300,400,0.134],[400,500,0.129],[500,750,0.127],[750,1000,0.123],[1000,1500,0.118],[1500,2000,0.114],[2000,2500,0.110],[2500,3000,0.106],[3000,null,0.102]],
  4:  [[100,200,0.158],[200,300,0.152],[300,400,0.146],[400,500,0.144],[500,750,0.141],[750,1000,0.137],[1000,1500,0.133],[1500,2000,0.130],[2000,2500,0.127],[2500,3000,0.122],[3000,null,0.117]],
  5:  [[100,200,0.168],[200,300,0.161],[300,400,0.155],[400,500,0.151],[500,750,0.148],[750,1000,0.142],[1000,1500,0.140],[1500,2000,0.137],[2000,2500,0.134],[2500,3000,0.129],[3000,null,0.124]],
  6:  [[100,200,0.194],[200,300,0.186],[300,400,0.179],[400,500,0.175],[500,750,0.171],[750,1000,0.164],[1000,1500,0.158],[1500,2000,0.155],[2000,2500,0.152],[2500,3000,0.146],[3000,null,0.140]],
  7:  [[100,200,0.233],[200,300,0.223],[300,400,0.215],[400,500,0.197],[500,750,0.191],[750,1000,0.186],[1000,1500,0.181],[1500,2000,0.178],[2000,2500,0.174],[2500,3000,0.171],[3000,null,0.164]],
  8:  [[100,200,0.263],[200,300,0.249],[300,400,0.243],[400,500,0.239],[500,750,0.235],[750,1000,0.226],[1000,1500,0.217],[1500,2000,0.212],[2000,2500,0.208],[2500,3000,0.200],[3000,null,0.192]],
  Palma:      [[100,200,0.283],[200,300,0.274],[300,400,0.244],[400,500,0.237],[500,750,0.231],[750,1000,0.224],[1000,1500,0.218],[1500,2000,0.213],[2000,2500,0.204],[2500,3000,0.196],[3000,null,0.196]],
  Ibiza:      [[100,200,0.318],[200,300,0.308],[300,400,0.274],[400,500,0.267],[500,750,0.260],[750,1000,0.252],[1000,1500,0.245],[1500,2000,0.240],[2000,2500,0.230],[2500,3000,0.221],[3000,null,0.221]],
  Menorca:    [[100,200,0.318],[200,300,0.308],[300,400,0.274],[400,500,0.267],[500,750,0.260],[750,1000,0.252],[1000,1500,0.245],[1500,2000,0.240],[2000,2500,0.230],[2500,3000,0.221],[3000,null,0.221]],
  Formentera: [[100,200,0.661],[200,300,0.641],[300,400,0.570],[400,500,0.555],[500,750,0.540],[750,1000,0.523],[1000,1500,0.509],[1500,2000,0.498],[2000,2500,0.478],[2500,3000,0.459],[3000,null,0.459]],
}

// CPs por zona (peninsular)
const CPS_ZONA = {
  1: ['43'],
  2: ['17','08'],
  3: ['46','50'],
  4: ['03','12','28','25'],
  5: ['19','30','45','09','13','20','22','31','40','42','44'],
  6: ['01','05','14','23','24','33','34','37','47','48','49'],
  7: ['02','04','16','18','26','39'],
  8: ['06','10','11','15','21','27','29','32','36','41'],
}

// Baleares sub-zonas: todas usan CP 07 → multiple_zones=1
const BALEARES_ZONAS = ['Palma','Ibiza','Menorca','Formentera']

function seedAgencia(nombre, baremo) {
  const insertTarifa = db.prepare(
    'INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)'
  )
  const insertKgAdicional = db.prepare(
    'INSERT INTO tarifas_kg_adicional (zona_id, kg_desde, kg_hasta, precio_kg) VALUES (?, ?, ?, ?)'
  )
  const insertZona = db.prepare(
    'INSERT INTO zonas_agencia (agencia_id, nombre_zona, kg_adicional, solo_debidos, multiple_zones) VALUES (?, ?, ?, ?, ?)'
  )
  const insertCp = db.prepare(
    'INSERT OR REPLACE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)'
  )

  const ag = db.prepare(
    `INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa)
     VALUES (?, 'Nacional', ?, 0, 0, NULL, 1)`
  ).run(nombre, baremo)
  const agId = ag.lastInsertRowid
  console.log(`[seed] Agencia "${nombre}" creada. ID: ${agId}`)

  // Zonas peninsulares 1-8
  for (const zonaNum of [1,2,3,4,5,6,7,8]) {
    const zonaRes = insertZona.run(agId, `Zona ${zonaNum}`, 0, 0, 0)
    const zonaId = zonaRes.lastInsertRowid

    for (const cp of CPS_ZONA[zonaNum]) {
      insertCp.run(agId, zonaId, cp)
    }
    for (const [desde, hasta, precio] of TARIFAS_BASE[zonaNum]) {
      insertTarifa.run(agId, zonaId, desde, hasta, precio)
    }
    for (const [kgDesde, kgHasta, precioKg] of KG_ADICIONAL[zonaNum]) {
      insertKgAdicional.run(zonaId, kgDesde, kgHasta, precioKg)
    }
  }

  // Baleares: 4 sub-zonas, todas con CP 07, marcadas con multiple_zones=1
  for (const isla of BALEARES_ZONAS) {
    const zonaRes = insertZona.run(agId, `Baleares-${isla}`, 0, 0, 1)
    const zonaId = zonaRes.lastInsertRowid

    insertCp.run(agId, zonaId, '07')
    for (const [desde, hasta, precio] of TARIFAS_BASE[isla]) {
      insertTarifa.run(agId, zonaId, desde, hasta, precio)
    }
    for (const [kgDesde, kgHasta, precioKg] of KG_ADICIONAL[isla]) {
      insertKgAdicional.run(zonaId, kgDesde, kgHasta, precioKg)
    }
  }

  console.log(`[seed] ✅ "${nombre}" insertada. Zonas: 8 peninsulares + 4 Baleares.`)
}

const insertAll = db.transaction(() => {
  // Delete existing Transhaer entries
  const existing = db.prepare("SELECT id, nombre FROM agencias WHERE nombre LIKE 'Transhaer%'").all()
  for (const row of existing) {
    db.prepare('DELETE FROM agencias WHERE id = ?').run(row.id)
    console.log(`[seed] Eliminada agencia ID ${row.id} ("${row.nombre}").`)
  }

  seedAgencia('Transhaer (Palet)', 220)
  seedAgencia('Transhaer (Bulto)', 333)

  console.log('[seed] ✅ Transhaer completa.')
  console.log('[seed]    Palet: baremo 220 | Bulto: baremo 333')
  console.log('[seed]    CP 07 → 4 opciones Baleares (Palma/Ibiza/Menorca/Formentera)')
  console.log('[seed]    Sin cobertura: 35,38 (Canarias), 51,52 (Ceuta/Melilla), 00 (Portugal)')
})

insertAll()
