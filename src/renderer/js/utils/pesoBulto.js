// Peso volumétrico por bulto (solo para mostrar). Gemelo de pesoBulto en src/main/services/bultosCotizacion.js:
// m³ del bulto (3 decimales, como el motor) × baremo, en kg enteros hacia arriba. Medidas no numéricas: null.
export function pesoBulto(b, baremo) {
  const m3 = Math.round(b.largoCm * b.anchoCm * b.altoCm * 1e-6 * 1000) / 1000
  const kg = Math.ceil(Math.round(m3 * baremo * 1e6) / 1e6)
  return Number.isFinite(kg) ? kg : null
}

// Baremo con el que el motor pesa un resultado de calcularTarifas: DSV (motor 'reglas') usa el de la zona si lo tiene
export const baremoDeResultado = r => (r.agencia.motor === 'reglas' ? (r.zona?.baremo ?? r.agencia.baremo) : r.agencia.baremo)

// "21 + 21 + 35 kg"; vacío con menos de 2 bultos o si falta algún peso
export function pesosTexto(pesos) {
  if (!Array.isArray(pesos) || pesos.length < 2 || pesos.some(p => p == null)) return ''
  return pesos.join(' + ') + ' kg'
}

// Lista "Bulto 1: 60×40×40 · 22 kg" + "Peso tasable total: X kg" (solo con 2 o más bultos)
export function detalleBultosHtml(bultos, pesos, pesoTotal, estilo = '') {
  if (!Array.isArray(bultos) || bultos.length < 2) return ''
  const lineas = bultos.map((b, i) =>
    `<li>Bulto ${i + 1}: ${b.largoCm}×${b.anchoCm}×${b.altoCm} · ${pesos?.[i] ?? '—'} kg</li>`).join('')
  return `<ul style="margin:4px 0 0;padding:0;list-style:none;font-size:11px;line-height:1.5;${estilo}">${lineas}`
    + `<li style="font-weight:700;">Peso tasable total: ${pesoTotal ?? '—'} kg</li></ul>`
}

// Historial y consultas: la etiqueta "N bultos" se despliega (details nativo) con la lista de bultos y pesos.
// La lista va en el flujo (la fila crece): flotante la recortaba el overflow-hidden de las tablas
export function etiquetaBultosHtml(row) {
  if (!(row.num_bultos > 1)) return ''
  let bultos = []
  try { bultos = JSON.parse(row.bultos_json).bultos } catch (_) {}
  const popover = 'position:relative;z-index:20;width:max-content;margin-top:4px;background:#fff;color:#171c1f;font-weight:400;white-space:nowrap;padding:8px 10px;border-radius:8px;box-shadow:0 4px 16px rgba(23,28,31,0.18);border:1px solid rgba(196,197,217,0.4);'
  return '<details style="display:inline-block;vertical-align:top;margin-left:4px;">'
    + '<summary class="text-[10px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap" style="display:inline-block;cursor:pointer;list-style:none;background:rgba(0,64,224,0.08);color:#0040e0;" title="Ver bultos y pesos">'
    + row.num_bultos + ' bultos</summary>'
    + detalleBultosHtml(bultos, row.pesos_bultos, row.peso, popover) + '</details>'
}
