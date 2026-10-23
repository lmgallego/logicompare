# Nueva agencia: DSV System Nacional 2026 — especificación de integración

Fuente: `ELMER AUTOMOTION 1 m3 220 kilos Tarifa Nacional System.xlsx` (tarifa `NAC - PT 2026v1`, cliente ELMER AUTOMOTION S.L., origen **Tarragona**).
Datos extraídos y listos para el seed: `csv/dsv_system_2026.json`.
Estado: **solo preparación**, no se ha tocado código de la app.

## 1. Cómo calcula el Excel (hoja `Calculadora_NAC`)

| Paso | Regla | Celdas |
|---|---|---|
| 1. Volumen | m³ = Σ (largo×ancho×alto / 1e6 × nº bultos). Máx. 20 m³. Sin redondear. | D22:H22, D27 |
| 2. Peso tasable | `max(m³ × 220, peso bruto total)`. Factor **220 kg/m³** (parámetro D15). Sin redondear. Máx. 5.000 kg. | D24, H27 |
| 3. Zona | Origen fijo Tarragona; la provincia de destino da una zona (posición 1–16). | D41, `AN:AP` |
| 4. Banda de peso | ≤30→30, ≤50→50, ≤70→70, ≤100→100, ≤300→múltiplo de 50, ≤1000→múltiplo de 100, ≤3000→múltiplo de 250, ≤5000→múltiplo de 500. Más de 5.000 kg → `NA`. | D43 |
| 5. Flete | `tarifa[banda][zona]` × 1,30 si **System Priority** × 1,20 si es **Llegadas**. | D43 |
| 6. Opciones | Reserva manual + Incremento responsabilidad + ADR + Pre-aviso + Día fijo + Priority 10/12. | D45 |
| 7. Suplementos | Fuel + Tasa Transición Energética + Área metropolitana + Área remota + Largo T1 + Largo T2. | D47 |
| 8. Total | `flete + opciones + suplementos` (IVA no incluido). | D50 |

Fuel = `ROUND(fuel% × (flete + Priority10 + Priority12), 2)`. La TTE y el resto de opciones **no** entran en la base del fuel.
Las bandas del Excel equivalen a intervalos `(desde, hasta]`, igual que `tarifas_agencia` en la app. Hoja Llegadas = Salidas × 1,20 en las 27×16 celdas (verificado).

Mapeo de zonas desde Tarragona (prefijo CP → zona):

| Zona | Prefijos |
|---|---|
| 1 | 43 |
| 2 | 08, 25, 46 |
| 3 | 01, 02, 03, 12, 17, 19, 20, 26, 28, 30, 31, 39, 45, 48, 50 |
| 4 | 05, 09, 13, 22, 24, 42, 44, 47 |
| 5 | 06, 10, 14, 23, 33, 37, 40, 41 |
| 6 | 15, 16, 18, 27, 32, 34, 36, 49 |
| 7 | 04, 11, 21, 29 |
| 9–12 | 07 Baleares: Mallorca, Menorca, Ibiza, Formentera (una zona por isla) |
| 13 / 14 | 51 Ceuta / 52 Melilla |
| 15 / 16 | Gibraltar / Andorra (la app no tiene esos CP) |

Canarias (35, 38) no tiene tarifa en este Excel → "Sin cobertura".

## 2. Recargos y opciones (catálogo editable)

Todos están en `csv/dsv_system_2026.json` → `recargos`, con importe, mínimo, base y celda de origen. Los marcados *manual* son sucesos puntuales que no se calculan en la cotización (activo=0).

| Código | Regla | Cuándo |
|---|---|---|
| combustible | **12,75 %** sobre flete (+Priority 10/12) | siempre. **Cambia cada mes** |
| tte | 0,50 € por envío | siempre |
| area_remota | 25 % del flete, mín. 7 € | CP de la lista remota (3.739 CP) |
| area_metropolitana | ver discrepancia | CP de la lista metropolitana (578 CP) |
| incremento_responsabilidad | 8 % flete, mín. 1,50 € | opcional (en el Excel viene en "Sí") |
| adr | 15 % flete, mín. 10 € | opcional; no con Priority ni Día fijo |
| preaviso | 10 € (teléfono; SMS/email gratis) | opcional |
| dia_fijo / dia_fijo_13 / dia_fijo_10 | 25 € / 55 € / 65 € | opcional; no con Largos |
| largo_tipo1 | 20 % flete, mín. 40 € | lado mayor 240–300 cm |
| largo_tipo2 | 30 % flete, mín. 75 € | lado mayor 300–600 cm (2º lado ≤40, alto ≤40, ≤30 kg) |
| reserva_manual | 7 € | opcional |
| priority_12 / priority_10 | 20 € / 40 € (según la calculadora del Excel) | solo System Priority; entran en la base del fuel |
| mfr_baleares | 0,60 € por 100 kg tasables, mín. 0,60 € | zonas 9–12. **Inactivo** (la calculadora no lo suma); editable |
| manual: dirección incorrecta 5 €, corrección de datos 10 €, segunda entrega 30 %, gran superficie 6,40 €, no paletizada 1 €/bulto, escaneo albarán 1,50 €, seguro 0,3 % mín. 15 €, almacenaje 15 €/día | | referencia, activo=0 |

Ecotasas, Mobility Package, UK, ICS2, Ferry y aduanas son internacionales: fuera de alcance.

## 3. Discrepancias del propio Excel (hay que confirmarlas con DSV)

1. ~~**Priority 10/12**~~ **Resuelta según la calculadora del Excel**: Priority 12 = 20 € y Priority 10 = 40 €. (La hoja `Opciones y Suplementos` dice nacional 10 € y 20 €; se descarta.)
2. **Área metropolitana**: la calculadora aplica `max(7 €, 25 % flete)` (igual que remota); la hoja de opciones dice 5 € fijos por envío. En el JSON he dejado la fórmula de la calculadora.
3. **Fuel**: la hoja de opciones dice "12,75 % sobre el porte. Se cobraría el 50 % del fuel normal". La calculadora usa 12,75 % entero. No sé si 12,75 % ya es ese 50 %.
4. ~~**MFR Baleares**~~ **Resuelta según la calculadora del Excel**: no se suma. Queda en `recargos_agencia` con `activo = 0`, editable si DSV lo factura.
5. **Factor 220** (acuerdo Elmer) frente a la nota genérica "1 m³ = 333 kg". Prevalece 220.

## 4. Qué choca con la app actual

- **CP de 2 dígitos** en los 5 formularios (calculadora, medidas Elmer, parachoques, cajas, cospel). Área remota/metropolitana necesita el CP completo.
- **No hay peso real**: la app calcula `ceil(m³ × baremo)`; DSV cobra `max(volumétrico, peso bruto)`. Sin peso real se puede infravalorar.
- **`calcularMetrosCubicos` redondea a 3 decimales** y `calcularPeso` hace `ceil`: pueden mover un envío de banda en el límite (p. ej. 29,9 kg vs 30).
- **>5.000 kg o >20 m³**: el motor actual usaría "banda máxima + kg_adicional" (=0) y devolvería el precio de 5.000 kg sin avisar. Para DSV hay que devolver error.
- **`recargos_agencia` existe pero el motor no la usa** (solo `recargo_combustible` y `recargo_seguro` de `agencias`). Es la base natural para recargos editables.
- La tarjeta de resultados tiene `desgloseHtml = ''`: hoy no muestra desglose.
- Los seeds actuales borran y recrean la agencia: para DSV **no puede borrar los recargos** que el usuario haya editado.

## 5. Propuesta de modificación (por commits, rama `feature/agencia-dsv`, después de cerrar v2.0.0 y 2.0.1)

1. **Migración** (idempotente, solo `ALTER`/`CREATE IF NOT EXISTS`):
   - `recargos_agencia` + `codigo`, `tipo` (porcentaje | fijo | por_100kg | por_bulto), `base`, `aplica`, `activo`, `por_defecto`, `orden`, `nota`, `actualizado`.
   - `agencias` + `motor` (`estandar` por defecto, `reglas` para DSV): las otras 6 agencias siguen exactamente igual.
   - Tabla `cp_areas (agencia_id, tipo 'remota'|'metropolitana', cp5, PK compuesta)`.
   - `cotizaciones` + `desglose_json` (opcional, para histórico).
2. **`seedDsv.js`** + script `seed:dsv`: lee `csv/dsv_system_2026.json`; crea agencia (baremo 220), zonas, bandas, prefijos y `cp_areas`. Los recargos se insertan con `INSERT OR IGNORE` por `codigo` y no se pisan en re-ejecuciones.
3. **`recargosService.js`** (función pura, sin BD, para poder probarla con `node`): recibe agencia, flete, bultos, peso tasable, zona, opciones, `cp5` y devuelve `{ total, desglose[] }`. `calcularPrecioBultos` la usa si `agencia.motor === 'reglas'`. Para DSV: peso = `max(m³ × baremo, pesoBruto)` sin redondeos intermedios, tope 5.000 kg / 20 m³, zonas de Baleares como `multiple_zones`.
4. **UI**:
   - Base de datos → tabla editable de recargos de la agencia (valor, mínimo, activo, por defecto). El fuel destacado, porque cambia cada mes.
   - Calculadora: CP de 5 dígitos opcional, peso bruto opcional y casillas de opciones (responsabilidad, pre-aviso, ADR, día fijo, Priority, reserva manual). Si el CP tiene 2 dígitos, la tarjeta DSV avisa "área remota/metropolitana sin verificar".
   - Tarjeta de resultado con desglose (flete, opciones, suplementos).
5. **Pruebas**: `scripts/test-dsv.js` con los casos de abajo (`better-sqlite3` está compilado para Electron, por eso el motor debe ser puro).

## 6. Casos de prueba

Zonas y precios tomados del Excel. Peso bruto en kg; IVA no incluido.

| # | Caso | Flete | Opciones | Suplementos | Total | Origen |
|---|---|---|---|---|---|---|
| V1 | Tarragona→Málaga (zona 7), 1×(215×35×54), 100 kg, System, resp. Sí | 33,57 | 2,69 | 4,78 | **41,04** | **Excel (celdas cacheadas)** |
| V2 | V1 con System Priority y sin responsabilidad | 43,641 | 0 | 6,06 | 49,70 | Derivado de fórmulas |
| V3 | Llegadas, zona 3, 2×(60×40×40), 45 kg, resp. Sí | 21,60 | 1,73 | 3,25 | 26,58 | Derivado de fórmulas |
| V4 | Zona 2, 1×(120×80×100), 180 kg, CP 08001 (metropolitana), sin resp. | 33,27 | 0 | 13,06 | 46,33 | Derivado de fórmulas |

V1 coincide con el Excel al céntimo con mi transcripción de las fórmulas. V2–V4 son cálculos de esa misma transcripción, no valores recalculados por Excel: conviene contrastar uno con una cotización real de DSV.

## 7. Decisiones abiertas

1. ¿Solo **Salidas** (Elmer envía desde Tarragona) o también **Llegadas** (×1,20)?
2. ¿Se puede pasar a **CP de 5 dígitos** (opcional) en los formularios?
3. ¿Añadimos **peso bruto** opcional?
4. Valores correctos de las discrepancias 2 y 3 de la sección 3 (1 y 4 resueltas según la calculadora).
5. ¿Incremento de responsabilidad **marcado por defecto**, como en el Excel?
