const SOIL_COLORS = {
  sand: '#f6c85f',
  clay: '#8ecae6',
}

const SERIES = [
  { key: 'n_raw', label: 'N', color: '#172554', dash: '8 4' },
  { key: 'n60', label: 'N60', color: '#0f62fe', dash: '' },
  { key: 'n160_star', label: '(N1,60)*', color: '#d97706', dash: '3 3' },
]

export default function StratigraphyChart({ layers = [], chartId = 'spt-chart-svg' }) {
  if (!layers.length) return <div className="emptyBox">Sin datos para el grafico.</div>

  const normalizedLayers = layers.map((layer) => ({
    ...layer,
    mid: layer.mid ?? (Number(layer.top) + Number(layer.bottom)) / 2,
    n_raw: Number(layer.n_raw ?? 0),
    n60: Number(layer.n60 ?? layer.n_raw ?? 0),
    n160_star: Number(layer.n160_star ?? layer.n60 ?? layer.n_raw ?? 0),
  }))

  const totalDepth = Math.max(...normalizedLayers.map((layer) => Number(layer.bottom)), 1)
  const chartHeight = 540
  const chartWidth = 760
  const profileX = 90
  const profileWidth = 150
  const graphX = 310
  const graphWidth = 390
  const bottomPad = 44
  const topPad = 16
  const maxValue = Math.max(
    10,
    ...normalizedLayers.flatMap((layer) => SERIES.map((series) => Number(layer[series.key] ?? 0))),
  )
  const axisMax = Math.ceil(maxValue / 5) * 5

  const depthToY = (depth) => topPad + (Number(depth) / totalDepth) * (chartHeight - topPad - bottomPad)
  const valueToX = (value) => graphX + (Number(value) / axisMax) * graphWidth

  return (
    <div className="chartCard">
      <div className="chartTitle">Grafico estratigrafico y correlacion N vs profundidad</div>
      <svg id={chartId} width="100%" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        {[...Array(Math.ceil(totalDepth) + 1)].map((_, i) => {
          const y = depthToY(i)
          return (
            <g key={i}>
              <line x1={70} y1={y} x2={graphX + graphWidth} y2={y} stroke="#d7e0ee" strokeDasharray="4 4" />
              <text x={16} y={y + 4} fontSize="11" fill="#5d6b82">{i.toFixed(0)} m</text>
            </g>
          )
        })}

        {[...Array(axisMax / 5 + 1)].map((_, i) => {
          const value = i * 5
          const x = valueToX(value)
          return (
            <g key={value}>
              <line x1={x} y1={topPad} x2={x} y2={chartHeight - bottomPad} stroke="#e3ebf5" />
              <text x={x} y={chartHeight - 16} textAnchor="middle" fontSize="11" fill="#5d6b82">{value}</text>
            </g>
          )
        })}

        {normalizedLayers.map((layer) => {
          const y = depthToY(layer.top)
          const height = depthToY(layer.bottom) - depthToY(layer.top)
          return (
            <g key={`layer-${layer.idx}`}>
              <rect
                x={profileX}
                y={y}
                width={profileWidth}
                height={height}
                fill={SOIL_COLORS[layer.family] || '#ddd'}
                stroke="#3a4a61"
              />
              <text
                x={profileX + profileWidth / 2}
                y={y + height / 2 - 7}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="#162235"
              >
                {layer.soil}
              </text>
              <text
                x={profileX + profileWidth / 2}
                y={y + height / 2 + 8}
                textAnchor="middle"
                fontSize="10"
                fill="#162235"
              >
                {`${layer.top.toFixed(2)}-${layer.bottom.toFixed(2)} m`}
              </text>
              <title>{`Estrato ${layer.idx}\n${layer.soil}\nProfundidad: ${layer.top.toFixed(2)}-${layer.bottom.toFixed(2)} m`}</title>
            </g>
          )
        })}

        <line x1={graphX} y1={topPad} x2={graphX} y2={chartHeight - bottomPad} stroke="#8a99b2" strokeWidth="1.5" />
        <line x1={graphX} y1={chartHeight - bottomPad} x2={graphX + graphWidth} y2={chartHeight - bottomPad} stroke="#8a99b2" strokeWidth="1.5" />

        {[...SERIES].reverse().map((series) => {
          const points = normalizedLayers
            .map((layer) => `${valueToX(layer[series.key])},${depthToY(layer.mid)}`)
            .join(' ')

          return (
            <g key={series.key}>
              <polyline
                fill="none"
                stroke={series.color}
                strokeWidth="2.5"
                strokeDasharray={series.dash}
                points={points}
              />
              {normalizedLayers.map((layer) => {
                const cx = valueToX(layer[series.key])
                const cy = depthToY(layer.mid)
                return (
                  <g key={`${series.key}-${layer.idx}`}>
                    {series.key === 'n_raw' ? (
                      <rect
                        x={cx - 4.5}
                        y={cy - 4.5}
                        width="9"
                        height="9"
                        fill="#ffffff"
                        stroke={series.color}
                        strokeWidth="2"
                      />
                    ) : (
                      <circle
                        cx={cx}
                        cy={cy}
                        r="4.5"
                        fill={series.color}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                    )}
                    <title>{`${series.label}: ${layer[series.key].toFixed(1)}\nProfundidad media: ${layer.mid.toFixed(2)} m`}</title>
                  </g>
                )
              })}
            </g>
          )
        })}

        <text x={profileX} y={chartHeight - 16} fontSize="11" fill="#5d6b82">Perfil estratigrafico</text>
        <text x={graphX + graphWidth / 2} y={chartHeight - 16} textAnchor="middle" fontSize="11" fill="#5d6b82">
          Golpes corregidos y medidos
        </text>

        <g transform={`translate(${graphX}, 18)`}>
          {SERIES.map((series, index) => (
            <g key={series.key} transform={`translate(${index * 118}, 0)`}>
              <line x1="0" y1="0" x2="20" y2="0" stroke={series.color} strokeWidth="3" />
              {series.key === 'n_raw' ? (
                <rect x="6" y="-4" width="8" height="8" fill="#ffffff" stroke={series.color} strokeWidth="1.5" />
              ) : (
                <circle cx="10" cy="0" r="4" fill={series.color} stroke="#fff" strokeWidth="1.2" />
              )}
              <text x="28" y="4" fontSize="11" fill="#334155">{series.label}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
