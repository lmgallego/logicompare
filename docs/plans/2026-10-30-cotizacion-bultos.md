# Cotización con todos sus bultos — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development, tarea a tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** que cada cotización guarde TODOS sus bultos (más cp5, peso bruto y opciones DSV si se usaron) para la futura orden de carga, sin romper historial, exports ni BDs existentes.

**Arquitectura:** una columna nueva `cotizaciones.bultos_json TEXT` (nullable) con un objeto JSON. Los handlers de `quoteHandler.js` la rellenan con un helper `bultosJson()`. Las lecturas (`get-history`, `get-quotes-by-cliente`) devuelven además `num_bultos`, calculado en SQL (`json_array_length`), con 1 por defecto para las antiguas. El renderer solo muestra `num_bultos` y lo añade a los exports.

**Stack:** Electron 29, better-sqlite3 (JSON1 disponible, comprobado), JS vanilla en el renderer.

**Rama:** `feature/cotizacion-bultos` desde `main`. Sin push ni release.

## Decisiones

1. **Un solo JSON, no columnas nuevas** para cp5, peso bruto y opciones DSV. Es lo que menos cambia: una sola migración `ALTER TABLE` y un solo parámetro más en cada INSERT/UPDATE. Son datos de contexto que solo leerá la futura orden de carga; nadie filtra ni agrega por ellos en SQL. Si algún día hace falta filtrar por cp5, se puede añadir columna entonces.
2. **Formato de `cotizaciones.bultos_json`:**
   ```json
   {"bultos":[{"largoCm":120,"anchoCm":80,"altoCm":100},{"largoCm":60,"anchoCm":40,"altoCm":40,"pesoKg":12}],
    "cp5":"08001","pesoBruto":150,"opcionesDsv":{"incremento_responsabilidad":true},"producto":"priority"}
   ```
   - `bultos`: obligatorio, misma forma camelCase que `cotizaciones_pendientes.bultos_json` (ese es un array a secas; aquí va envuelto para que quepan los extras). `pesoKg` solo si viene en el bulto (hoy el formulario no tiene peso por bulto; se guarda lo que llegue).
   - `cp5`, `pesoBruto`: solo si tienen valor. `opcionesDsv`: solo si el objeto no está vacío. `producto`: solo si es distinto de `'system'`.
3. **`num_bultos` se calcula en SQL**, no en el renderer: `COALESCE(json_array_length(c.bultos_json, '$.bultos'), 1) AS num_bultos`. Así las antiguas (NULL) salen como 1 sin migrar datos, y el test lo puede comprobar sin DOM.
4. **resolve-pending-quote copia de la BD**: lee `bultos_json` de la pendiente por `pendingId` antes de borrarla. Si no existe la pendiente, usa `bultos` del payload. Las pendientes no guardan cp5/peso bruto/opciones DSV (fuera de alcance), así que esas cotizaciones solo tendrán `bultos`.
5. **save-quote-manual**: el modal manual solo tiene un bulto; se guarda `{"bultos":[{largo, ancho, alto}]}` (o `bultos` del payload si llegara).
6. **update-quote conserva los bultos**: si el payload trae `bultos`, se reescribe el JSON; si no, se lee el existente y se sustituye solo `bultos[0]` por el nuevo largo/ancho/alto (el modal de edición edita el primer bulto), conservando el resto de bultos y los extras. Si la cotización no tenía `bultos_json` (antigua), se deja NULL: no se migra.
7. **UI**: historial y consultas muestran una etiqueta `N bultos` junto a las medidas cuando `num_bultos > 1` (mismo estilo que la de pendientes). Con 1 bulto se ve igual que hoy.
8. **Exports**: columna `Bultos` (numérica) **al final** de las cuatro variantes (XLSX completa/simplificada, PDF completa/simplificada). Al final para no mover índices de `numCols` ni el resto de columnas.

## Restricciones globales

- No tocar `calculationService.js`, `recargosService.js` ni precios.
- `largo_cm/ancho_cm/alto_cm` siguen guardando el primer bulto.
- Migración aditiva e idempotente (`PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN bultos_json TEXT`), sin tocar filas existentes.
- Main = CommonJS, renderer = ESM. UI y comentarios en español.
- Deben seguir pasando igual: `scripts/snapshot-agencias.js` (comparado contra base sacada de `main`), `scripts/test-dsv.js`, `scripts/test-fechas.js`.
- Ejecutar scripts con BD: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/<x>.js` (test-fechas además `TZ=Europe/Madrid`).

## Review Focus

1. Cotización antigua (bultos_json NULL) editada con update-quote: debe seguir NULL y `num_bultos` = 1, sin error.
2. `bultos_json` corrupto o sin clave `bultos` en update-quote: no debe lanzar; se trata como ausente (se deja como está).
3. resolve con `pendingId` inexistente: usa `bultos` del payload, no falla.
4. `opcionesDsv` vacío `{}` y `pesoBruto` null: no deben aparecer en el JSON.
5. Migración ejecutada dos veces sobre la misma BD (arranque repetido): no falla y no duplica nada.

Cada uno tiene su caso en `scripts/test-bultos.js` (Tarea 1).

---

### Tarea 1: Migración + handlers + test

**Ficheros:**
- Modificar: `src/main/database/migrations.js` (junto al bloque de `desglose_json`, ~línea 343)
- Modificar: `src/main/ipcHandlers/quoteHandler.js` (`save-quote`, `get-history`, `resolve-pending-quote`, `get-quotes-by-cliente`, `update-quote`, `save-quote-manual`)
- Crear: `scripts/test-bultos.js`

**Interfaces:**
- Produce: columna `cotizaciones.bultos_json`; campo `num_bultos` (entero ≥ 1) en cada fila de `get-history` (`rows[]`) y `get-quotes-by-cliente`.
- Produce: `save-quote` acepta además `cp5`, `pesoBruto`, `opcionesDsv`, `producto` (todos opcionales). Tarea 2 los envía.

- [ ] **Paso 1: crear la rama**

  `git checkout main && git checkout -b feature/cotizacion-bultos`
  Antes de tocar código, sacar la base del snapshot: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/snapshot-agencias.js "$APPDATA/logicompare/logicompare.db" <scratchpad>/base.json`.

- [ ] **Paso 2: escribir `scripts/test-bultos.js` (falla)**

  Mismo arnés que `scripts/test-fechas.js` (mock de `electron` con `app.getPath` a un tmpDir, `ipcMain.handle` guardado en `handlers`, función `caso`, limpieza final). Sin requisito de TZ.
  Argumento opcional `process.argv[2]` = ruta de una BD: si viene, se copia como `<tmpDir>/logicompare.db` antes de requerir el handler (la original no se toca). Antes de `getDb()` guardar `COUNT(*)` de cotizaciones de la copia (con `better-sqlite3` directo, si la tabla existe).

  Casos (`reset()` = `DELETE FROM cotizaciones` y `DELETE FROM cotizaciones_pendientes`, se ejecuta después del caso de migración):
  - `migración: existe bultos_json y es idempotente` — `PRAGMA table_info(cotizaciones)` incluye `bultos_json`; llamar `runMigrations(db)` otra vez no lanza; con BD copiada, `COUNT(*)` igual al de antes y toda fila previa tiene `bultos_json` NULL y `num_bultos` 1 en `get-history({ sinLimite: true })`.
  - `save-quote con 2 bultos se lee con los 2` — `save-quote` con `bultos: [{largoCm:120,anchoCm:80,altoCm:100},{largoCm:60,anchoCm:40,altoCm:40,pesoKg:12}]`, `cp5:'08001'`, `pesoBruto:150`, `opcionesDsv:{incremento_responsabilidad:true}`, `producto:'priority'`, `cpPrefix:'08'`, `precioFinal:10`. Fila de `get-history({})`: `num_bultos === 2`, `largo_cm/ancho_cm/alto_cm === 120/80/100`, `JSON.parse(bultos_json)` deepEqual al objeto de la decisión 2 con esos valores.
  - `save-quote sin extras no guarda claves vacías` — `opcionesDsv:{}`, `pesoBruto:null`, `cp5:null`, `producto:'system'`, 1 bulto: `Object.keys(JSON.parse(bultos_json))` deepEqual `['bultos']`.
  - `resolver una pendiente de 3 bultos conserva los 3` — `save-pending-quote` con 3 bultos, coger su id de `get-pending-quotes`, `resolve-pending-quote` con ese `pendingId` y `bultos` **de 1 solo** (para probar que copia de la BD): `num_bultos === 3`, la pendiente ya no existe.
  - `resolve con pendingId inexistente usa los bultos del payload` — `pendingId: 99999`, `bultos` de 2: `num_bultos === 2`.
  - `manual conserva su bulto` — `save-quote-manual` (`fecha:'2026-08-15'`, 50/40/30): `JSON.parse(bultos_json).bultos` deepEqual `[{largoCm:50,anchoCm:40,altoCm:30}]`, `num_bultos === 1`.
  - `update conserva los bultos y actualiza el primero` — guardar la de 2 bultos con extras, `update-quote` con `largoCm:130` (resto igual, sin `bultos`): 2 bultos, `bultos[0].largoCm === 130`, `bultos[1]` intacto, `cp5` intacto, `largo_cm === 130`.
  - `update con bultos en el payload los reescribe` — `update-quote` con `bultos` de 3: `num_bultos === 3`.
  - `antigua sin bultos_json se lee como 1 bulto y update no la migra` — insert directo sin `bultos_json`; `get-history` y `get-quotes-by-cliente` (con `cliente_codigo`) dan `num_bultos === 1`; tras `update-quote` sigue `bultos_json === null`.
  - `bultos_json corrupto no rompe update` — `UPDATE cotizaciones SET bultos_json = 'xx'`; `update-quote(...).ok === true`, `bultos_json` sigue `'xx'`.

- [ ] **Paso 3: ejecutarlo y verlo fallar**

  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/test-bultos.js`
  Esperado: `FALLO` en los casos (no existe `bultos_json` / `num_bultos` undefined), exit code ≠ 0.

- [ ] **Paso 4: migración** en `migrations.js`: si `PRAGMA table_info(cotizaciones)` no incluye `bultos_json`, `ALTER TABLE cotizaciones ADD COLUMN bultos_json TEXT`. Comentario: bultos de la cotización (JSON), NULL en las antiguas.

- [ ] **Paso 5: handlers** en `quoteHandler.js`:
  - `bultosJson({ bultos, cp5, pesoBruto, opcionesDsv, producto }) -> string | null` junto a `desgloseJson`: null si `bultos` no es array no vacío; omite claves vacías según la decisión 2.
  - `save-quote`: destructurar `cp5, pesoBruto, opcionesDsv, producto` y añadir `bultos_json` al INSERT.
  - `save-quote-manual`: `bultos_json = bultosJson({ bultos: bultos?.length ? bultos : [{ largoCm, anchoCm, altoCm }] })` en los dos INSERT.
  - `resolve-pending-quote`: antes del DELETE, `SELECT bultos_json FROM cotizaciones_pendientes WHERE id = ?`; si hay fila, `bultos = JSON.parse(...)`; añadir `bultos_json` al INSERT.
  - `update-quote`: calcular `bultos_json` una vez antes de las 4 ramas (si viene `bultos` → `bultosJson`; si no, leer el actual, `try { JSON.parse }` y si tiene array `bultos` sustituir `bultos[0]` por `{ ...bultos[0], largoCm, anchoCm, altoCm }`; si no, dejar el valor actual tal cual) y añadir `bultos_json = ?` a los 4 UPDATE.
  - `get-history` y `get-quotes-by-cliente`: añadir `COALESCE(json_array_length(c.bultos_json, '$.bultos'), 1) AS num_bultos` al SELECT.

  Ojo: `json_array_length` sobre texto no JSON lanza en SQLite. Para el caso corrupto, usar `CASE WHEN json_valid(c.bultos_json) THEN json_array_length(c.bultos_json, '$.bultos') END` dentro del COALESCE.

- [ ] **Paso 6: test en verde y regresiones**

  - `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/test-bultos.js` → todos `ok`, exit 0.
  - BD vacía: lo anterior ya la cubre. BD real (copia): `... scripts/test-bultos.js "$APPDATA/logicompare/logicompare.db"` → todos `ok`. Comprobar después que el mtime/tamaño de la original no cambia.
  - `TZ=Europe/Madrid ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/test-fechas.js` → todos `ok`.
  - `node scripts/test-dsv.js` → todos `ok`.
  - Snapshot: `... scripts/snapshot-agencias.js "$APPDATA/logicompare/logicompare.db" <scratchpad>/rama.json --comparar <scratchpad>/base.json` → exit 0.

- [ ] **Paso 7: commit**

  `git add src/main/database/migrations.js src/main/ipcHandlers/quoteHandler.js scripts/test-bultos.js docs/plans/2026-10-30-cotizacion-bultos.md`
  `git commit -m "feat(cotizaciones): guardar todos los bultos en bultos_json"`

### Tarea 2: Renderer — enviar extras, mostrar nº de bultos, columna en exports

**Ficheros:**
- Modificar: `src/renderer/js/components/formHandler.js:537-550` (payload de `save-quote`)
- Modificar: `src/renderer/js/components/historyView.js` (`renderTable` celda Medidas; `buildXLSX` y `buildPDF`, ambas variantes)
- Modificar: `src/renderer/js/components/consultasView.js` (celda de medidas de la tabla)

**Interfaces:**
- Consume: `row.num_bultos` (Tarea 1); `save-quote` acepta `cp5, pesoBruto, opcionesDsv, producto`.

Sin tests automáticos (no hay DOM de pruebas en el proyecto); se verifica en la app en la Tarea 3.

- [ ] **Paso 1:** `formHandler.js`: añadir al `save-quote` `cp5`, `pesoBruto`, `opcionesDsv`, `producto` desde `lastFormDatos`.
- [ ] **Paso 2:** historial y consultas: tras las medidas, si `num_bultos > 1`, etiqueta `<span ...>N bultos</span>` con el estilo de la de `pendingView.js:504` (`text-[10px] font-black px-1.5 py-0.5 rounded-full`, fondo `rgba(0,64,224,0.08)`, color `#0040e0`).
- [ ] **Paso 3:** exports: añadir `'Bultos'` al final de `headers` en las dos variantes XLSX, `r.num_bultos ?? 1` al final de cada fila y su índice a `numCols` (simplificada: 5; completa: 11). PDF: `<th>Bultos</th>` y `<td>` al final en las dos variantes.
- [ ] **Paso 4:** `npx vite build` sin errores.
- [ ] **Paso 5:** commit `feat(historial): mostrar nº de bultos y columna Bultos en exports`.

### Tarea 3: Verificación en la app y limpieza

- [ ] **Paso 1:** copia de seguridad de la BD real: `cp "$APPDATA/logicompare/logicompare.db" "$APPDATA/logicompare/logicompare_backup_pre_bultos.db"` (app cerrada).
- [ ] **Paso 2:** `npm start`. Calcular con 2 bultos (120×80×100 y 60×40×40, CP 08) y elegir agencia. Historial: la fila muestra `2 bultos`. Exportar Excel completo y PDF completo: columna `Bultos` = 2, resto de columnas igual que antes. Consultas (si se asignó cliente): etiqueta `2 bultos`.
- [ ] **Paso 3:** comprobar en la BD con better-sqlite3 que la fila tiene `bultos_json` con los 2 bultos.
- [ ] **Paso 4:** borrar la cotización de prueba (botón borrar del historial) y los ficheros exportados. Comprobar `COUNT(*)` igual al de antes de la prueba.
- [ ] **Paso 5:** repetir los tests de la Tarea 1 paso 6. Sin push, sin tag, sin cambio de versión.
