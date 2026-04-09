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

export default function App() {
  const [config, setConfig] = useState({
    project: 'Proyecto SPT',
    borehole: 'BH-01',
    water_table: '',
    footing_width_m: 1.5,
    energy_ratio_percent: 60,
    nu_sand: 0.3,
    nu_clay: 0.35,
    gamma_preset_sand: 19.0,
    gamma_preset_clay: 18.0,
  })

  const [layers, setLayers] = useState([
    layerTemplate(1, 0, 1.5, 'sand', 'SM', 8),
    layerTemplate(2, 1.5, 4.5, 'clay', 'CL', 12),
    layerTemplate(3, 4.5, 8.0, 'sand', 'SP', 22),
  ])

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
    setLayers((prev) =>
      prev.filter((x) => x.idx !== idx).map((x, i) => ({ ...x, idx: i + 1 }))
    )
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
    const ok = window.confirm('¿Deseas eliminar este proyecto local?')
    if (!ok) return

    const updated = projects.filter((p) => p.id !== projectId)
    setProjects(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  const newProject = () => {
    setConfig({
      project: 'Proyecto SPT',
      borehole: 'BH-01',
      water_table: '',
      footing_width_m: 1.5,
      energy_ratio_percent: 60,
      nu_sand: 0.3,
      nu_clay: 0.35,
      gamma_preset_sand: 19.0,
      gamma_preset_clay: 18.0,
    })

    setLayers([
      layerTemplate(1, 0, 1.5, 'sand', 'SM', 8),
      layerTemplate(2, 1.5, 4.5, 'clay', 'CL', 12),
      layerTemplate(3, 4.5, 8.0, 'sand', 'SP', 22),
    ])

    setResult(null)
    setError('')
    setSaveMessage('')
  }

  const downloadPdf = () => {
    try {
      const computed = result || calculateSPT(payload)
      setResult(computed)

      const doc = new jsPDF()
      doc.setFontSize(18)
      doc.text('Terranivo SPT™', 14, 18)

      doc.setFontSize(11)
      doc.text(`Proyecto: ${payload.config.project}`, 14, 28)
      doc.text(`Sondeo: ${payload.config.borehole}`, 14, 34)
      doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 40)

      autoTable(doc, {
        startY: 48,
        head: [['Parámetro', 'Valor']],
        body: [
          ['Número de estratos', String(computed.summary.layer_count)],
          ['Profundidad total', `${computed.summary.total_depth_m.toFixed(2)} m`],
          ['N60 promedio', computed.summary.n60_avg.toFixed(1)],
          ['(N1,60)* promedio', computed.summary.n160_avg.toFixed(1)],
          ['Es promedio', `${computed.summary.es_avg_mpa.toFixed(1)} MPa`],
          ['ks promedio', `${computed.summary.ks_avg_mn_m3.toFixed(1)} MN/m³`],
          [
            "φ' promedio",
            computed.summary.phi_avg_deg !== null
              ? `${computed.summary.phi_avg_deg.toFixed(1)}°`
              : '-',
          ],
          [
            'Su promedio',
            computed.summary.su_avg_kpa !== null
              ? `${computed.summary.su_avg_kpa.toFixed(1)} kPa`
              : '-',
          ],
        ],
      })

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 10,
        head: [['#', 'Prof. (m)', 'Suelo', 'N60', '(N1,60)*', "φ'/Su", 'Es', 'ks']],
        body: computed.layers.map((x) => [
          String(x.idx),
          `${x.top.toFixed(2)}-${x.bottom.toFixed(2)}`,
          x.soil,
          x.n60.toFixed(1),
          x.n160_star.toFixed(1),
          x.phi_deg !== null ? `${x.phi_deg.toFixed(1)}°` : `${x.su_kpa.toFixed(1)} kPa`,
          x.es_mpa.toFixed(1),
          x.ks_mn_m3.toFixed(1),
        ]),
      })

      let y = doc.lastAutoTable.finalY + 10
      const lines = doc.splitTextToSize(computed.report_text, 180)
      if (y > 240) {
        doc.addPage()
        y = 20
      }
      doc.setFontSize(10)
      doc.text(lines, 14, y)

      doc.save(`TerranivoSPT_${payload.config.borehole || 'Reporte'}.pdf`)
    } catch (err) {
      setError(err.message || 'No se pudo generar el PDF.')
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>Terranivo SPT™</h1>
          <p>Software geotécnico web autónomo: cálculo, guardado local y PDF sin backend.</p>
        </div>
        <div className="heroBadge">Modo Web Autónomo</div>
      </section>

      <div className="layout">
        <aside className="panel stickyPanel">
          <h2>Configuración general</h2>

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
            <Field label="Nivel freático (m)">
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

            <Field label="ν arena">
              <input
                type="number"
                step="0.01"
                value={config.nu_sand}
                onChange={(e) => setConfig({ ...config, nu_sand: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid2">
            <Field label="ν arcilla">
              <input
                type="number"
                step="0.01"
                value={config.nu_clay}
                onChange={(e) => setConfig({ ...config, nu_clay: e.target.value })}
              />
            </Field>

            <Field label="γ preset arena">
              <input
                type="number"
                step="0.1"
                value={config.gamma_preset_sand}
                onChange={(e) => setConfig({ ...config, gamma_preset_sand: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid2">
            <Field label="γ preset arcilla">
              <input
                type="number"
                step="0.1"
                value={config.gamma_preset_clay}
                onChange={(e) => setConfig({ ...config, gamma_preset_clay: e.target.value })}
              />
            </Field>
            <div />
          </div>

          <div className="buttonRow">
            <button onClick={addLayer}>+ Añadir estrato</button>
            <button className="secondary" onClick={calculate}>
              Calcular
            </button>
            <button className="secondary" onClick={saveProject}>
              Guardar local
            </button>
            <button className="secondary" onClick={downloadPdf}>
              Exportar PDF
            </button>
            <button className="secondary" onClick={newProject}>
              Nuevo proyecto
            </button>
          </div>

          {error && <div className="alert">{error}</div>}
          {saveMessage && (
            <div className="alert" style={{ background: '#ecfdf5', color: '#166534' }}>
              {saveMessage}
            </div>
          )}

          <hr style={{ margin: '16px 0' }} />
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
        </aside>

        <main className="stack">
          <section className="panel">
            <div className="sectionHeader">
              <h2>Perfil SPT</h2>
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
          </section>

          <section className="twoCols">
            <section className="panel">
              <h2>Gráfico</h2>
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

            <section className="panel">
              <h2>Resumen</h2>
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
                    value={`${result.summary.ks_avg_mn_m3.toFixed(1)} MN/m³`}
                  />
                </div>
              ) : (
                <div className="emptyBox">Ejecuta el cálculo para ver el resumen.</div>
              )}
            </section>
          </section>

          <section className="panel">
            <h2>Tabla de resultados</h2>
            {result ? <ResultsTable rows={result.layers} /> : <div className="emptyBox">Sin resultados aún.</div>}
          </section>

          <section className="panel">
            <h2>Borrador de reporte técnico</h2>
            <pre className="reportBox">{result?.report_text || 'Sin reporte generado.'}</pre>
          </section>

          <section className="panel">
            <small>© 2026 Terranivo SPT™. Guardado local por navegador.</small>
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
            <th>γ</th>
            <th>φ' / Su</th>
            <th>Es</th>
            <th>M</th>
            <th>ks</th>
            <th>Clasificación</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.idx}>
              <td>{row.idx}</td>
              <td>
                {row.top.toFixed(2)}–{row.bottom.toFixed(2)}
              </td>
              <td>{row.soil}</td>
              <td>{row.n_raw.toFixed(1)}</td>
              <td>{row.n60.toFixed(1)}</td>
              <td>{row.n60_star.toFixed(1)}</td>
              <td>{row.n160_star.toFixed(1)}</td>
              <td>{row.gamma.toFixed(1)}</td>
              <td>{row.phi_deg !== null ? `${row.phi_deg.toFixed(1)}°` : `${row.su_kpa.toFixed(1)} kPa`}</td>
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