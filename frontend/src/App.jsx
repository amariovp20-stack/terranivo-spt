import { useEffect, useMemo, useState } from 'react'
import LayerForm from './components/LayerForm'
import StratigraphyChart from './components/StratigraphyChart'

const API_URL = 'http://127.0.0.1:8000'

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
  foundation_depth_m: 1.5,
  bearing_safety_factor: 3.0,
  energy_ratio_percent: 60,
  nu_sand: 0.30,
  nu_clay: 0.35,
  gamma_preset_sand: 19.0,
  gamma_preset_clay: 18.0,
}

const initialLayers = [
  layerTemplate(1, 0, 1.5, 'sand', 'SM', 8),
  layerTemplate(2, 1.5, 4.5, 'clay', 'CL', 12),
  layerTemplate(3, 4.5, 8.0, 'sand', 'SP', 22),
]

function normalizeLoadedProject(projectData) {
  return {
    config: {
      ...projectData.config,
      water_table: projectData.config.water_table ?? '',
    },
    layers: projectData.layers.map((layer, index) => ({
      ...layer,
      idx: index + 1,
    })),
  }
}

function formatProjectDate(value) {
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function App() {
  const [config, setConfig] = useState(initialConfig)
  const [layers, setLayers] = useState(initialLayers)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [activeProjectId, setActiveProjectId] = useState('')
  const [projects, setProjects] = useState([])
  const [error, setError] = useState('')

  const payload = useMemo(() => ({
    config: {
      ...config,
      water_table: config.water_table === '' ? null : Number(config.water_table),
      footing_width_m: Number(config.footing_width_m),
      foundation_depth_m: Number(config.foundation_depth_m),
      bearing_safety_factor: Number(config.bearing_safety_factor),
      energy_ratio_percent: Number(config.energy_ratio_percent),
      nu_sand: Number(config.nu_sand),
      nu_clay: Number(config.nu_clay),
      gamma_preset_sand: Number(config.gamma_preset_sand),
      gamma_preset_clay: Number(config.gamma_preset_clay),
    },
    layers,
  }), [config, layers])

  const previewLayers = result?.layers || layers.map((layer) => ({
    ...layer,
    classification: '-',
    n60: layer.n_raw,
    n60_star: layer.n_raw,
    n160_star: layer.n_raw,
  }))

  const fetchProjects = async (preferredProjectId = '') => {
    setProjectsLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/projects`)
      if (!res.ok) throw new Error('No se pudo cargar la lista de proyectos.')
      const data = await res.json()
      setProjects(data)
      if (preferredProjectId) {
        setActiveProjectId(preferredProjectId)
      } else if (!activeProjectId && data.length > 0) {
        setActiveProjectId(data[0].project_id)
      }
    } catch (err) {
      setError(err.message || 'Error al obtener los proyectos guardados.')
    } finally {
      setProjectsLoading(false)
    }
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  const updateLayer = (idx, key, value) => {
    setLayers((prev) => prev.map((layer) => {
      if (layer.idx !== idx) return layer
      if (key === 'family') {
        return { ...layer, family: value, soil: value === 'sand' ? 'SP' : 'CL' }
      }
      return { ...layer, [key]: value }
    }))
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

  const calculate = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('No se pudo calcular el reporte SPT.')
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err.message || 'Error de conexion con el backend.')
    } finally {
      setLoading(false)
    }
  }

  const saveProject = async () => {
    setSaveLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.project,
          data: payload,
        }),
      })
      if (!res.ok) throw new Error('No se pudo guardar el proyecto.')
      const data = await res.json()
      setActiveProjectId(data.project_id)
      await fetchProjects(data.project_id)
    } catch (err) {
      setError(err.message || 'Error al guardar el proyecto.')
    } finally {
      setSaveLoading(false)
    }
  }

  const loadProject = async (projectId) => {
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}`)
      if (!res.ok) throw new Error('No se pudo cargar el proyecto seleccionado.')
      const data = await res.json()
      const normalized = normalizeLoadedProject(data.data)
      setConfig(normalized.config)
      setLayers(normalized.layers)
      setResult(null)
      setActiveProjectId(data.project_id)
    } catch (err) {
      setError(err.message || 'Error al cargar el proyecto.')
    }
  }

  const downloadPdf = async () => {
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/report/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('No se pudo generar el PDF.')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reporte_${config.borehole || 'SPT'}.pdf`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || 'Error al descargar el PDF.')
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <div className="heroBrand">
          <img className="heroLogo" src="/terranivo-logo.jpeg" alt="Terranivo SPT" />
          <div>
            <h1>Terranivo SPT</h1>
          </div>
        </div>
        <div className="heroBadge">Analisis geotecnico preliminar</div>
      </section>

      <main className="stack formFlow">
        <section className="panel panelGeneral">
          <h2>Configuracion general</h2>
          <div className="grid2">
            <Field label="Proyecto"><input value={config.project} onChange={(e) => setConfig({ ...config, project: e.target.value })} /></Field>
            <Field label="Sondeo"><input value={config.borehole} onChange={(e) => setConfig({ ...config, borehole: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="Nivel freatico (m)"><input type="number" step="0.01" value={config.water_table} onChange={(e) => setConfig({ ...config, water_table: e.target.value })} /></Field>
            <Field label="Ancho B (m)"><input type="number" step="0.01" value={config.footing_width_m} onChange={(e) => setConfig({ ...config, footing_width_m: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="Prof. desplante Df (m)"><input type="number" step="0.01" value={config.foundation_depth_m} onChange={(e) => setConfig({ ...config, foundation_depth_m: e.target.value })} /></Field>
            <Field label="FS capacidad"><input type="number" step="0.1" value={config.bearing_safety_factor} onChange={(e) => setConfig({ ...config, bearing_safety_factor: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="ER (%)"><input type="number" step="0.1" value={config.energy_ratio_percent} onChange={(e) => setConfig({ ...config, energy_ratio_percent: e.target.value })} /></Field>
            <Field label="nu arena"><input type="number" step="0.01" value={config.nu_sand} onChange={(e) => setConfig({ ...config, nu_sand: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="nu arcilla"><input type="number" step="0.01" value={config.nu_clay} onChange={(e) => setConfig({ ...config, nu_clay: e.target.value })} /></Field>
            <Field label="gamma preset arena"><input type="number" step="0.1" value={config.gamma_preset_sand} onChange={(e) => setConfig({ ...config, gamma_preset_sand: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="gamma preset arcilla"><input type="number" step="0.1" value={config.gamma_preset_clay} onChange={(e) => setConfig({ ...config, gamma_preset_clay: e.target.value })} /></Field>
            <div />
          </div>
        </section>

        <section className="panel panelProjects">
          <div className="sectionHeader">
            <h2>Proyectos guardados</h2>
            <button className="secondary smallButton" onClick={() => fetchProjects(activeProjectId)} disabled={projectsLoading}>
              {projectsLoading ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>

          {projects.length > 0 ? (
            <div className="projectList">
              {projects.map((project) => (
                <button
                  key={project.project_id}
                  className={`projectItem ${activeProjectId === project.project_id ? 'active' : ''}`}
                  onClick={() => loadProject(project.project_id)}
                  type="button"
                >
                  <strong>{project.name}</strong>
                  <span>{project.borehole} · {project.layer_count} estratos</span>
                  <small>Actualizado: {formatProjectDate(project.updated_at)}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="emptyBox compactBox">Aun no hay proyectos guardados.</div>
          )}
        </section>

        <section className="panel panelLayers">
          <div className="sectionHeader">
            <h2>Configuracion de estratos</h2>
            <div className="sectionActions">
              <span>{layers.length} estratos</span>
              <button onClick={addLayer}>+ Anadir estrato</button>
            </div>
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
          <section className="panel panelChart">
            <h2>Grafico</h2>
            <StratigraphyChart layers={previewLayers} />
          </section>

          <section className="panel panelSummary">
            <h2>Resumen</h2>
            {result ? (
              <div className="metrics">
                <Metric label="Estratos" value={result.summary.layer_count} />
                <Metric label="Profundidad total" value={`${result.summary.total_depth_m.toFixed(2)} m`} />
                <Metric label="N60 promedio" value={result.summary.n60_avg.toFixed(1)} />
                <Metric label="(N1,60)* promedio" value={result.summary.n160_avg.toFixed(1)} />
                <Metric label="Es promedio" value={`${result.summary.es_avg_mpa.toFixed(1)} MPa`} />
                <Metric label="ks promedio" value={`${result.summary.ks_avg_mn_m3.toFixed(1)} MN/m3`} />
                <Metric label="qadm empirica" value={`${result.summary.qa_emp_avg_kpa.toFixed(1)} kPa`} />
                <Metric label="qadm semiemp." value={`${result.summary.qa_semi_avg_kpa.toFixed(1)} kPa`} />
              </div>
            ) : <div className="emptyBox">Ejecuta el calculo para ver el resumen.</div>}
          </section>
        </section>

        <section className="panel panelResults">
          <h2>Tabla de resultados</h2>
          {result ? <ResultsTable rows={result.layers} /> : <div className="emptyBox">Sin resultados aun.</div>}
        </section>

        <section className="panel panelReport">
          <h2>Borrador de reporte tecnico</h2>
          <pre className="reportBox">{result?.report_text || 'Sin reporte generado.'}</pre>
        </section>

        <section className="panel actionPanel">
          <h2>Acciones finales</h2>
          <p className="sectionLead">Despues de completar la configuracion general y los estratos, guarda el proyecto, calcula y exporta el informe.</p>
          <div className="buttonRow">
            <button onClick={saveProject} disabled={saveLoading}>{saveLoading ? 'Guardando...' : 'Guardar proyecto'}</button>
            <button className="secondary" onClick={calculate} disabled={loading}>{loading ? 'Calculando...' : 'Calcular'}</button>
            <button className="secondary" onClick={downloadPdf}>Exportar PDF</button>
          </div>
          {error && <div className="alert">{error}</div>}
        </section>
      </main>

      <footer className="siteFooter">
        <p>© 2026 Terranivo SPT. Todos los derechos reservados.</p>
        <p>Desarrollado por Abel Mario Vega Perez.</p>
      </footer>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function Metric({ label, value }) {
  return <div className="metric"><small>{label}</small><strong>{value}</strong></div>
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
            <th>gamma</th>
            <th>phi / Su</th>
            <th>Es</th>
            <th>M</th>
            <th>ks</th>
            <th>qadm emp</th>
            <th>qadm semi</th>
            <th>Clasificacion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.idx}>
              <td>{row.idx}</td>
              <td>{row.top.toFixed(2)}-{row.bottom.toFixed(2)}</td>
              <td>{row.soil}</td>
              <td>{row.n_raw.toFixed(1)}</td>
              <td>{row.n60.toFixed(1)}</td>
              <td>{row.n60_star.toFixed(1)}</td>
              <td>{row.n160_star.toFixed(1)}</td>
              <td>{row.gamma.toFixed(1)}</td>
              <td>{row.phi_deg ? `${row.phi_deg.toFixed(1)} deg` : `${row.su_kpa.toFixed(1)} kPa`}</td>
              <td>{row.es_mpa.toFixed(1)}</td>
              <td>{row.m_mpa.toFixed(1)}</td>
              <td>{row.ks_mn_m3.toFixed(1)}</td>
              <td>{row.qa_emp_kpa.toFixed(1)}</td>
              <td>{row.qa_semi_kpa.toFixed(1)}</td>
              <td>{row.classification}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
