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
  const gammaValues = []
  const rhoValues = []
  const drValues = []

  for (const layer of roughLayers) {
    const sigmaVeff = effectiveStressAt(layer.mid, roughLayers, cfg.water_table)
    const cn = getCN(sigmaVeff, layer.family)
    const n160Star = layer.n60Star * cn

    const gamma =
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
    const relativeDensityPct = layer.family === 'sand' ? relativeDensityFromSPT(n160Star) : null
    const rhoKgM3 = massDensityFromUnitWeight(gamma)

    if (phiDeg !== null) phiValues.push(phiDeg)
    if (suKpa !== null) suValues.push(suKpa)
    if (relativeDensityPct !== null) drValues.push(relativeDensityPct)
    esValues.push(esMpa)
    ksValues.push(ksMnM3)
    gammaValues.push(gamma)
    rhoValues.push(rhoKgM3)

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
      rho_kg_m3: rhoKgM3,
      dr_pct: relativeDensityPct,
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
  const bearingCapacity = calculateBearingCapacities(cfg, layersOut)

  const summary = {
    layer_count: layersOut.length,
    total_depth_m: totalDepth,
    n60_avg: average(layersOut.map((x) => x.n60)),
    n160_avg: average(layersOut.map((x) => x.n160_star)),
    phi_avg_deg: phiValues.length ? average(phiValues) : null,
    su_avg_kpa: suValues.length ? average(suValues) : null,
    dr_avg_pct: drValues.length ? average(drValues) : null,
    gamma_avg_kn_m3: average(gammaValues),
    rho_avg_kg_m3: average(rhoValues),
    es_avg_mpa: average(esValues),
    ks_avg_mn_m3: average(ksValues),
    qadm_min_kpa: bearingCapacity.qadm_min_kpa,
  }

  const reportText = buildReportText(cfg, summary, layersOut, bearingCapacity)

  return {
    summary,
    layers: layersOut,
    bearing_capacity: bearingCapacity,
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

function relativeDensityFromSPT(n160) {
  return clamp(15 * Math.sqrt(Math.max(n160, 0)), 10, 100)
}

function massDensityFromUnitWeight(gammaKnM3) {
  return (gammaKnM3 * 1000) / 9.81
}

function calculateBearingCapacities(cfg, layers) {
  const footingWidth = Math.max(Number(cfg.footing_width_m) || 1.5, 0.2)
  const footingLengthRaw = Number(cfg.footing_length_m) || footingWidth
  const footingLength = Math.max(footingLengthRaw, footingWidth)
  const foundationDepth = Math.max(Number(cfg.foundation_depth_m) || 1.5, 0)
  const safetyFactor = Math.max(Number(cfg.safety_factor) || 3, 1)
  const footingShape = cfg.footing_shape || inferFootingShape(footingWidth, footingLength)
  const baseLayer = getLayerAtDepth(layers, foundationDepth)

  if (!baseLayer) {
    return {
      methods: [],
      qadm_min_kpa: 0,
      selected_layer_idx: null,
      assumptions:
        'No se pudo determinar el estrato de apoyo para la profundidad de desplante especificada.',
    }
  }

  const phiDeg = baseLayer.phi_deg ?? 0
  const cohesionKpa = baseLayer.family === 'clay' ? baseLayer.su_kpa ?? 0 : 0
  const gamma = baseLayer.gamma
  const surcharge = gamma * foundationDepth
  const factors = bearingCapacityFactors(phiDeg)
  const ratio = footingShape === 'strip' ? 0 : clamp(footingWidth / footingLength, 0, 1)

  const methods = [
    calculateMethodResult('Terzaghi', footingShape, footingWidth, footingLength, foundationDepth, gamma, surcharge, phiDeg, cohesionKpa, factors, safetyFactor, terzaghiShapeFactors(footingShape, ratio), { dc: 1, dq: 1, dg: 1 }, baseLayer.family === 'clay'),
    calculateMethodResult('Meyerhof', footingShape, footingWidth, footingLength, foundationDepth, gamma, surcharge, phiDeg, cohesionKpa, factors, safetyFactor, meyerhofShapeFactors(footingShape, ratio, phiDeg), meyerhofDepthFactors(footingWidth, foundationDepth, phiDeg), baseLayer.family === 'clay'),
    calculateMethodResult('Vesic', footingShape, footingWidth, footingLength, foundationDepth, gamma, surcharge, phiDeg, cohesionKpa, { ...factors, ngamma: ngammaVesic(phiDeg, factors.nq) }, safetyFactor, hansenVesicShapeFactors(footingShape, ratio, factors, phiDeg), hansenVesicDepthFactors(footingWidth, foundationDepth, phiDeg), baseLayer.family === 'clay'),
    calculateMethodResult('Hansen', footingShape, footingWidth, footingLength, foundationDepth, gamma, surcharge, phiDeg, cohesionKpa, { ...factors, ngamma: ngammaHansen(phiDeg, factors.nq) }, safetyFactor, hansenVesicShapeFactors(footingShape, ratio, factors, phiDeg), hansenVesicDepthFactors(footingWidth, foundationDepth, phiDeg), baseLayer.family === 'clay'),
  ]

  return {
    methods,
    qadm_min_kpa: Math.min(...methods.map((x) => x.qadm_kpa)),
    selected_layer_idx: baseLayer.idx,
    assumptions: `Capacidad portante estimada en el estrato ${baseLayer.idx} a Df=${foundationDepth.toFixed(2)} m con B=${footingWidth.toFixed(2)} m, L=${footingLength.toFixed(2)} m, forma ${footingShape} y FS=${safetyFactor.toFixed(2)}. Se asumen carga vertical centrada, terreno horizontal y factores de inclinacion igual a 1.`,
  }
}

function inferFootingShape(b, l) {
  if (l / b >= 5) return 'strip'
  if (Math.abs(l - b) / b < 0.1) return 'square'
  return 'rectangular'
}

function getLayerAtDepth(layers, depth) {
  return layers.find((layer) => depth >= layer.top && depth <= layer.bottom) || layers[layers.length - 1] || null
}

function bearingCapacityFactors(phiDeg) {
  if (phiDeg <= 1e-6) {
    return { nc: 5.14, nq: 1.0, ngamma: 0.0 }
  }

  const phi = toRad(phiDeg)
  const nq = Math.exp(Math.PI * Math.tan(phi)) * Math.tan(Math.PI / 4 + phi / 2) ** 2
  const nc = (nq - 1) / Math.tan(phi)
  return {
    nc,
    nq,
    ngamma: ngammaMeyerhof(phiDeg, nq),
  }
}

function terzaghiShapeFactors(shape, ratio) {
  if (shape === 'square') return { sc: 1.3, sq: 1.2, sg: 0.8 }
  if (shape === 'rectangular') return { sc: 1 + 0.3 * ratio, sq: 1 + 0.2 * ratio, sg: 1 - 0.2 * ratio }
  return { sc: 1, sq: 1, sg: 1 }
}

function meyerhofShapeFactors(shape, ratio, phiDeg) {
  if (shape === 'strip') return { sc: 1, sq: 1, sg: 1 }
  const tanSq = phiDeg <= 1e-6 ? 1 : Math.tan(Math.PI / 4 + toRad(phiDeg) / 2) ** 2
  return {
    sc: 1 + 0.2 * ratio * tanSq,
    sq: 1 + 0.1 * ratio * tanSq,
    sg: Math.max(0.6, 1 - 0.4 * ratio),
  }
}

function hansenVesicShapeFactors(shape, ratio, factors, phiDeg) {
  if (shape === 'strip') return { sc: 1, sq: 1, sg: 1 }
  const ncSafe = Math.max(factors.nc, 0.1)
  return {
    sc: 1 + (factors.nq / ncSafe) * ratio,
    sq: 1 + ratio * Math.sin(toRad(phiDeg)),
    sg: Math.max(0.6, 1 - 0.4 * ratio),
  }
}

function meyerhofDepthFactors(b, df, phiDeg) {
  if (phiDeg <= 1e-6) return { dc: 1 + 0.2 * (df / b), dq: 1, dg: 1 }
  const phi = toRad(phiDeg)
  const tanSq = Math.tan(Math.PI / 4 + phi / 2) ** 2
  return {
    dc: 1 + 0.2 * (df / b) * tanSq,
    dq: 1 + 0.1 * (df / b) * tanSq,
    dg: 1,
  }
}

function hansenVesicDepthFactors(b, df, phiDeg) {
  if (phiDeg <= 1e-6) return { dc: 1 + 0.4 * (df / b), dq: 1, dg: 1 }
  return {
    dc: 1 + 0.35 * (df / b),
    dq: 1 + 2 * Math.tan(toRad(phiDeg)) * (1 - Math.sin(toRad(phiDeg))) ** 2 * (df / b),
    dg: 1,
  }
}

function ngammaMeyerhof(phiDeg, nq) {
  if (phiDeg <= 1e-6) return 0
  return (nq - 1) * Math.tan(toRad(1.4 * phiDeg))
}

function ngammaVesic(phiDeg, nq) {
  if (phiDeg <= 1e-6) return 0
  return 2 * (nq + 1) * Math.tan(toRad(phiDeg))
}

function ngammaHansen(phiDeg, nq) {
  if (phiDeg <= 1e-6) return 0
  return 1.5 * (nq - 1) * Math.tan(toRad(phiDeg))
}

function calculateMethodResult(name, shape, b, l, df, gamma, surcharge, phiDeg, cohesionKpa, factors, safetyFactor, shapeFactors, depthFactors, isClay) {
  const cohesionTerm = cohesionKpa * factors.nc * shapeFactors.sc * depthFactors.dc
  const surchargeTerm = surcharge * factors.nq * shapeFactors.sq * depthFactors.dq
  const gammaTerm = isClay ? 0 : 0.5 * gamma * b * factors.ngamma * shapeFactors.sg * depthFactors.dg
  const qultKpa = cohesionTerm + surchargeTerm + gammaTerm

  return {
    method: name,
    shape,
    width_m: b,
    length_m: l,
    depth_m: df,
    phi_deg: phiDeg,
    cohesion_kpa: cohesionKpa,
    surcharge_kpa: surcharge,
    nc: factors.nc,
    nq: factors.nq,
    ngamma: factors.ngamma,
    qult_kpa: qultKpa,
    qadm_kpa: qultKpa / safetyFactor,
  }
}

function buildReportText(cfg, summary, layers, bearingCapacity) {
  const lines = [
    'REPORTE PRELIMINAR SPT',
    `Proyecto: ${cfg.project}`,
    `Sondeo: ${cfg.borehole}`,
    '',
    '1. Resumen',
    `- Numero de estratos: ${summary.layer_count}`,
    `- Profundidad total evaluada: ${summary.total_depth_m.toFixed(2)} m`,
    `- N60 promedio: ${summary.n60_avg.toFixed(1)}`,
    `- (N1,60)* promedio: ${summary.n160_avg.toFixed(1)}`,
    `- Gamma promedio estimado: ${summary.gamma_avg_kn_m3.toFixed(1)} kN/m3`,
    `- Densidad masica promedio estimada: ${summary.rho_avg_kg_m3.toFixed(0)} kg/m3`,
    `- Es promedio: ${summary.es_avg_mpa.toFixed(1)} MPa`,
    `- ks promedio preliminar: ${summary.ks_avg_mn_m3.toFixed(1)} MN/m3`,
  ]

  if (summary.dr_avg_pct !== null) {
    lines.push(`- Densidad relativa media en granulares: ${summary.dr_avg_pct.toFixed(0)} %`)
  }
  if (summary.phi_avg_deg !== null) {
    lines.push(`- phi' promedio en suelos granulares: ${summary.phi_avg_deg.toFixed(1)} grados`)
  }
  if (summary.su_avg_kpa !== null) {
    lines.push(`- Su promedio en suelos cohesivos: ${summary.su_avg_kpa.toFixed(1)} kPa`)
  }
  if (bearingCapacity.methods.length) {
    lines.push(`- qadm minima por metodos clasicos: ${bearingCapacity.qadm_min_kpa.toFixed(1)} kPa`)
  }

  lines.push('', '2. Correlaciones empiricas SPT')

  for (const x of layers) {
    const mainParam =
      x.phi_deg !== null ? `phi'≈${x.phi_deg.toFixed(1)} grados` : `Su≈${x.su_kpa.toFixed(1)} kPa`
    const drText = x.dr_pct !== null ? ` | Dr≈${x.dr_pct.toFixed(0)} %` : ''

    lines.push(
      `- Estrato ${x.idx}: ${x.top.toFixed(2)}-${x.bottom.toFixed(2)} m | ${x.soil} | N=${x.n_raw.toFixed(1)} | N60=${x.n60.toFixed(1)} | N*60=${x.n60_star.toFixed(1)} | (N1,60)*=${x.n160_star.toFixed(1)} | ${x.classification}${drText} | ${mainParam} | gamma≈${x.gamma.toFixed(1)} kN/m3 | rho≈${x.rho_kg_m3.toFixed(0)} kg/m3 | Es≈${x.es_mpa.toFixed(1)} MPa | M≈${x.m_mpa.toFixed(1)} MPa | ks≈${x.ks_mn_m3.toFixed(1)} MN/m3`
    )
  }

  lines.push('', '3. Capacidad portante estimada')

  if (bearingCapacity.methods.length) {
    lines.push(`- ${bearingCapacity.assumptions}`)
    for (const method of bearingCapacity.methods) {
      lines.push(
        `- ${method.method}: qult≈${method.qult_kpa.toFixed(1)} kPa | qadm≈${method.qadm_kpa.toFixed(1)} kPa | Nc=${method.nc.toFixed(2)} | Nq=${method.nq.toFixed(2)} | Ngamma=${method.ngamma.toFixed(2)}`
      )
    }
  } else {
    lines.push(`- ${bearingCapacity.assumptions}`)
  }

  lines.push(
    '',
    '4. Observaciones',
    '- Los parametros obtenidos por SPT son correlaciones empiricas preliminares y deben validarse con ensayos de laboratorio, experiencia local y criterio geotecnico.',
    '- Las capacidades portantes por Terzaghi, Meyerhof, Vesic y Hansen se reportan con supuestos simplificados de carga vertical centrada, base horizontal y sin inclinacion.',
    `- El ks reportado depende del ancho de cimentacion B=${Number(cfg.footing_width_m).toFixed(2)} m y debe calibrarse para el diseno final.`
  )

  return lines.join('\n')
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180
}
