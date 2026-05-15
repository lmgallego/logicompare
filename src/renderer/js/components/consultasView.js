import { formatPrice, formatDate, formatVolume } from '../utils/formatters.js'
import { pickClienteModal } from '../utils/modals.js'

let selectedCliente = null
let consultaRows = []

function redondear5(precio) {
  if (precio == null) return null
  return Math.ceil(precio * 20) / 20
}

export function initConsultasView() {
  document.getElementById('btn-consulta-cliente')?.addEventListener('click', async () => {
    const cliente = await pickClienteModal({
      required: true,
      title: 'Buscar cotizaciones de un cliente',
      subtitle: 'Escribe el código numérico o parte de la razón social.',
    })
    if (!cliente) return
    selectedCliente = cliente
    await loadConsulta()
  })

  document.getElementById('btn-consulta-refresh')?.addEventListener('click', loadConsulta)
}

async function loadConsulta() {
  if (!selectedCliente || !window.api) return

  const desde = document.getElementById('consulta-desde')?.value || null
  const hasta = document.getElementById('consulta-hasta')?.value || null
  const infoEl = document.getElementById('consulta-cliente-info')
  const statsEl = document.getElementById('consulta-stats')
  const tbodyEl = document.getElementById('consulta-table-body')
  const tableWrap = document.getElementById('consulta-table-wrap')
  const emptyEl = document.getElementById('consulta-empty')
  const filtersEl = document.getElementById('consulta-filters')

  // Show client info
  infoEl.innerHTML = `
    <span class="material-symbols-outlined text-primary" style="font-size:20px;">badge</span>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-bold truncate" style="color:#0040e0;">${selectedCliente.razon_social}</p>
      <p class="text-[11px] font-mono" style="opacity:0.55;">Código ${selectedCliente.codigo}</p>
    </div>
  `
  infoEl.classList.remove('hidden')
  filtersEl.classList.remove('hidden')

  // Load stats
  try {
    const st = await window.api.invoke('get-cliente-stats', { clienteCodigo: selectedCliente.codigo })
    statsEl.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div class="rounded-lg p-3" style="background:rgba(0,64,224,0.04);border:1px solid rgba(0,64,224,0.12);">
          <p class="text-[10px] uppercase font-bold tracking-wider" style="opacity:0.5;">Cotizaciones</p>
          <p class="text-xl font-black text-primary">${st.total}</p>
        </div>
        <div class="rounded-lg p-3" style="background:rgba(21,128,61,0.04);border:1px solid rgba(21,128,61,0.12);">
          <p class="text-[10px] uppercase font-bold tracking-wider" style="opacity:0.5;">Facturación</p>
          <p class="text-xl font-black" style="color:#15803d;">${formatPrice(st.facturacion)}</p>
        </div>
        <div class="rounded-lg p-3" style="background:rgba(196,197,217,0.08);border:1px solid rgba(196,197,217,0.2);">
          <p class="text-[10px] uppercase font-bold tracking-wider" style="opacity:0.5;">Precio medio</p>
          <p class="text-xl font-black">${formatPrice(st.precio_medio)}</p>
        </div>
        <div class="rounded-lg p-3" style="background:rgba(196,197,217,0.08);border:1px solid rgba(196,197,217,0.2);">
          <p class="text-[10px] uppercase font-bold tracking-wider" style="opacity:0.5;">Primera</p>
          <p class="text-sm font-bold">${st.primera ? formatDate(st.primera) : '—'}</p>
        </div>
        <div class="rounded-lg p-3" style="background:rgba(196,197,217,0.08);border:1px solid rgba(196,197,217,0.2);">
          <p class="text-[10px] uppercase font-bold tracking-wider" style="opacity:0.5;">Última</p>
          <p class="text-sm font-bold">${st.ultima ? formatDate(st.ultima) : '—'}</p>
        </div>
      </div>
      ${st.porAgencia && st.porAgencia.length > 0 ? `
        <div class="flex flex-wrap gap-2 mt-3">
          ${st.porAgencia.map(a => `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style="background:rgba(0,64,224,0.06);border:1px solid rgba(0,64,224,0.12);">
              ${a.nombre || 'Sin agencia'} <span class="font-black text-primary">${a.total}</span>
              <span style="opacity:0.5;">·</span> ${formatPrice(a.facturacion)}
            </span>
          `).join('')}
        </div>
      ` : ''}
    `
    statsEl.classList.remove('hidden')
  } catch (_) {
    statsEl.classList.add('hidden')
  }

  // Load quotes
  try {
    const rows = await window.api.invoke('get-quotes-by-cliente', {
      clienteCodigo: selectedCliente.codigo,
      desde, hasta,
    })
    consultaRows = rows || []

    if (consultaRows.length === 0) {
      tableWrap.classList.add('hidden')
      emptyEl.classList.remove('hidden')
      emptyEl.innerHTML = '<p class="text-sm text-on-surface-variant py-8 text-center" style="opacity:0.5;">No hay cotizaciones para este cliente en el rango seleccionado.</p>'
      return
    }

    emptyEl.classList.add('hidden')
    tableWrap.classList.remove('hidden')

    tbodyEl.innerHTML = consultaRows.map(r => {
      const red = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
      return `<tr class="hover:bg-surface-container-high/40 transition-colors">
        <td class="px-3 py-2 text-xs whitespace-nowrap">${formatDate(r.fecha)}</td>
        <td class="px-3 py-2 text-xs">${r.agencia_nombre || '—'}</td>
        <td class="px-3 py-2 text-xs font-mono">${r.largo_cm}×${r.ancho_cm}×${r.alto_cm}</td>
        <td class="px-3 py-2 text-xs text-center">${r.cp_prefix}</td>
        <td class="px-3 py-2 text-xs text-right">${(r.metros_cubicos ?? 0).toFixed(3)}</td>
        <td class="px-3 py-2 text-xs text-right font-semibold">${r.peso ?? 0} kg</td>
        <td class="px-3 py-2 text-xs text-right font-bold text-primary">${formatPrice(r.precio_final)}</td>
        <td class="px-3 py-2 text-xs text-right font-bold" style="color:#15803d;">${formatPrice(red)}</td>
        <td class="px-3 py-2 text-xs">${r.destinatario || ''}</td>
      </tr>`
    }).join('')
  } catch (err) {
    tableWrap.classList.add('hidden')
    emptyEl.classList.remove('hidden')
    emptyEl.innerHTML = `<p class="text-sm text-red-500 py-4 text-center">Error: ${err.message}</p>`
  }
}
