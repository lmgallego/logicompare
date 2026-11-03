# Orden de carga: servicio de prioridad — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: superpowers:subagent-driven-development, tarea a tarea. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** para una fecha local y una agencia, devolver las cotizaciones asignadas ordenadas de "más caro de cambiar de agencia" a "más barato", para que lo que no quepa en el camión sea lo más barato de reasignar. Solo lógica, handler IPC y tests; sin pantalla.

**Arquitectura:** `src/main/services/ordenCargaService.js` con funciones puras (reciben los `resultados` de `calcularTarifas` ya calculados) más `obtenerOrdenCarga`, que lee la BD y llama a `calcularTarifas` una vez por cotización. `calculationService` y la BD se requieren **dentro** de `obtenerOrdenCarga`, así las puras se cargan con node a secas. Handler `get-orden-carga` en `ordenCargaHandler.js`.

**Stack:** Electron 29 (CommonJS en main), better-sqlite3. Tests en script node como los demás de `scripts/`.

**Rama:** `feature/orden-carga-servicio` desde `main`. Sin push ni release.

## Decisiones

1. **Una cotización = una fila.** Se recalcula con `calcularTarifas({ cpPrefix, bultos, cp5, pesoBruto, opcionesDsv, producto })`: todos sus bultos juntos, como el calculador. Una sola llamada por cotización da el precio de su propia agencia y los de las alternativas.
2. **Bultos:** se leen de `bultos_json` con los helpers que ya existen en `quoteHandler.js` (`parseBultosJson`, `conPrimerBultoDeColumnas`: las columnas mandan en el primer bulto). Se mueven a `src/main/services/bultosCotizacion.js` y `quoteHandler.js` los requiere de ahí; sin cambio de comportamiento. Sin `bultos_json`: `[{ largo_cm, ancho_cm, alto_cm }]` y aviso `Solo medidas del 1er bulto`.
3. **Elegible como alternativa:** agencia distinta de la de la cotización, activa, `precioFinal` no nulo (eso ya excluye "DSV fuera de medidas" y ">5000 kg", que vienen con `error`) y no fuera de norma. Las reglas de fuera de norma que hoy solo existen en el renderer (`formHandler.js:430-438`) se copian **en una sola función exportada** `motivoFueraDeNorma({ nombreAgencia, maxLargoCm, maxSumaDimCm }) -> string|null` en `src/main/services/elegibilidad.js`: GLS (nombre contiene `gls`, sin mayúsculas) con largo > 110 → `'GLS: largo > 110 cm'`; Seur (nombre contiene `seur`) con largo > 175 o L+A+H > 300 → `'Seur fuera de norma'`. Nota en `docs/elegibilidad-agencias.md` para unificarla con la pantalla más adelante. DSV con aviso de >2.500 kg vale; sus avisos pasan a la fila como `DSV: <aviso>`.
4. **`solo_debidos` / `admite_debidos` igual que el calculador de Pagados.** Comprobado que todas las cotizaciones son de Pagados: `save-quote` (Elegir en Pagados), `save-quote-manual` ("Añadir manual" de Pagados) y `resolve-pending-quote` (pendientes guardadas desde Pagados con Ctrl+N); Débidos no guarda nada y ningún campo lo indica. `calcularTarifas` ya excluye zonas `solo_debidos = 1`; `admite_debidos = 0` (DSV) **sí** es alternativa válida. El test lo comprueba en los dos sentidos.
5. **Zona guardada (nuevo):** `save-quote` y `resolve-pending-quote` guardan `zonaId` y `zonaNombre` de la zona del resultado elegido dentro de `bultos_json` (sin cambio de BD). `bultosJson()` los acepta como extras, solo si vienen; así `update-quote` con bultos los conserva. Si la cotización tiene `zonaId`, el recálculo propio usa el resultado de su agencia con esa `zona.id` y su isla, sin deducir.
6. **Islas sin zona guardada (CP con varias zonas, `zona.multiple_zones = 1`):** la isla original se deduce de la propia agencia: el resultado cuyo precio coincide con el guardado (±0,005 €). Si coincide exactamente una zona y su nombre dice la isla, esa es; si no, isla desconocida y la fila lleva `Isla sin confirmar`. `islaDeZona(nombre)` normaliza nombres distintos entre agencias: `mallorca`/`palma` → Mallorca, `menorca` → Menorca, `ibiza`/`eivissa` → Ibiza, `formentera` → Formentera; otro (`Baleares`, `Zona 11`) → null. En una alternativa con varias zonas: si la isla es conocida y alguna de sus zonas es esa isla, solo esas; si no, entre todas sus zonas y la fila lleva `Isla sin confirmar`.
7. **Agencia propia inactiva o sin resultado:** `precioRecalculado = null`, `tarifaCambiada = true`, aviso `Sin recalcular: agencia inactiva o sin cobertura`. No se toca el motor (afecta, por ejemplo, a Transhaer, hoy inactiva).
8. **Tarifa cambiada:** `|precioRecalculado − precioGuardado| > 0,005`. Excepción Logística en Cataluña, cuya zona depende de la hora (Matí-Tarda / Tarda-Matí): si la zona propia recalculada es una de esas dos franjas, `obtenerOrdenCarga` calcula también el precio con la otra franja y, si el guardado coincide con ese, **no** se marca `Tarifa cambiada`. Para ello `calculationService.js` **exporta** `calcularPrecioBultos` (solo se añade al `module.exports`, sin tocar su lógica). La alternativa se elige con la hora actual, como el calculador.
9. **Sobrecoste** = `alternativa.precio − precioGuardado` (2 decimales). **Por m³** = `sobrecoste / m3` (2 decimales; null si m3 = 0). m³ = suma de los bultos redondeada a 3 decimales, como el calculador.
10. **Orden:** primero sin alternativa (aviso `Sin alternativa: cargar sí o sí`), entre ellas m³ descendente; luego `sobrecostePorM3` descendente (null al final); empate por m³ descendente. Sobrecoste negativo → aviso `Más barato con <agencia>`.
11. **Handler:** `{ ok: true, filas }` o `{ ok: false, error }`, como `quoteHandler`. Valida `fecha` (`YYYY-MM-DD`) y `agenciaId` (entero).
12. **Sin cambios de BD.**

## Restricciones globales

- No cambiar la lógica de `calculationService.js` (solo se añade `calcularPrecioBultos` al `module.exports`), `recargosService.js` ni precios.
- Deben seguir pasando igual: `scripts/snapshot-agencias.js` (contra base sacada de `main` antes de tocar código), `scripts/test-dsv.js`, `scripts/test-fechas.js`, `scripts/test-bultos.js`, `scripts/test-fechas-vistas.mjs`.
- Sin cambios de BD ni migraciones.
- Main en CommonJS, renderer en ESM, comentarios y avisos en español.
- Scripts con BD: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/<x>.js` (los de fechas y orden de carga con `TZ=Europe/Madrid`).

## Review Focus

1. CP sin cobertura en ninguna agencia: fila sin alternativa y sin recalcular, sin lanzar.
2. `bultos_json` corrupto: se trata como antigua (columnas) y no rompe la lista (`parseBultosJson` → null, ya probado en `test-bultos.js`).
3. m³ = 0: `sobrecostePorM3 = null`, va tras las que tienen valor.
4. Varias zonas propias con el mismo precio guardado: `Isla sin confirmar`, sin elegir una al azar.
5. `fecha` / `agenciaId` inválidos en el handler: `{ ok: false, error }`, no excepción.

---

### Tarea 1: Funciones puras + elegibilidad + tests

**Ficheros:**
- Crear: `src/main/services/elegibilidad.js`, `docs/elegibilidad-agencias.md`
- Crear: `src/main/services/ordenCargaService.js`
- Crear: `scripts/test-orden-carga.js` (sección "puras"; la Tarea 3 añade la de BD)

**Interfaces (Produce):**
- `elegibilidad.js`: `motivoFueraDeNorma({ nombreAgencia, maxLargoCm, maxSumaDimCm }) -> string|null` (decisión 3).
- `ordenCargaService.js`:
  - `islaDeZona(nombreZona) -> 'Mallorca'|'Menorca'|'Ibiza'|'Formentera'|null`
  - `motivoNoElegible(resultado) -> string|null`: `resultado.error || 'Sin precio'` si `precioFinal` es null; si no, `motivoFueraDeNorma(...)` con `resultado.agencia.nombre`.
  - `recalculoPropio(resultados, { agenciaId, precioGuardado, zonaId }) -> { resultado|null, isla|null, islaSinConfirmar: boolean }` (decisiones 5 y 6: con `zonaId`, el de esa zona).
  - `elegirAlternativa(resultados, { agenciaId, isla }) -> { resultado, islaSinConfirmar: boolean } | null`
  - `construirFila(cot, resultados, { precioOtraFranja } = {}) -> fila`
    - `cot = { id, cliente_codigo, cliente_razon_social, destinatario, cp_prefix, agencia_id, precio_final, bultos, soloPrimerBulto, zonaId }`
    - `fila = { id, clienteCodigo, cliente, destinatario, cp, zona, numBultos, m3, precioGuardado, precioRecalculado, tarifaCambiada, alternativa: { agenciaId, agencia, zona, precio } | null, sobrecoste, sobrecostePorM3, avisos: string[] }`
    - `precioOtraFranja`: si `|precioGuardado − precioOtraFranja| ≤ 0,005`, `tarifaCambiada = false` (decisión 8).
  - `ordenarFilas(filas) -> filas` (copia; decisión 10).
  - `obtenerOrdenCarga`: stub que lanza `Error('Pendiente')` (lo implementa la Tarea 3).

Resultados de prueba con la forma de `calcularTarifas`: `{ agencia: { id, nombre, activa }, zona: { id, nombre_zona, multiple_zones }, precioFinal, error, avisos, maxLargoCm, maxSumaDimCm }`. Helper `res(id, nombre, precio, extra)` en el test.

- [ ] **Paso 1:** base del snapshot antes de tocar código: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/snapshot-agencias.js "$APPDATA/logicompare/logicompare.db" <scratchpad>/base-orden.json`
- [ ] **Paso 2: tests puros (fallan).** Arnés `caso()` como `scripts/test-bultos.js`. Casos:
  - `motivoFueraDeNorma`: GLS 110 → null, GLS 111 → `'GLS: largo > 110 cm'`; Seur largo 176 → `'Seur fuera de norma'`, Seur suma 301 → igual, Seur suma 300 → null; otra agencia con 200 → null.
  - `orden por sobrecoste/m³`: porM3 5, 20, 10 → orden 20, 10, 5.
  - `sin alternativa arriba`: va primera; dos sin alternativa por m³ descendente.
  - `empate por m³`: igual porM3, gana la de más m³.
  - `porM3 null va tras las que tienen valor` (m³ = 0).
  - `sobrecoste negativo marcado`: guardado 20, alternativa 15 → −5 y aviso `Más barato con <nombre>`.
  - `excluye propia, inactivas y no elegibles`: propia, `activa: 0`, `precioFinal: null`, GLS `maxLargoCm: 120`, Seur `maxSumaDimCm: 310` fuera; queda la válida.
  - `DSV con aviso de >2.500 kg vale` y el aviso pasa con prefijo `DSV: `.
  - `islaDeZona`: `'Baleares-Palma'` → Mallorca, `'Ibiza'` → Ibiza, `'Baleares'` → null, `'Zona 11'` → null.
  - `misma isla deducida por precio`: propia con Mallorca (precio = guardado) e Ibiza; alternativa multizona `Baleares-Palma` 30 y `Baleares-Ibiza` 10 → elige Palma 30, sin `Isla sin confirmar`.
  - `isla por zonaId guardada`: propia con Mallorca e Ibiza al **mismo** precio que el guardado y `zonaId` = Ibiza → alternativa `Baleares-Ibiza`, sin `Isla sin confirmar`.
  - `isla sin confirmar`: mismas dos zonas propias al mismo precio y sin `zonaId` → `Isla sin confirmar`, alternativa la más barata de sus zonas.
  - `propia sin resultado`: `precioRecalculado` null, `tarifaCambiada` true, aviso `Sin recalcular: agencia inactiva o sin cobertura`.
  - `tarifa cambiada`: propia 12, guardado 10 → `Tarifa cambiada`.
  - `franja Logística no es tarifa cambiada`: propia recalcula 12 (zona `Tarda-Matí`), guardado 10, `precioOtraFranja: 10` → sin `Tarifa cambiada`; con `precioOtraFranja: 11` → con.
  - `sin cobertura en ninguna`: todos null → alternativa null, `Sin alternativa: cargar sí o sí`.
  - `m³ sumados de todos los bultos`: 120×80×100 + 60×40×40 → `numBultos` 2, `m3` 1,056.
- [ ] **Paso 3:** `ELECTRON_RUN_AS_NODE=1 TZ=Europe/Madrid node_modules/electron/dist/electron.exe scripts/test-orden-carga.js` → fallos, exit ≠ 0.
- [ ] **Paso 4:** implementar. Sin require de BD/electron/`calculationService` en el nivel superior. `elegibilidad.js` lleva comentario apuntando a `formHandler.js:430-438`.
- [ ] **Paso 5:** verde, y `node -e "require('./src/main/services/ordenCargaService')"` con node a secas sin error.
- [ ] **Paso 6:** commit `feat(orden-carga): funciones puras para elegir alternativa y ordenar la carga` (incluye este plan y la nota de docs).

### Tarea 2: Guardar la zona en bultos_json

**Ficheros:**
- Crear: `src/main/services/bultosCotizacion.js` (`parseBultosJson`, `conPrimerBultoDeColumnas` movidas tal cual desde `quoteHandler.js`; también `bultosJson`)
- Modificar: `src/main/ipcHandlers/quoteHandler.js` (requiere los helpers; `save-quote` y `resolve-pending-quote` aceptan `zonaId`, `zonaNombre`)
- Modificar: `src/renderer/js/components/formHandler.js` (payload `save-quote`: `zonaId: r.zona?.id ?? null, zonaNombre: r.zona?.nombre_zona ?? null`)
- Modificar: `src/renderer/js/components/pendingView.js` (payload `resolve-pending-quote`: zona del resultado elegido, `resultadosValidos[idx].zona`)
- Modificar: `scripts/test-bultos.js`

**Interfaces:** `bultosJson({ bultos, cp5, pesoBruto, opcionesDsv, producto, zonaId, zonaNombre })`: `zonaId`/`zonaNombre` solo si vienen (no null). Formato de `bultos_json` ampliado: `{ bultos, cp5?, pesoBruto?, opcionesDsv?, producto?, zonaId?, zonaNombre? }`.

- [ ] **Paso 1: tests (fallan)** en `test-bultos.js`:
  - `save-quote guarda la zona`: con `zonaId: 127, zonaNombre: 'Mallorca'` → el JSON los tiene.
  - `resolve guarda la zona del resultado elegido`.
  - `update con bultos conserva la zona`.
  - `sin zona no hay claves zonaId/zonaNombre` (ajustar el caso existente "sin extras" si hace falta: con `zonaId: null` las claves no aparecen).
- [ ] **Paso 2:** ver fallar. **Paso 3:** implementar (mover helpers + `bultosJson` a `bultosCotizacion.js`, quoteHandler los requiere). **Paso 4:** `test-bultos.js` verde (BD vacía y copia de la real), `npx vite build` OK y restaurar `src/renderer/dist` (`git checkout -- src/renderer/dist && git clean -fd src/renderer/dist`).
- [ ] **Paso 5:** commit `feat(cotizaciones): guardar la zona elegida en bultos_json`.

### Tarea 3: obtenerOrdenCarga + handler

**Ficheros:**
- Modificar: `src/main/services/calculationService.js` (solo `module.exports` añade `calcularPrecioBultos`)
- Modificar: `src/main/services/ordenCargaService.js` (`obtenerOrdenCarga`)
- Crear: `src/main/ipcHandlers/ordenCargaHandler.js`
- Modificar: `src/main/main.js:197-207` (`require('./ipcHandlers/ordenCargaHandler')`)
- Modificar: `scripts/test-orden-carga.js` (sección BD)

**Interfaces:**
- `obtenerOrdenCarga({ fecha, agenciaId }) -> fila[]` ordenadas. SQL: `SELECT c.*, cl.razon_social AS cliente_razon_social FROM cotizaciones c LEFT JOIN clientes cl ON cl.codigo = c.cliente_codigo WHERE date(c.fecha,'localtime') = date(?) AND c.agencia_id = ?` + `conPrimerBultoDeColumnas`. Extras de `bultos_json` (`cp5`, `pesoBruto`, `opcionesDsv`, `producto`) a `calcularTarifas`; `zonaId` a `construirFila`. Franja Logística: si la zona propia recalculada es `Matí-Tarda` o `Tarda-Matí`, buscar la otra con `SELECT * FROM zonas_agencia WHERE agencia_id = ? AND nombre_zona = ?` y pasar `precioOtraFranja = calcularPrecioBultos(agencia, otra, bultos, extras).precioFinal`. Lanza `Error` en español si fecha/agencia inválidas.
- IPC `get-orden-carga` (`{ fecha, agenciaId }`) → `{ ok: true, filas } | { ok: false, error }`, `ipcMain.removeHandler` antes de `handle`.

- [ ] **Paso 1: tests de BD (fallan).** Arnés como `test-bultos.js` (mock electron, tmpDir, BD nueva con migraciones). Fixture: desactivar todas las agencias existentes; crear agencias `motor 'estandar'` sin recargos — A (la de las cotizaciones), B (`admite_debidos 0`), C (su zona del CP con `solo_debidos = 1`) — zona del CP `46` en cada una, bandas en `tarifas_agencia` con precios distintos (mirar columnas obligatorias con `PRAGMA table_info`). Casos:
  - `solo trae esa fecha local y esa agencia`: A en UTC `2026-11-02 23:30:00` (00:30 local del 03/11) y `2026-11-03 10:00:00`; A en `2026-11-02 12:00:00`; B el 03/11 → `fecha '2026-11-03', agenciaId A` devuelve exactamente las dos primeras.
  - `2 bultos = UNA fila con m³ sumados y alternativa con los dos`: `alternativa.precio` igual al de B en `calcularTarifas({ cpPrefix:'46', bultos: <los dos> })` y distinto del de B con solo el primero.
  - `respeta admite_debidos y solo_debidos como Pagados`: B puede ser la alternativa; C nunca aparece.
  - `antigua sin bultos_json`: un bulto con las columnas y aviso `Solo medidas del 1er bulto`.
  - `usa cp5, peso bruto, opciones y producto del JSON`: espiar `calcularTarifas` (envolver `module.exports` de `calculationService` antes de requerir el servicio).
  - `handler`: `{ fecha: 'xx', agenciaId: A }` → `ok: false` con `error`; válido → `ok: true` y `filas`.
- [ ] **Paso 2:** ver fallar. **Paso 3:** implementar. **Paso 4: todo en verde:** `test-orden-carga.js`, `test-bultos.js` (vacía y copia real), `test-fechas.js`, `test-fechas-vistas.mjs`, `test-dsv.js`, snapshot `--comparar <scratchpad>/base-orden.json` exit 0.
- [ ] **Paso 5:** commit `feat(orden-carga): obtenerOrdenCarga y handler get-orden-carga`.

### Tarea 4: Verificación (controlador)

- [ ] Copia de la BD real con la API `backup` de better-sqlite3 al scratchpad; script con mock de electron apuntando a la copia, llama a `get-orden-carga` para `2026-05-19` / GLS Express (id 1, 2 cotizaciones) y otra fecha con datos; BD original sin cambios (tamaño y mtime). Enseñar la lista.
- [ ] Fix de la hora de Pendientes (rama `fix/pendientes-hora-local`): app en desarrollo desde esa rama con `--user-data-dir` apuntando a una copia de la BD; crear una pendiente y comprobar que la hora coincide con la del sistema.
