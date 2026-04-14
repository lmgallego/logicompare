import { formatPrice } from '../utils/formatters.js'
import Chart from 'chart.js/auto'

let charts = {}
let lastAnalyticsData = null

function destroyCharts() {
  Object.values(charts).forEach(c => { try { c.destroy() } catch (_) {} })
  charts = {}
}

function pct(a, b) {
  if (!b) return 0
  return Math.round(((a - b) / b) * 100)
}

function trendArrow(val) {
  if (val > 0) return `<span style="color:#15803d;">▲ ${val}%</span>`
  if (val < 0) return `<span style="color:#ba1a1a;">▼ ${Math.abs(val)}%</span>`
  return `<span style="opacity:0.4;">— 0%</span>`
}

const PALETTE = [
  '#0040e0','#e03000','#00a67e','#f59e0b','#8b5cf6',
  '#06b6d4','#ec4899','#84cc16','#f97316','#6366f1'
]

export async function loadAnalytics() {
  if (!window.api) return
  destroyCharts()

  const el = document.getElementById('page-analytics')
  if (!el) return

  el.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-6 pb-10">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold tracking-tight">Analíticas</h2>
          <p class="text-xs text-on-surface-variant mt-0.5" style="opacity:0.55;">Resumen de actividad y rendimiento por agencia</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-analytics-pdf" class="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5">
            <span class="material-symbols-outlined" style="font-size:15px;">picture_as_pdf</span> PDF
          </button>
          <button id="btn-analytics-xlsx" class="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5">
            <span class="material-symbols-outlined" style="font-size:15px;">table_view</span> Excel
          </button>
          <button id="btn-analytics-refresh" class="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5">
            <span class="material-symbols-outlined" style="font-size:15px;">refresh</span> Actualizar
          </button>
        </div>
      </div>
      <div id="analytics-body">
        <div class="flex items-center justify-center py-24 text-on-surface-variant text-sm" style="opacity:0.4;">
          <span class="material-symbols-outlined animate-spin mr-2" style="font-size:20px;">progress_activity</span> Cargando...
        </div>
      </div>
    </div>
  `

  document.getElementById('btn-analytics-refresh')?.addEventListener('click', loadAnalytics)

  document.getElementById('btn-analytics-pdf')?.addEventListener('click', () => {
    window.print()
  })

  document.getElementById('btn-analytics-xlsx')?.addEventListener('click', async () => {
    if (!lastAnalyticsData || !window.api) return
    const btn = document.getElementById('btn-analytics-xlsx')
    btn.disabled = true
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:15px;">progress_activity</span> Exportando...'
    try {
      const { porAgencia, porMes, porDia, topCps } = lastAnalyticsData
      const result = await window.api.invoke('export-analytics-xlsx', { porAgencia, porMes, porDia, topCps })
      if (!result.ok && result.error) alert('Error al exportar: ' + result.error)
    } finally {
      btn.disabled = false
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">table_view</span> Excel'
    }
  })

  let data
  try {
    data = await window.api.invoke('get-analytics')
  } catch (err) {
    document.getElementById('analytics-body').innerHTML =
      `<p class="text-red-500 text-sm">Error al cargar analíticas: ${err.message}</p>`
    return
  }

  lastAnalyticsData = data
  const { totals, porAgencia, porDia, porMes, topCps, pesoBuckets, precioMedioAgencia, comparativa, comparativaDia, ultimos14, anteriores14 } = data

  const diffN = pct(comparativa.mes_actual_n, comparativa.mes_anterior_n)
  const diffI = pct(comparativa.mes_actual_ingresos, comparativa.mes_anterior_ingresos)

  const topAgencia = porAgencia[0]
  const avgPrecio = totals.total > 0 ? (totals.ingresos / totals.total) : 0

  document.getElementById('analytics-body').innerHTML = `

    <!-- KPI cards row -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="card-surface rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Total Cotizaciones</p>
        <p class="text-3xl font-black text-primary tracking-tight">${totals.total.toLocaleString('es-ES')}</p>
        <p class="text-xs">${trendArrow(diffN)} vs mes anterior</p>
      </div>
      <div class="card-surface rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Facturación Total</p>
        <p class="text-3xl font-black tracking-tight" style="color:#15803d;">${formatPrice(totals.ingresos)}</p>
        <p class="text-xs">${trendArrow(diffI)} vs mes anterior</p>
      </div>
      <div class="card-surface rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Precio Medio</p>
        <p class="text-3xl font-black tracking-tight text-on-surface">${formatPrice(avgPrecio)}</p>
        <p class="text-xs text-on-surface-variant" style="opacity:0.5;">por cotización elegida</p>
      </div>
      <div class="card-surface rounded-2xl p-4 space-y-1">
        <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Agencia Top</p>
        <p class="text-xl font-black tracking-tight text-on-surface truncate">${topAgencia?.nombre ?? '—'}</p>
        <p class="text-xs text-on-surface-variant" style="opacity:0.5;">${topAgencia?.total ?? 0} envíos · ${formatPrice(topAgencia?.ingresos ?? 0)}</p>
      </div>
    </div>

    <!-- Este mes vs anterior + Hoy vs Ayer -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="card-surface rounded-2xl p-4 flex items-center gap-4">
        <span class="material-symbols-outlined text-3xl text-primary" style="opacity:0.7;">calendar_month</span>
        <div>
          <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Este Mes</p>
          <p class="text-xl font-black">${(comparativa.mes_actual_n || 0).toLocaleString('es-ES')} cotizaciones</p>
          <p class="text-sm font-semibold" style="color:#15803d;">${formatPrice(comparativa.mes_actual_ingresos || 0)}</p>
        </div>
      </div>
      <div class="card-surface rounded-2xl p-4 flex items-center gap-4">
        <span class="material-symbols-outlined text-3xl text-on-surface-variant" style="opacity:0.4;">history</span>
        <div>
          <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Mes Anterior</p>
          <p class="text-xl font-black">${(comparativa.mes_anterior_n || 0).toLocaleString('es-ES')} cotizaciones</p>
          <p class="text-sm font-semibold text-on-surface-variant">${formatPrice(comparativa.mes_anterior_ingresos || 0)}</p>
        </div>
      </div>
      <div class="card-surface rounded-2xl p-4 flex items-center gap-4">
        <span class="material-symbols-outlined text-3xl" style="color:#f59e0b;opacity:0.85;">today</span>
        <div>
          <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Hoy</p>
          <p class="text-xl font-black">${(comparativaDia?.hoy_n || 0).toLocaleString('es-ES')} cotizaciones</p>
          <p class="text-sm font-semibold" style="color:#15803d;">${formatPrice(comparativaDia?.hoy_ingresos || 0)}</p>
          <p class="text-xs mt-0.5">${trendArrow(pct(comparativaDia?.hoy_n || 0, comparativaDia?.ayer_n || 0))} vs ayer</p>
        </div>
      </div>
      <div class="card-surface rounded-2xl p-4 flex items-center gap-4">
        <span class="material-symbols-outlined text-3xl text-on-surface-variant" style="opacity:0.35;">event</span>
        <div>
          <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style="opacity:0.5;">Ayer</p>
          <p class="text-xl font-black">${(comparativaDia?.ayer_n || 0).toLocaleString('es-ES')} cotizaciones</p>
          <p class="text-sm font-semibold text-on-surface-variant">${formatPrice(comparativaDia?.ayer_ingresos || 0)}</p>
        </div>
      </div>
    </div>

    <!-- Chart: comparativa día a día 14 días actuales vs 14 días anteriores -->
    <div class="card-surface rounded-2xl p-5">
      <div class="flex items-center justify-between mb-4">
        <p class="text-xs font-bold uppercase tracking-widest" style="opacity:0.5;">Comparativa Día a Día — Últimas 2 semanas vs 2 semanas anteriores</p>
        <div class="flex items-center gap-3 text-[10px] text-on-surface-variant">
          <span class="flex items-center gap-1"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#0040e0;"></span>Período actual</span>
          <span class="flex items-center gap-1"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(0,64,224,0.25);"></span>Período anterior</span>
        </div>
      </div>
      <div style="position:relative;height:220px;"><canvas id="chart-dia-comparativa"></canvas></div>
    </div>

    <!-- Charts row 1: actividad diaria + distribución por agencia -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="card-surface rounded-2xl p-5">
        <p class="text-xs font-bold uppercase tracking-widest mb-4" style="opacity:0.5;">Actividad — Últimos 30 días</p>
        <div style="position:relative;height:200px;"><canvas id="chart-daily"></canvas></div>
      </div>
      <div class="card-surface rounded-2xl p-5">
        <p class="text-xs font-bold uppercase tracking-widest mb-4" style="opacity:0.5;">Cotizaciones por Agencia</p>
        <div style="position:relative;height:200px;"><canvas id="chart-agencia-donut"></canvas></div>
      </div>
    </div>

    <!-- Charts row 2: mensual + distribución por peso -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="card-surface rounded-2xl p-5">
        <p class="text-xs font-bold uppercase tracking-widest mb-4" style="opacity:0.5;">Facturación Mensual — Últimos 12 meses</p>
        <div style="position:relative;height:200px;"><canvas id="chart-monthly"></canvas></div>
      </div>
      <div class="card-surface rounded-2xl p-5">
        <p class="text-xs font-bold uppercase tracking-widest mb-4" style="opacity:0.5;">Distribución por Peso</p>
        <div style="position:relative;height:200px;"><canvas id="chart-peso"></canvas></div>
      </div>
    </div>

    <!-- Charts row 3: precio medio por agencia + top CPs -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="card-surface rounded-2xl p-5">
        <p class="text-xs font-bold uppercase tracking-widest mb-4" style="opacity:0.5;">Precio Medio por Agencia</p>
        <div style="position:relative;height:220px;"><canvas id="chart-precio-medio"></canvas></div>
      </div>
      <div class="card-surface rounded-2xl p-5">
        <p class="text-xs font-bold uppercase tracking-widest mb-4" style="opacity:0.5;">Top Destinos (CP)</p>
        <div style="position:relative;height:220px;"><canvas id="chart-top-cp"></canvas></div>
      </div>
    </div>

    <!-- Table: ranking agencias -->
    <div class="card-surface rounded-2xl p-5">
      <p class="text-xs font-bold uppercase tracking-widest mb-4" style="opacity:0.5;">Ranking de Agencias</p>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-[10px] uppercase tracking-widest text-on-surface-variant border-b" style="border-color:rgba(196,197,217,0.2); opacity:0.6;">
            <th class="pb-2 font-bold">#</th>
            <th class="pb-2 font-bold">Agencia</th>
            <th class="pb-2 font-bold text-right">Envíos</th>
            <th class="pb-2 font-bold text-right">Facturación</th>
            <th class="pb-2 font-bold text-right">Precio medio</th>
          </tr>
        </thead>
        <tbody id="ranking-tbody"></tbody>
      </table>
    </div>
  `

  // Populate ranking table
  const tbody = document.getElementById('ranking-tbody')
  porAgencia.forEach((a, i) => {
    const tr = document.createElement('tr')
    tr.className = 'border-b'
    tr.style.borderColor = 'rgba(196,197,217,0.1)'
    tr.innerHTML = `
      <td class="py-2.5 text-xs text-on-surface-variant" style="opacity:0.4;">${i + 1}</td>
      <td class="py-2.5 font-semibold">${a.nombre ?? '—'}</td>
      <td class="py-2.5 text-right tabular-nums">${a.total.toLocaleString('es-ES')}</td>
      <td class="py-2.5 text-right tabular-nums font-semibold" style="color:#15803d;">${formatPrice(a.ingresos)}</td>
      <td class="py-2.5 text-right tabular-nums text-on-surface-variant">${formatPrice(a.precio_medio)}</td>
    `
    tbody.appendChild(tr)
  })

  // Wait a tick for DOM to be ready, then draw charts
  requestAnimationFrame(() => renderCharts({ porDia, porMes, porAgencia, pesoBuckets, precioMedioAgencia, topCps, ultimos14: ultimos14 || [], anteriores14: anteriores14 || [] }))
}

function renderCharts({ porDia, porMes, porAgencia, pesoBuckets, precioMedioAgencia, topCps, ultimos14, anteriores14 }) {

  const gridColor = 'rgba(196,197,217,0.12)'
  const tickColor = 'rgba(100,110,130,0.5)'
  const fontFamily = "'Helvetica Neue', Helvetica, Arial, sans-serif"

  const baseScales = {
    x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: fontFamily, size: 10 } } },
    y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: fontFamily, size: 10 } } },
  }

  // ── Comparativa día a día: últimas 2 semanas vs 2 semanas anteriores ────────
  if (document.getElementById('chart-dia-comparativa')) {
    // Build a fixed 14-slot label array (Día 1 … Día 14)
    const labels = Array.from({ length: 14 }, (_, i) => `Día ${i + 1}`)

    // Map DB rows to array of 14 values (fill missing days with 0)
    function buildSeries(rows) {
      const out = new Array(14).fill(0)
      rows.forEach((r, i) => { if (i < 14) out[i] = r.total })
      return out
    }

    charts.diaComparativa = new Chart(document.getElementById('chart-dia-comparativa'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Período anterior',
            data: buildSeries(anteriores14),
            backgroundColor: 'rgba(0,64,224,0.18)',
            borderColor: 'rgba(0,64,224,0.4)',
            borderWidth: 1,
            borderRadius: 3,
          },
          {
            label: 'Período actual',
            data: buildSeries(ultimos14),
            backgroundColor: 'rgba(0,64,224,0.75)',
            borderColor: '#0040e0',
            borderWidth: 0,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex
                const actual = ultimos14[idx]
                const anterior = anteriores14[idx]
                const labelActual = actual ? actual.dia.slice(5) : '—'
                const labelAnterior = anterior ? anterior.dia.slice(5) : '—'
                return `Actual: ${labelActual}  /  Anterior: ${labelAnterior}`
              },
            },
          },
        },
        scales: baseScales,
      },
    })
  }

  // ── Daily activity (line) ───────────────────────────────────────────────────
  if (porDia.length > 0) {
    charts.daily = new Chart(document.getElementById('chart-daily'), {
      type: 'bar',
      data: {
        labels: porDia.map(d => d.dia.slice(5)),
        datasets: [{
          label: 'Cotizaciones',
          data: porDia.map(d => d.total),
          backgroundColor: 'rgba(0,64,224,0.15)',
          borderColor: '#0040e0',
          borderWidth: 2,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: baseScales,
      },
    })
  }

  // ── Donut por agencia ───────────────────────────────────────────────────────
  if (porAgencia.length > 0) {
    charts.donut = new Chart(document.getElementById('chart-agencia-donut'), {
      type: 'doughnut',
      data: {
        labels: porAgencia.map(a => a.nombre ?? '—'),
        datasets: [{
          data: porAgencia.map(a => a.total),
          backgroundColor: PALETTE,
          borderWidth: 2,
          borderColor: 'rgba(255,255,255,0.8)',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { family: fontFamily, size: 10 }, color: tickColor, boxWidth: 10, padding: 8 },
          },
        },
      },
    })
  }

  // ── Monthly revenue (line) ──────────────────────────────────────────────────
  if (porMes.length > 0) {
    charts.monthly = new Chart(document.getElementById('chart-monthly'), {
      type: 'line',
      data: {
        labels: porMes.map(m => m.mes),
        datasets: [{
          label: 'Facturación €',
          data: porMes.map(m => Math.round(m.ingresos * 100) / 100),
          borderColor: '#15803d',
          backgroundColor: 'rgba(21,128,61,0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#15803d',
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          ...baseScales,
          y: { ...baseScales.y, ticks: { ...baseScales.y.ticks, callback: v => `${v}€` } },
        },
      },
    })
  }

  // ── Weight distribution (polar/bar) ────────────────────────────────────────
  if (pesoBuckets.length > 0) {
    charts.peso = new Chart(document.getElementById('chart-peso'), {
      type: 'bar',
      data: {
        labels: pesoBuckets.map(p => p.rango),
        datasets: [{
          label: 'Envíos',
          data: pesoBuckets.map(p => p.total),
          backgroundColor: PALETTE.slice(0, pesoBuckets.length),
          borderRadius: 6,
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: baseScales,
      },
    })
  }

  // ── Precio medio por agencia (horizontal bar) ───────────────────────────────
  if (precioMedioAgencia.length > 0) {
    charts.precioMedio = new Chart(document.getElementById('chart-precio-medio'), {
      type: 'bar',
      data: {
        labels: precioMedioAgencia.map(a => a.nombre ?? '—'),
        datasets: [{
          label: 'Precio medio €',
          data: precioMedioAgencia.map(a => Math.round(a.precio_medio * 100) / 100),
          backgroundColor: PALETTE,
          borderRadius: 4,
          borderWidth: 0,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ...baseScales.x, ticks: { ...baseScales.x.ticks, callback: v => `${v}€` } },
          y: baseScales.y,
        },
      },
    })
  }

  // ── Top CPs (horizontal bar) ────────────────────────────────────────────────
  if (topCps.length > 0) {
    charts.topCp = new Chart(document.getElementById('chart-top-cp'), {
      type: 'bar',
      data: {
        labels: topCps.map(c => `CP ${c.cp_prefix}`),
        datasets: [{
          label: 'Envíos',
          data: topCps.map(c => c.total),
          backgroundColor: 'rgba(0,64,224,0.18)',
          borderColor: '#0040e0',
          borderWidth: 2,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: baseScales,
      },
    })
  }
}
