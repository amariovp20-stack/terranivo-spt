const SOIL_OPTIONS = {
  sand: [
    ['SP', 'SP - Arena mal gradada'],
    ['SW', 'SW - Arena bien gradada'],
    ['SM', 'SM - Arena limosa'],
    ['SC', 'SC - Arena arcillosa'],
    ['GP', 'GP - Grava mal gradada'],
    ['GW', 'GW - Grava bien gradada'],
    ['GM', 'GM - Grava limosa'],
    ['GC', 'GC - Grava arcillosa'],
    ['ML', 'ML - Limo de baja plasticidad'],
  ],
  clay: [
    ['CL', 'CL - Arcilla de baja plasticidad'],
    ['CH', 'CH - Arcilla de alta plasticidad'],
    ['ML', 'ML - Limo de baja plasticidad'],
    ['MH', 'MH - Limo de alta plasticidad'],
    ['OL', 'OL - Orgánico baja plasticidad'],
    ['OH', 'OH - Orgánico alta plasticidad'],
  ],
}

export default function LayerForm({ layer, onChange, onDelete }) {
  const options = SOIL_OPTIONS[layer.family]

  return (
    <div className="layerCard">
      <div className="layerHead">
        <strong>Estrato {layer.idx}</strong>
        <button className="dangerGhost" onClick={onDelete}>Eliminar</button>
      </div>

      <div className="grid4">
        <Field label="Desde (m)"><input type="number" step="0.01" value={layer.top} onChange={(e) => onChange('top', Number(e.target.value))} /></Field>
        <Field label="Hasta (m)"><input type="number" step="0.01" value={layer.bottom} onChange={(e) => onChange('bottom', Number(e.target.value))} /></Field>
        <Field label="Tipo general">
          <select value={layer.family} onChange={(e) => onChange('family', e.target.value)}>
            <option value="sand">Granular / friccional</option>
            <option value="clay">Cohesivo</option>
          </select>
        </Field>
        <Field label="USCS / material">
          <select value={layer.soil} onChange={(e) => onChange('soil', e.target.value)}>
            {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid4">
        <Field label="N campo (30 cm finales)"><input type="number" step="0.1" value={layer.n_raw} onChange={(e) => onChange('n_raw', Number(e.target.value))} /></Field>
        <Field label="Diámetro perforación (in)">
          <select value={layer.borehole_diameter_in} onChange={(e) => onChange('borehole_diameter_in', Number(e.target.value))}>
            <option value={4.5}>2.5–4.5 in</option>
            <option value={6}>6 in</option>
            <option value={8}>8 in</option>
          </select>
        </Field>
        <Field label="Sampler">
          <select value={layer.sampler} onChange={(e) => onChange('sampler', e.target.value)}>
            <option value="standard">Estándar / con liner</option>
            <option value="noLiner">Sin liner</option>
          </select>
        </Field>
        <Field label="Plasticidad">
          <select value={layer.plasticity} onChange={(e) => onChange('plasticity', e.target.value)}>
            <option value="low">Baja</option>
            <option value="high">Media/Alta</option>
          </select>
        </Field>
      </div>

      <div className="grid3">
        <Field label="Descripción"><input value={layer.description} onChange={(e) => onChange('description', e.target.value)} /></Field>
        <Field label="γ manual (kN/m³)"><input type="number" step="0.1" value={layer.gamma_manual ?? ''} onChange={(e) => onChange('gamma_manual', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <Field label="Observaciones"><input value={layer.observations} onChange={(e) => onChange('observations', e.target.value)} /></Field>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}
