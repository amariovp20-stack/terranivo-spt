import { useMemo, useState } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import LayerForm from './components/LayerForm'
import StratigraphyChart from './components/StratigraphyChart'
import { calculateSPT } from './utils/sptCalculations'

const STORAGE_KEY = 'terranivo_spt_projects'

const layerTemplate = (idx, top = 0, bottom = 1.5, family = 'sand', soil = 'SM', n_raw = 8) => ({
  idx,
  top,
  bottom,
  family,
  soil,
  n_raw,
  borehole_diameter_in: 4.5,
  sampler: 'standard',
  plasticity: 'low',
  gamma_manual: null,
  description: '',
  observations: '',
})

const initialConfig = {
  project: 'Proyecto SPT',
  borehole: 'BH-01',
  water_table: '',
  footing_width_m: 1.5,
  energy_ratio_percent: 60,
  nu_sand: 0.3,
  nu_clay: 0.35,
  gamma_preset_sand: 19.0,
  gamma_preset_clay: 18.0,
}

const initialLayers = [
  layerTemplate(1, 0, 1.5, 'sand', 'SM', 8),
  layerTemplate(2, 1.5, 4.5, 'clay', 'CL', 12),
  layerTemplate(3, 4.5, 8.0, 'sand', 'SP', 22),
]

const LOGO_PATH = '/terranivo-logo.jpeg'

export default function App() {
  const [config, setConfig] = useState(initialConfig)
  const [layers, setLayers] = useState(initialLayers)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [projects, setProjects] = useState(loadProjectsFromStorage())

  const payload = useMemo(
    () => ({
      config: {
        ...config,
        water_table: config.water_table === '' ? null : Number(config.water_table),
        footing_width_m: Number(config.footing_width_m),
        energy_ratio_percent: Number(config.energy_ratio_percent),
        nu_sand: Number(config.nu_sand),
        nu_clay: Number(config.nu_clay),
        gamma_preset_sand: Number(config.gamma_preset_sand),
        gamma_preset_clay: Number(config.gamma_preset_clay),
      },
      layers: layers.map((layer) => ({
        ...layer,
        top: Number(layer.top),
        bottom: Number(layer.bottom),
        n_raw: Number(layer.n_raw),
        borehole_diameter_in: Number(layer.borehole_diameter_in),
        gamma_manual:
          layer.gamma_manual === '' || layer.gamma_manual === null || layer.gamma_manual === undefined
            ? null
            : Number(layer.gamma_manual),
      })),
    }),
    [config, layers]
  )

  const updateLayer = (idx, key, value) => {
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.idx !== idx) return layer
        if (key === 'family') {
          return { ...layer, family: value, soil: value === 'sand' ? 'SP' : 'CL' }
        }
        return { ...layer, [key]: value }
      })
    )
  }

  const addLayer = () => {
    const last = layers[layers.length - 1]
    const top = last ? Number(last.bottom) : 0
    const bottom = top + 1.5
    setLayers((prev) => [...prev, layerTemplate(prev.length + 1, top, bottom)])
  }

  const deleteLayer = (idx) => {
    setLayers((prev) => prev.filter((x) => x.idx !== idx).map((x, i) => ({ ...x, idx: i + 1 })))
  }

  const calculate = () => {
    try {
      setError('')
      setSaveMessage('')
      const data = calculateSPT(payload)
      setResult(data)
    } catch (err) {
      setError(err.message || 'No se pudo calcular el reporte SPT.')
    }
  }

  const saveProject = () => {
    try {
      setError('')
      setSaveMessage('')
      const computed = result || calculateSPT(payload)

      const newProject = {
        id: Date.now(),
        project_name: payload.config.project,
        borehole: payload.config.borehole,
        created_at: new Date().toLocaleString(),
        payload,
        result: computed,
      }

      const updated = [newProject, ...projects]
      setProjects(updated)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      setResult(computed)
      setSaveMessage(`Proyecto guardado localmente con ID ${newProject.id}`)
    } catch (err) {
      setError(err.message || 'No se pudo guardar el proyecto.')
    }
  }

  const openProject = (projectId) => {
    try {
      setError('')
      setSaveMessage('')
      const selected = projects.find((p) => p.id === projectId)
      if (!selected) throw new Error('Proyecto no encontrado.')

      setConfig({
        ...selected.payload.config,
        water_table: selected.payload.config.water_table ?? '',
      })

      setLayers(
        selected.payload.layers.map((x, i) => ({
          ...x,
          idx: i + 1,
          gamma_manual: x.gamma_manual ?? null,
        }))
      )

      setResult(selected.result)
    } catch (err) {
      setError(err.message || 'No se pudo abrir el proyecto.')
    }
  }

  const deleteProject = (projectId) => {
    const ok = window.confirm('Deseas eliminar este proyecto local?')
    if (!ok) return

    const updated = projects.filter((p) => p.id !== projectId)
    setProjects(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  const newProject = () => {
    setConfig(initialConfig)
    setLayers(initialLayers)
    setResult(null)
    setError('')
    setSaveMessage('')
  }

  const downloadPdf = async () => {
    try {
      const computed = result || calculateSPT(payload)
      setResult(computed)

      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      })
      const logoDataUrl = await loadImageAsDataUrl(LOGO_PATH)
      const reportDate = new Date().toLocaleDateString()

      addPdfHeader(doc, logoDataUrl, payload, reportDate)

      autoTable(doc, {
        startY: 52,
        head: [['Parametro', 'Valor']],
        body: [
          ['Numero de estratos', String(computed.summary.layer_count)],
          ['Profundidad total', `${computed.summary.total_depth_m.toFixed(2)} m`],
          ['N60 promedio', computed.summary.n60_avg.toFixed(1)],
          ['(N1,60)* promedio', computed.summary.n160_avg.toFixed(1)],
          ['Es promedio', `${computed.summary.es_avg_mpa.toFixed(1)} MPa`],
          ['ks promedio', `${computed.summary.ks_avg_mn_m3.toFixed(1)} MN/m3`],
          [
            "phi' promedio",
            computed.summary.phi_avg_deg !== null
              ? `${computed.summary.phi_avg_deg.toFixed(1)} grados`
              : '-',
          ],
          [
            'Su promedio',
            computed.summary.su_avg_kpa !== null
              ? `${computed.summary.su_avg_kpa.toFixed(1)} kPa`
              : '-',
          ],
        ],
        theme: 'grid',
        styles: {
          fontSize: 10,
          cellPadding: 3,
          lineColor: [205, 214, 224],
          lineWidth: 0.2,
          textColor: [31, 41, 55],
          overflow: 'linebreak',
          valign: 'middle',
        },
        headStyles: {
          fillColor: [15, 75, 132],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        alternateRowStyles: {
          fillColor: [247, 250, 252],
        },
        columnStyles: {
          0: { cellWidth: 62, fontStyle: 'bold' },
          1: { cellWidth: 58 },
        },
        margin: { top: 40, right: 14, bottom: 16, left: 14 },
        didDrawPage: () => {
          addPdfHeader(doc, logoDataUrl, payload, reportDate)
          addPdfFooter(doc)
        },
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 10,
        head: [['#', 'Prof. (m)', 'Suelo', 'N campo', 'N60', 'N60*', '(N1,60)*', "phi'/Su", 'Es', 'ks', 'Clasificacion']],
        body: computed.layers.map((x) => [
          String(x.idx),
          `${x.top.toFixed(2)}-${x.bottom.toFixed(2)}`,
          x.soil,
          x.n_raw.toFixed(1),
          x.n60.toFixed(1),
          x.n60_star.toFixed(1),
          x.n160_star.toFixed(1),
          x.phi_deg !== null ? `${x.phi_deg.toFixed(1)} grados` : `${x.su_kpa.toFixed(1)} kPa`,
          `${x.es_mpa.toFixed(1)} MPa`,
          `${x.ks_mn_m3.toFixed(1)} MN/m3`,
          x.classification,
        ]),
        theme: 'grid',
        styles: {
          fontSize: 8.4,
          cellPadding: 2.2,
          lineColor: [210, 217, 226],
          lineWidth: 0.2,
          textColor: [31, 41, 55],
          overflow: 'linebreak',
          halign: 'center',
          valign: 'middle',
        },
        headStyles: {
          fillColor: [29, 111, 87],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
        },
        bodyStyles: {
          minCellHeight: 8,
        },
        alternateRowStyles: {
          fillColor: [248, 251, 249],
        },
        columnStyles: {
          0: { cellWidth: 10 },
          1: { cellWidth: 24 },
          2: { cellWidth: 16 },
          3: { cellWidth: 18 },
          4: { cellWidth: 16 },
          5: { cellWidth: 18 },
          6: { cellWidth: 20 },
          7: { cellWidth: 32, halign: 'left' },
          8: { cellWidth: 18 },
          9: { cellWidth: 20 },
          10: { cellWidth: 34, halign: 'left' },
        },
        margin: { top: 40, right: 14, bottom: 16, left: 14 },
        didDrawPage: () => {
          addPdfHeader(doc, logoDataUrl, payload, reportDate)
          addPdfFooter(doc)
        },
      })

      const reportLines = doc.splitTextToSize(computed.report_text, 260)
      let y = doc.lastAutoTable.finalY + 12
      const pageHeight = doc.internal.pageSize.getHeight()
      const bottomLimit = pageHeight - 22

      doc.setFontSize(15)
      if (y > bottomLimit - 20) {
        doc.addPage()
        addPdfHeader(doc, logoDataUrl, payload, reportDate)
        addPdfFooter(doc)
        y = 52
      }
      doc.setTextColor(15, 63, 118)
      doc.text('Reporte tecnico', 14, y)
      y += 8

      doc.setFontSize(10)
      doc.setTextColor(33, 37, 41)

      reportLines.forEach((line) => {
        if (y > bottomLimit) {
          doc.addPage()
          addPdfHeader(doc, logoDataUrl, payload, reportDate)
          addPdfFooter(doc)
          y = 52
        }
        doc.text(line, 14, y)
        y += 5.4
      })

      if (y > bottomLimit - 8) {
        doc.addPage()
        addPdfHeader(doc, logoDataUrl, payload, reportDate)
        addPdfFooter(doc)
        y = pageHeight - 12
      } else {
        y += 4
      }

      doc.setFontSize(10)
      doc.setTextColor(79, 91, 105)
      doc.text('Marca registrada: Geoservi Lab', 14, Math.min(y, pageHeight - 12))

      const pageCount = doc.getNumberOfPages()
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page)
        addPdfFooter(doc, page, pageCount)
      }

      doc.save(`TerranivoSPT_${payload.config.borehole || 'Reporte'}.pdf`)
    } catch (err) {
      setError(err.message || 'No se pudo generar el PDF.')
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <div className="heroBrand">
          <div className="heroLogoFrame">
            <img className="heroLogo" src={LOGO_PATH} alt="Logo de Terranivo SPT" />
          </div>
          <div>
            <h1>Terranivo SPT</h1>
            <p>
              Software geotecnico para cargar informacion general, colocar perfiles,
              revisar graficos y resultados, y generar el reporte tecnico.
            </p>
          </div>
        </div>
      </section>

      <section className="topStageGrid">
        <section className="panel panelGeneral topStagePanel">
          <div className="stageTag">Etapa 1</div>
          <h2>Cargado de informacion general</h2>
          <p className="sectionLead">Ingresa los datos base del proyecto y los parametros de trabajo.</p>

          <div className="grid2">
            <Field label="Proyecto">
              <input
                value={config.project}
                onChange={(e) => setConfig({ ...config, project: e.target.value })}
              />
            </Field>

            <Field label="Sondeo">
              <input
                value={config.borehole}
                onChange={(e) => setConfig({ ...config, borehole: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid2">
            <Field label="Nivel freatico (m)">
              <input
                type="number"
                step="0.01"
                value={config.water_table}
                onChange={(e) => setConfig({ ...config, water_table: e.target.value })}
              />
            </Field>

            <Field label="Ancho B (m)">
              <input
                type="number"
                step="0.01"
                value={config.footing_width_m}
                onChange={(e) => setConfig({ ...config, footing_width_m: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid2">
            <Field label="ER (%)">
              <input
                type="number"
                step="0.1"
                value={config.energy_ratio_percent}
                onChange={(e) => setConfig({ ...config, energy_ratio_percent: e.target.value })}
              />
            </Field>

            <Field label="Nu arena">
              <input
                type="number"
                step="0.01"
                value={config.nu_sand}
                onChange={(e) => setConfig({ ...config, nu_sand: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid2">
            <Field label="Nu arcilla">
              <input
                type="number"
                step="0.01"
                value={config.nu_clay}
                onChange={(e) => setConfig({ ...config, nu_clay: e.target.value })}
              />
            </Field>

            <Field label="Gamma preset arena">
              <input
                type="number"
                step="0.1"
                value={config.gamma_preset_sand}
                onChange={(e) => setConfig({ ...config, gamma_preset_sand: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid2">
            <Field label="Gamma preset arcilla">
              <input
                type="number"
                step="0.1"
                value={config.gamma_preset_clay}
                onChange={(e) => setConfig({ ...config, gamma_preset_clay: e.target.value })}
              />
            </Field>
            <div />
          </div>
        </section>

        <section className="panel panelProjects topStagePanel">
          <div className="stageTag">Biblioteca</div>
          <h2>Proyectos guardados</h2>

          {projects.length === 0 ? (
            <div className="emptyBox">No hay proyectos guardados en este navegador.</div>
          ) : (
            <div className="stack" style={{ gap: '10px' }}>
              {projects.map((p) => (
                <div key={p.id} className="metric" style={{ alignItems: 'flex-start' }}>
                  <small>ID {p.id}</small>
                  <strong>{p.project_name}</strong>
                  <small>{p.borehole}</small>
                  <small>{p.created_at}</small>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="secondary" onClick={() => openProject(p.id)}>
                      Abrir
                    </button>
                    <button className="secondary" onClick={() => deleteProject(p.id)}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      {error && <div className="alert">{error}</div>}
      {saveMessage && (
        <div className="alert" style={{ background: '#ecfdf5', color: '#166534' }}>
          {saveMessage}
        </div>
      )}

      <div className="layout">
        <aside className="stack stickyPanel" />

        <main className="stack">
          <section className="panel panelLayers">
            <div className="stageTag">Etapa 2</div>
            <div className="sectionHeader">
              <div>
                <h2>Colocacion de perfiles con su informacion</h2>
                <p className="sectionLead">
                  Completa cada estrato del perfil SPT con sus datos geotecnicos y observaciones.
                </p>
              </div>
              <span>{layers.length} estratos</span>
            </div>

            {layers.map((layer) => (
              <LayerForm
                key={layer.idx}
                layer={layer}
                onChange={(key, value) => updateLayer(layer.idx, key, value)}
                onDelete={() => deleteLayer(layer.idx)}
              />
            ))}

            <div className="sectionActions">
              <button onClick={addLayer}>+ Anadir estrato</button>
            </div>
          </section>

          <section className="twoCols">
            <section className="panel panelChart">
              <div className="stageTag">Etapa 3</div>
              <h2>Graficos</h2>
              <p className="sectionLead">Visualiza el perfil estratigrafico y la evolucion de los golpes.</p>
              <StratigraphyChart
                layers={
                  result?.layers ||
                  layers.map((x) => ({
                    ...x,
                    classification: '-',
                    n60: Number(x.n_raw),
                  }))
                }
              />
            </section>

            <section className="panel panelSummary">
              <div className="stageTag">Etapa 3</div>
              <h2>Resultados</h2>
              {result ? (
                <div className="metrics">
                  <Metric label="Estratos" value={result.summary.layer_count} />
                  <Metric
                    label="Profundidad total"
                    value={`${result.summary.total_depth_m.toFixed(2)} m`}
                  />
                  <Metric label="N60 promedio" value={result.summary.n60_avg.toFixed(1)} />
                  <Metric
                    label="(N1,60)* promedio"
                    value={result.summary.n160_avg.toFixed(1)}
                  />
                  <Metric
                    label="Es promedio"
                    value={`${result.summary.es_avg_mpa.toFixed(1)} MPa`}
                  />
                  <Metric
                    label="ks promedio"
                    value={`${result.summary.ks_avg_mn_m3.toFixed(1)} MN/m3`}
                  />
                </div>
              ) : (
                <div className="emptyBox">Ejecuta el calculo al final para ver el resumen.</div>
              )}
            </section>
          </section>

          <section className="panel panelResults">
            <div className="stageTag">Etapa 3</div>
            <h2>Tabla de resultados</h2>
            {result ? <ResultsTable rows={result.layers} /> : <div className="emptyBox">Sin resultados aun.</div>}
          </section>

          <section className="panel panelReport">
            <div className="stageTag">Etapa 4</div>
            <h2>Reporte tecnico</h2>
            <pre className="reportBox">{result?.report_text || 'Sin reporte generado.'}</pre>
            <small className="reportSignature">Marca registrada: Geoservi Lab</small>
          </section>

          <section className="panel actionPanel">
            <div className="stageTag">Cierre</div>
            <h2>Acciones finales</h2>
            <p className="sectionLead">
              Al finalizar las etapas, usa estos botones para calcular, exportar, guardar o iniciar un proyecto nuevo.
            </p>
            <div className="buttonRow">
              <button onClick={calculate}>Calcular</button>
              <button className="secondary" onClick={downloadPdf}>
                Exportar PDF
              </button>
              <button className="secondary" onClick={saveProject}>
                Guardado local
              </button>
              <button className="secondary" onClick={newProject}>
                Nuevo proyecto
              </button>
            </div>
          </section>

          <section className="panel">
            <small>
              © 2026 Terranivo SPT. Marca registrada: Geoservi Lab. Guardado local por navegador.
            </small>
          </section>
        </main>
      </div>
    </div>
  )
}

function loadProjectsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  )
}

function ResultsTable({ rows }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Prof. (m)</th>
            <th>Suelo</th>
            <th>N</th>
            <th>N60</th>
            <th>N*60</th>
            <th>(N1,60)*</th>
            <th>Gamma</th>
            <th>Phi / Su</th>
            <th>Es</th>
            <th>M</th>
            <th>ks</th>
            <th>Clasificacion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.idx}>
              <td>{row.idx}</td>
              <td>
                {row.top.toFixed(2)}-{row.bottom.toFixed(2)}
              </td>
              <td>{row.soil}</td>
              <td>{row.n_raw.toFixed(1)}</td>
              <td>{row.n60.toFixed(1)}</td>
              <td>{row.n60_star.toFixed(1)}</td>
              <td>{row.n160_star.toFixed(1)}</td>
              <td>{row.gamma.toFixed(1)}</td>
              <td>
                {row.phi_deg !== null ? `${row.phi_deg.toFixed(1)} grados` : `${row.su_kpa.toFixed(1)} kPa`}
              </td>
              <td>{row.es_mpa.toFixed(1)}</td>
              <td>{row.m_mpa.toFixed(1)}</td>
              <td>{row.ks_mn_m3.toFixed(1)}</td>
              <td>{row.classification}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function addWatermark(doc) {
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()

  doc.saveGraphicsState()
  doc.setTextColor(225, 230, 236)
  doc.setFontSize(42)
  doc.text('GEOSERVI LAB', width / 2, height / 2, {
    align: 'center',
    angle: 35,
  })
  doc.restoreGraphicsState()
}

function addPdfHeader(doc, logoDataUrl, payload, reportDate) {
  addWatermark(doc)
  doc.addImage(logoDataUrl, 'JPEG', 14, 10, 56, 18)
  doc.setFontSize(16)
  doc.setTextColor(15, 63, 118)
  doc.text('Informe tecnico SPT', 76, 18)
  doc.setFontSize(10)
  doc.setTextColor(55, 65, 81)
  doc.text(`Proyecto: ${payload.config.project}`, 76, 26)
  doc.text(`Sondeo: ${payload.config.borehole}`, 76, 32)
  doc.text(`Fecha: ${reportDate}`, 220, 18, { align: 'right' })
  doc.setDrawColor(210, 217, 226)
  doc.line(14, 38, doc.internal.pageSize.getWidth() - 14, 38)
}

function addPdfFooter(doc, pageNumber, pageCount) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  doc.setDrawColor(220, 226, 232)
  doc.line(14, pageHeight - 16, pageWidth - 14, pageHeight - 16)
  doc.setFontSize(9)
  doc.setTextColor(107, 114, 128)
  doc.text('Marca registrada: Geoservi Lab', 14, pageHeight - 10)
  if (pageNumber && pageCount) {
    doc.text(`Pagina ${pageNumber} de ${pageCount}`, pageWidth - 14, pageHeight - 10, {
      align: 'right',
    })
  }
}

function loadImageAsDataUrl(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('No se pudo preparar el logo para el PDF.'))
        return
      }

      ctx.drawImage(image, 0, 0)
      resolve(canvas.toDataURL('image/jpeg'))
    }
    image.onerror = () => reject(new Error('No se pudo cargar el logo para el PDF.'))
    image.src = src
  })
}
