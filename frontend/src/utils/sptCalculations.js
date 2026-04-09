export function calculateSPT(payload) {
  const cfg = payload.config
  const layersIn = [...payload.layers].sort((a, b) => Number(a.top) - Number(b.top))
  const ce = Number(cfg.energy_ratio_percent) / 60.0

  const roughLayers = layersIn.map((layer, i) => {
    const top = Number(layer.top)
    const bottom = Number(layer.bottom)
    const mid = (top + bottom) / 2
    const family = layer.family
    const soil = layer.soil
    const nRaw = Number(layer.n_raw)
    const cr = getCR(mid)
    const cs = getCS(nRaw, layer.sampler)
    const cb = getCB(Number(layer.borehole_diameter_in), family)
    const n60 = nRaw * ce
    const n60Star = n60 * cr * cs * cb
    const gammaGuess =
      layer.gamma_manual !== null && layer.gamma_manual !== '' && layer.gamma_manual !== undefined
        ? Number(layer.gamma_manual)
        : gammaPreset(family, soil, n60Star, cfg)

    return {
      idx: i + 1,
      top,
      bottom,
      mid,
      family,
      soil,
      nRaw,
      plasticity: layer.plasticity,
      description: layer.description || '',
      observations: layer.observations || '',
      cr,
      cs,
      cb,
      n60,
      n60Star,
      gammaGuess,
      gammaManual:
        layer.gamma_manual !== null && layer.gamma_manual !== '' && layer.gamma_manual !== undefined
          ? Number(layer.gamma_manual)
          : null,
    }
  })

  const layersOut = []
  const phiValues = []
  const suValues = []
  const esValues = []
  const ksValues = []

  for (const layer of roughLayers) {
    const sigmaVeff = effectiveStressAt(layer.mid, roughLayers, cfg.water_table)
    const cn = getCN(sigmaVeff, layer.family)
    const n160Star = layer.n60Star * cn

    let gamma =
      layer.gammaManual !== null
        ? layer.gammaManual
        : gammaPreset(layer.family, layer.soil, n160Star, cfg)

    const phiDeg = layer.family === 'sand' ? phiSand(n160Star) : null
    const suKpa = layer.family === 'clay' ? suClayKPa(layer.n60, layer.plasticity) : null
    const nu = layer.family === 'sand' ? Number(cfg.nu_sand) : Number(cfg.nu_clay)
    const esMpa = esMPa(layer.family, layer.soil, n160Star)
    const mMpa = constrainedModulus(esMpa, nu)
    const ksMnM3 = mMpa / Number(cfg.footing_width_m)
    const classification = densityClass(layer.family, n160Star)

    if (phiDeg !== null) phiValues.push(phiDeg)
    if (suKpa !== null) suValues.push(suKpa)
    esValues.push(esMpa)
    ksValues.push(ksMnM3)

    layersOut.push({
      idx: layer.idx,
      top: layer.top,
      bottom: layer.bottom,
      mid: layer.mid,
      family: layer.family,
      soil: layer.soil,
      n_raw: layer.nRaw,
      ce,
      cr: layer.cr,
      cs: layer.cs,
      cb: layer.cb,
      cn,
      n60: layer.n60,
      n60_star: layer.n60Star,
      n160_star: n160Star,
      gamma,
      phi_deg: phiDeg,
      su_kpa: suKpa,
      es_mpa: esMpa,
      m_mpa: mMpa,
      ks_mn_m3: ksMnM3,
      classification,
      description: layer.description,
      observations: layer.observations,
    })
  }

  const totalDepth = Math.max(...layersOut.map((x) => x.bottom), 0)

  const summary = {
    layer_count: layersOut.length,
    total_depth_m: totalDepth,
    n60_avg: average(layersOut.map((x) => x.n60)),
    n160_avg: average(layersOut.map((x) => x.n160_star)),
    phi_avg_deg: phiValues.length ? average(phiValues) : null,
    su_avg_kpa: suValues.length ? average(suValues) : null,
    es_avg_mpa: average(esValues),
    ks_avg_mn_m3: average(ksValues),
  }

  const reportText = buildReportText(cfg, summary, layersOut)

  return {
    summary,
    layers: layersOut,
    report_text: reportText,
  }
}

function average(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function getCR(midDepthM) {
  const ft = midDepthM * 3.28084 + 5.0
  if (ft < 13) return 0.75
  if (ft <= 20) return 0.85
  if (ft <= 33) return 0.95
  return 1.0
}

function getCS(nRaw, sampler) {
  if (sampler === 'standard') return 1.0
  if (nRaw <= 10) return 1.1
  if (nRaw <= 29) return 1.0 + nRaw / 100.0
  return 1.3
}

function getCB(diameterIn, family) {
  if (family === 'clay') return 1.0
  if (diameterIn <= 4.5) return 1.0
  if (diameterIn <= 6.0) return 1.05
  return 1.15
}

function gammaPreset(family, soil, n160, cfg) {
  if (family === 'sand') {
    let g = Number(cfg.gamma_preset_sand)
    if (['GW', 'GP', 'GM', 'GC'].includes(soil)) g += 0.5
    if (['SM', 'SC', 'ML'].includes(soil)) g -= 0.5
    if (n160 > 30) g += 0.5
    if (n160 > 50) g += 0.5
    if (n160 < 10) g -= 0.7
    return clamp(g, 16.5, 21.5)
  }

  let g = Number(cfg.gamma_preset_clay)
  if (['CH', 'OH', 'MH'].includes(soil)) g -= 0.4
  if (n160 > 20) g += 0.4
  if (n160 > 35) g += 0.4
  if (n160 < 8) g -= 0.6
  return clamp(g, 15.5, 20.5)
}

function effectiveStressAt(depth, roughLayers, waterTable) {
  const wt =
    waterTable === null || waterTable === '' || waterTable === undefined
      ? 1e9
      : Number(waterTable)
  const gammaW = 9.81
  let sigma = 0

  for (const layer of roughLayers) {
    const z1 = layer.top
    const z2 = layer.bottom
    const g = layer.gammaGuess

    if (depth <= z1) break

    const dz = Math.min(depth, z2) - z1
    if (dz <= 0) continue

    if (z1 >= wt) {
      sigma += (g - gammaW) * dz
    } else if (Math.min(depth, z2) <= wt) {
      sigma += g * dz
    } else {
      const dry = Math.max(0, wt - z1)
      const sub = Math.max(0, Math.min(depth, z2) - wt)
      sigma += g * dry + (g - gammaW) * sub
    }
  }

  return Math.max(sigma, 1.0)
}

function getCN(sigmaVeffKPa, family) {
  if (family === 'clay') return 1.0
  const cn = Math.sqrt(100.0 / sigmaVeffKPa)
  return clamp(cn, 0.4, 1.7)
}

function phiSand(n160) {
  return 1.4 * Math.sqrt(Math.max(0, n160)) + 22.0
}

function suClayKPa(n60, plasticity) {
  const ksf = plasticity === 'low' ? 0.075 * n60 : 0.15 * n60
  return ksf * 47.8803
}

function esMPa(family, soil, n160) {
  let factorPsi = 97
  if (family === 'clay') {
    factorPsi = 56
  } else if (['GP', 'GW'].includes(soil)) {
    factorPsi = 167
  } else if (['GM', 'GC'].includes(soil)) {
    factorPsi = 139
  }
  return factorPsi * n160 * 0.00689476
}

function constrainedModulus(eMpa, nu) {
  const den = (1 + nu) * (1 - 2 * nu)
  if (Math.abs(den) < 1e-8) return 0
  return (eMpa * (1 - nu)) / den
}

function densityClass(family, n160) {
  if (family === 'sand') {
    if (n160 < 4) return 'Muy suelto'
    if (n160 < 10) return 'Suelto'
    if (n160 < 30) return 'Medianamente denso'
    if (n160 < 50) return 'Denso'
    return 'Muy denso'
  }

  if (n160 < 2) return 'Muy blando'
  if (n160 < 4) return 'Blando'
  if (n160 < 8) return 'Media'
  if (n160 < 15) return 'Firme'
  if (n160 < 30) return 'Muy firme'
  return 'Duro'
}

function buildReportText(cfg, summary, layers) {
  const lines = [
    'REPORTE PRELIMINAR SPT',
    `Proyecto: ${cfg.project}`,
    `Sondeo: ${cfg.borehole}`,
    '',
    '1. Resumen',
    `- Número de estratos: ${summary.layer_count}`,
    `- Profundidad total evaluada: ${summary.total_depth_m.toFixed(2)} m`,
    `- N60 promedio: ${summary.n60_avg.toFixed(1)}`,
    `- (N1,60)* promedio: ${summary.n160_avg.toFixed(1)}`,
    `- Es promedio: ${summary.es_avg_mpa.toFixed(1)} MPa`,
    `- ks promedio preliminar: ${summary.ks_avg_mn_m3.toFixed(1)} MN/m³`,
  ]

  if (summary.phi_avg_deg !== null) {
    lines.push(`- φ' promedio en suelos granulares: ${summary.phi_avg_deg.toFixed(1)}°`)
  }
  if (summary.su_avg_kpa !== null) {
    lines.push(`- Su promedio en suelos cohesivos: ${summary.su_avg_kpa.toFixed(1)} kPa`)
  }

  lines.push('', '2. Estratificación y parámetros estimados')

  for (const x of layers) {
    const mainParam =
      x.phi_deg !== null ? `φ'≈${x.phi_deg.toFixed(1)}°` : `Su≈${x.su_kpa.toFixed(1)} kPa`

    lines.push(
      `- Estrato ${x.idx}: ${x.top.toFixed(2)}-${x.bottom.toFixed(2)} m | ${x.soil} | N=${x.n_raw.toFixed(1)} | N60=${x.n60.toFixed(1)} | N*60=${x.n60_star.toFixed(1)} | (N1,60)*=${x.n160_star.toFixed(1)} | ${x.classification} | ${mainParam} | γ≈${x.gamma.toFixed(1)} kN/m³ | Es≈${x.es_mpa.toFixed(1)} MPa | M≈${x.m_mpa.toFixed(1)} MPa | ks≈${x.ks_mn_m3.toFixed(1)} MN/m³`
    )
  }

  lines.push(
    '',
    '3. Observaciones',
    '- Los parámetros generados son preliminares y deben ser validados con laboratorio, correlaciones locales y criterio geotécnico.',
    '- En arcillas se reporta Su preliminar; la cohesión efectiva c\' no debe adoptarse directamente solo con SPT.',
    `- El ks reportado depende del ancho de cimentación B=${Number(cfg.footing_width_m).toFixed(2)} m y debe calibrarse para diseño final.`
  )

  return lines.join('\n')
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}