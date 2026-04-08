from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from json import JSONDecodeError
from math import exp, pi, sqrt, tan
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError, model_validator
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.graphics.shapes import Circle, Drawing, Group, Line, PolyLine, Rect, String
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

app = FastAPI(title="Terranivo SPT API", version="2.0.0")

PROJECTS_DIR = Path(__file__).resolve().parent.parent / "data" / "projects"
LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "terranivo-logo.jpeg"
PROJECT_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LayerIn(BaseModel):
    top: float = Field(..., ge=0)
    bottom: float = Field(..., gt=0)
    family: Literal["sand", "clay"]
    soil: str
    n_raw: float = Field(..., ge=0)
    borehole_diameter_in: float = 4.5
    sampler: Literal["standard", "noLiner"] = "standard"
    plasticity: Literal["low", "high"] = "low"
    gamma_manual: Optional[float] = Field(default=None, ge=10, le=24)
    description: str = ""
    observations: str = ""

    @model_validator(mode="after")
    def validate_depths(self) -> "LayerIn":
        if self.bottom <= self.top:
            raise ValueError("bottom debe ser mayor que top")
        return self


class ProjectConfig(BaseModel):
    project: str = "Proyecto SPT"
    borehole: str = "BH-01"
    water_table: Optional[float] = None
    footing_width_m: float = Field(1.5, gt=0)
    foundation_depth_m: float = Field(1.5, ge=0)
    bearing_safety_factor: float = Field(3.0, ge=2.0, le=5.0)
    energy_ratio_percent: float = Field(60, gt=0, le=120)
    nu_sand: float = Field(0.30, gt=0.05, lt=0.49)
    nu_clay: float = Field(0.35, gt=0.05, lt=0.49)
    gamma_preset_sand: float = Field(19.0, ge=15, le=23)
    gamma_preset_clay: float = Field(18.0, ge=14, le=22)


class SPTRequest(BaseModel):
    config: ProjectConfig
    layers: list[LayerIn]

    @model_validator(mode="after")
    def validate_layers(self) -> "SPTRequest":
        if not self.layers:
            raise ValueError("Debe registrar al menos un estrato.")

        ordered_layers = sorted(self.layers, key=lambda layer: (layer.top, layer.bottom))
        previous_bottom: Optional[float] = None
        for layer in ordered_layers:
            if previous_bottom is not None and layer.top < previous_bottom:
                raise ValueError("Los estratos no pueden solaparse.")
            previous_bottom = layer.bottom
        return self


class LayerOut(BaseModel):
    idx: int
    top: float
    bottom: float
    mid: float
    family: str
    soil: str
    n_raw: float
    ce: float
    cr: float
    cs: float
    cb: float
    cn: float
    n60: float
    n60_star: float
    n160_star: float
    gamma: float
    phi_deg: Optional[float] = None
    su_kpa: Optional[float] = None
    es_mpa: float
    m_mpa: float
    ks_mn_m3: float
    qa_emp_kpa: float
    qa_semi_kpa: float
    classification: str
    description: str
    observations: str


class SummaryOut(BaseModel):
    layer_count: int
    total_depth_m: float
    n60_avg: float
    n160_avg: float
    phi_avg_deg: Optional[float] = None
    su_avg_kpa: Optional[float] = None
    es_avg_mpa: float
    ks_avg_mn_m3: float
    qa_emp_avg_kpa: float
    qa_semi_avg_kpa: float


class SPTResponse(BaseModel):
    summary: SummaryOut
    layers: list[LayerOut]
    report_text: str


class SavedProject(BaseModel):
    project_id: str
    name: str
    created_at: datetime
    updated_at: datetime
    data: SPTRequest


class ProjectListItem(BaseModel):
    project_id: str
    name: str
    created_at: datetime
    updated_at: datetime
    layer_count: int
    borehole: str


class ProjectSaveRequest(BaseModel):
    name: Optional[str] = None
    data: SPTRequest


@dataclass(slots=True)
class RoughLayer:
    idx: int
    top: float
    bottom: float
    mid: float
    family: str
    soil: str
    n_raw: float
    cr: float
    cs: float
    cb: float
    n60: float
    n60_star: float
    gamma_guess: float
    description: str
    observations: str
    plasticity: str
    gamma_manual: Optional[float]


def ensure_projects_dir() -> None:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def slugify_project_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "proyecto-spt"


def project_file(project_id: str) -> Path:
    if not PROJECT_ID_PATTERN.fullmatch(project_id):
        raise HTTPException(status_code=400, detail="Identificador de proyecto invalido.")
    return PROJECTS_DIR / f"{project_id}.json"


def read_project_record(path: Path) -> SavedProject:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return SavedProject.model_validate(json.load(handle))
    except (JSONDecodeError, ValidationError) as exc:
        logger.warning("No se pudo leer el proyecto %s: %s", path.name, exc)
        raise HTTPException(status_code=500, detail="El proyecto guardado esta corrupto.") from exc


def save_project_record(record: SavedProject) -> None:
    ensure_projects_dir()
    with project_file(record.project_id).open("w", encoding="utf-8") as handle:
        json.dump(record.model_dump(mode="json"), handle, ensure_ascii=False, indent=2)


def load_project_record(project_id: str) -> SavedProject:
    ensure_projects_dir()
    path = project_file(project_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Proyecto no encontrado.")
    return read_project_record(path)


def list_project_records() -> list[SavedProject]:
    ensure_projects_dir()
    records: list[SavedProject] = []
    for path in sorted(PROJECTS_DIR.glob("*.json")):
        try:
            records.append(read_project_record(path))
        except HTTPException:
            continue
    records.sort(key=lambda item: item.updated_at, reverse=True)
    return records


def validate_calculation_ready(payload: SPTRequest) -> list[LayerIn]:
    ordered_layers = sorted(payload.layers, key=lambda layer: (layer.top, layer.bottom))
    if not ordered_layers:
        raise HTTPException(status_code=422, detail="Debe registrar al menos un estrato.")
    return ordered_layers


def sanitize_download_name(value: str, fallback: str = "SPT") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    cleaned = cleaned.strip("._")
    return cleaned or fallback


def build_spt_chart(layers: list[LayerOut]) -> Drawing:
    width = 500
    height = 320
    top_pad = 18
    bottom_pad = 34
    profile_x = 60
    profile_width = 105
    graph_x = 225
    graph_width = 240
    total_depth = max((layer.bottom for layer in layers), default=1.0)
    axis_max = max(
        10,
        int(max(
            max(layer.n_raw for layer in layers),
            max(layer.n60 for layer in layers),
            max(layer.n160_star for layer in layers),
        ) / 5 + 0.9999) * 5,
    )

    soil_colors = {
        "sand": colors.HexColor("#f6c85f"),
        "clay": colors.HexColor("#8ecae6"),
    }
    series = [
        ("n_raw", "N", colors.HexColor("#172554"), [6, 3], "square"),
        ("n60", "N60", colors.HexColor("#0f62fe"), None, "circle"),
        ("n160_star", "(N1,60)*", colors.HexColor("#d97706"), [2, 2], "circle"),
    ]

    drawing = Drawing(width, height)

    def depth_to_y(depth: float) -> float:
        return height - bottom_pad - (depth / total_depth) * (height - top_pad - bottom_pad)

    def value_to_x(value: float) -> float:
        return graph_x + (value / axis_max) * graph_width

    for depth in range(int(total_depth) + 1):
        y = depth_to_y(float(depth))
        drawing.add(Line(48, y, graph_x + graph_width, y, strokeColor=colors.HexColor("#d7e0ee"), strokeDashArray=[3, 3]))
        drawing.add(String(8, y - 4, f"{depth} m", fontSize=8, fillColor=colors.HexColor("#5d6b82")))

    for value in range(0, axis_max + 1, 5):
        x = value_to_x(float(value))
        drawing.add(Line(x, top_pad, x, height - bottom_pad, strokeColor=colors.HexColor("#e3ebf5")))
        drawing.add(String(x - 5, height - 18, str(value), fontSize=8, fillColor=colors.HexColor("#5d6b82")))

    for layer in layers:
        y_top = depth_to_y(layer.top)
        y_bottom = depth_to_y(layer.bottom)
        rect_y = y_bottom
        rect_h = y_top - y_bottom
        drawing.add(
            Rect(
                profile_x,
                rect_y,
                profile_width,
                rect_h,
                fillColor=soil_colors.get(layer.family, colors.HexColor("#d9d9d9")),
                strokeColor=colors.HexColor("#3a4a61"),
                strokeWidth=1,
            )
        )
        mid_y = rect_y + rect_h / 2
        drawing.add(String(profile_x + 36, mid_y + 5, layer.soil, fontSize=8, fillColor=colors.HexColor("#162235")))
        drawing.add(String(profile_x + 14, mid_y - 7, f"{layer.top:.1f}-{layer.bottom:.1f} m", fontSize=7, fillColor=colors.HexColor("#162235")))

    drawing.add(Line(graph_x, top_pad, graph_x, height - bottom_pad, strokeColor=colors.HexColor("#8a99b2"), strokeWidth=1.2))
    drawing.add(Line(graph_x, height - bottom_pad, graph_x + graph_width, height - bottom_pad, strokeColor=colors.HexColor("#8a99b2"), strokeWidth=1.2))

    for key, _, color, dash, marker_type in reversed(series):
        points: list[float] = []
        for layer in layers:
            points.extend([value_to_x(float(getattr(layer, key))), depth_to_y(layer.mid)])
        polyline = PolyLine(points, strokeColor=color, strokeWidth=2, fillColor=None)
        if dash:
            polyline.strokeDashArray = dash
        drawing.add(polyline)

        for layer in layers:
            cx = value_to_x(float(getattr(layer, key)))
            cy = depth_to_y(layer.mid)
            marker = Group()
            if marker_type == "square":
                marker.add(Rect(cx - 3.3, cy - 3.3, 6.6, 6.6, fillColor=colors.white, strokeColor=color, strokeWidth=1.2))
            else:
                marker.add(Circle(cx, cy, 3.2, fillColor=color, strokeColor=colors.white, strokeWidth=0.8))
            drawing.add(marker)

    drawing.add(String(profile_x, height - 12, "Estratos", fontSize=8, fillColor=colors.HexColor("#5d6b82")))
    drawing.add(String(graph_x + 60, height - 12, "N, N60 y (N1,60)*", fontSize=8, fillColor=colors.HexColor("#5d6b82")))

    legend_x = graph_x
    legend_y = 12
    for index, (_, label, color, dash, marker_type) in enumerate(series):
        x = legend_x + index * 86
        line = Line(x, legend_y, x + 18, legend_y, strokeColor=color, strokeWidth=2)
        if dash:
            line.strokeDashArray = dash
        drawing.add(line)
        if marker_type == "square":
            drawing.add(Rect(x + 5.8, legend_y - 3.2, 6.4, 6.4, fillColor=colors.white, strokeColor=color, strokeWidth=1.2))
        else:
            drawing.add(Circle(x + 9, legend_y, 2.8, fillColor=color, strokeColor=colors.white, strokeWidth=0.8))
        drawing.add(String(x + 24, legend_y - 3, label, fontSize=8, fillColor=colors.HexColor("#334155")))

    return drawing


def add_bullet_paragraphs(story: list, items: list[str], style) -> None:
    for item in items:
        story.append(Paragraph(f"- {item}", style))


def build_interpretation_sections(result: SPTResponse, payload: SPTRequest) -> tuple[list[str], list[str], list[str]]:
    layers = result.layers
    granular_layers = [layer for layer in layers if layer.family == "sand"]
    cohesive_layers = [layer for layer in layers if layer.family == "clay"]
    dense_granular = sum(1 for layer in granular_layers if layer.n160_star >= 30)
    soft_cohesive = sum(1 for layer in cohesive_layers if layer.su_kpa is not None and layer.su_kpa < 75)

    interpretation = [
        f"Se identificaron {result.summary.layer_count} estratos hasta {result.summary.total_depth_m:.2f} m de profundidad.",
        f"El nivel general de resistencia corregida es N60 promedio = {result.summary.n60_avg:.1f} y (N1,60)* promedio = {result.summary.n160_avg:.1f}.",
        f"El modulo elastico promedio estimado es {result.summary.es_avg_mpa:.1f} MPa y el ks preliminar promedio es {result.summary.ks_avg_mn_m3:.1f} MN/m3.",
        f"La tension admisible promedio estimada es {result.summary.qa_emp_avg_kpa:.1f} kPa por metodo empirico y {result.summary.qa_semi_avg_kpa:.1f} kPa por metodo semiempirico.",
    ]
    if granular_layers and result.summary.phi_avg_deg is not None:
        interpretation.append(
            f"Los materiales granulares presentan un angulo de friccion promedio estimado de {result.summary.phi_avg_deg:.1f} deg."
        )
    if cohesive_layers and result.summary.su_avg_kpa is not None:
        interpretation.append(
            f"Los materiales cohesivos presentan una resistencia no drenada promedio estimada de {result.summary.su_avg_kpa:.1f} kPa."
        )
    if payload.config.water_table is not None:
        interpretation.append(f"Se considero nivel freatico a {payload.config.water_table:.2f} m para las correcciones y esfuerzos efectivos.")

    conclusions = [
        "El perfil evaluado permite una primera caracterizacion geotecnica para fines de anteproyecto y comparacion entre estratos.",
        "Los parametros obtenidos provienen de correlaciones con SPT y deben confirmarse con criterio geotecnico y ensayos complementarios.",
    ]
    if dense_granular:
        conclusions.append(f"Se observan {dense_granular} estratos granulares con comportamiento denso o muy denso, favorables para apoyo superficial preliminar.")
    if soft_cohesive:
        conclusions.append(f"Se detectan {soft_cohesive} estratos cohesivos con resistencia no drenada baja, que requieren mayor cautela en deformaciones y capacidad.")
    if not soft_cohesive and cohesive_layers:
        conclusions.append("Los estratos cohesivos identificados no muestran, en esta estimacion preliminar, una condicion marcadamente blanda.")

    recommendations = [
        "Validar los parametros adoptados con ensayos de laboratorio, clasificacion de suelos y experiencia local antes del diseno final.",
        f"Calibrar el coeficiente de balasto para el ancho de cimentacion adoptado B = {payload.config.footing_width_m:.2f} m y el tipo de elemento estructural.",
        f"Revisar la capacidad portante admisible usando profundidad de desplante Df = {payload.config.foundation_depth_m:.2f} m y factor de seguridad FS = {payload.config.bearing_safety_factor:.2f}.",
        "Complementar el estudio con revisiones de asentamientos, capacidad portante, estabilidad y agresividad del suelo segun el proyecto definitivo.",
    ]
    if payload.config.water_table is not None:
        recommendations.append("Verificar estacionalidad del nivel freatico y su influencia en excavacion, drenaje y esfuerzos efectivos.")
    recommendations.append("Si el proyecto es sensible a deformaciones, considerar correlaciones locales adicionales o ensayos in situ/laboratorio de mayor precision.")

    return interpretation, conclusions, recommendations


def draw_brand_watermark(canvas, doc) -> None:
    canvas.saveState()
    page_width, page_height = A4

    if LOGO_PATH.exists():
        try:
            canvas.setFillAlpha(0.07)
            logo = ImageReader(str(LOGO_PATH))
            logo_width = 10.0 * cm
            logo_height = 3.7 * cm
            canvas.drawImage(
                logo,
                (page_width - logo_width) / 2,
                page_height / 2 - logo_height / 2 + 0.9 * cm,
                width=logo_width,
                height=logo_height,
                preserveAspectRatio=True,
                mask="auto",
            )
        except Exception:
            pass

    canvas.setFillAlpha(0.08)
    canvas.setFont("Helvetica-Bold", 34)
    canvas.setFillColor(colors.HexColor("#1b4d83"))
    canvas.translate(page_width / 2, page_height / 2)
    canvas.rotate(28)
    canvas.drawCentredString(0, -2.2 * cm, "TERRANIVO SPT")
    canvas.restoreState()

    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.setFont("Helvetica", 8)
    canvas.drawString(doc.leftMargin, 0.9 * cm, "© 2026 Terranivo SPT. Todos los derechos reservados.")
    canvas.drawRightString(page_width - doc.rightMargin, 0.9 * cm, "Desarrollado por Abel Mario Vega Perez.")
    canvas.restoreState()


def get_cr(mid_depth_m: float) -> float:
    ft = mid_depth_m * 3.28084 + 5.0
    if ft < 13:
        return 0.75
    if ft <= 20:
        return 0.85
    if ft <= 33:
        return 0.95
    return 1.0


def get_cs(n_raw: float, sampler: str) -> float:
    if sampler == "standard":
        return 1.0
    if n_raw <= 10:
        return 1.1
    if n_raw <= 29:
        return 1.0 + n_raw / 100.0
    return 1.3


def get_cb(diameter_in: float, family: str) -> float:
    if family == "clay":
        return 1.0
    if diameter_in <= 4.5:
        return 1.0
    if diameter_in <= 6.0:
        return 1.05
    return 1.15


def gamma_preset(family: str, soil: str, n160: float, cfg: ProjectConfig) -> float:
    if family == "sand":
        g = cfg.gamma_preset_sand
        if soil in {"GW", "GP", "GM", "GC"}:
            g += 0.5
        if soil in {"SM", "SC", "ML"}:
            g -= 0.5
        if n160 > 30:
            g += 0.5
        if n160 > 50:
            g += 0.5
        if n160 < 10:
            g -= 0.7
        return max(16.5, min(21.5, g))

    g = cfg.gamma_preset_clay
    if soil in {"CH", "OH", "MH"}:
        g -= 0.4
    if n160 > 20:
        g += 0.4
    if n160 > 35:
        g += 0.4
    if n160 < 8:
        g -= 0.6
    return max(15.5, min(20.5, g))


def effective_stress_at(depth: float, rough_layers: list[RoughLayer], water_table: Optional[float]) -> float:
    wt = 10**9 if water_table is None else water_table
    gamma_w = 9.81
    sigma = 0.0
    for layer in rough_layers:
        z1 = layer.top
        z2 = layer.bottom
        g = layer.gamma_guess
        if depth <= z1:
            break
        dz = min(depth, z2) - z1
        if dz <= 0:
            continue
        if z1 >= wt:
            sigma += (g - gamma_w) * dz
        elif min(depth, z2) <= wt:
            sigma += g * dz
        else:
            dry = max(0.0, wt - z1)
            sub = max(0.0, min(depth, z2) - wt)
            sigma += g * dry + (g - gamma_w) * sub
    return max(sigma, 1.0)


def get_cn(sigma_veff_kpa: float, family: str) -> float:
    if family == "clay":
        return 1.0
    cn = sqrt(100.0 / sigma_veff_kpa)
    return max(0.4, min(1.7, cn))


def phi_sand(n160: float) -> float:
    return 1.4 * sqrt(max(0.0, n160)) + 22.0


def su_clay_kpa(n60: float, plasticity: str) -> float:
    ksf = 0.075 * n60 if plasticity == "low" else 0.15 * n60
    return ksf * 47.8803


def es_mpa(family: str, soil: str, n160: float) -> float:
    if family == "clay":
        factor_psi = 56
    else:
        if soil in {"GP", "GW"}:
            factor_psi = 167
        elif soil in {"GM", "GC"}:
            factor_psi = 139
        else:
            factor_psi = 97
    return factor_psi * n160 * 0.00689476


def constrained_modulus(e_mpa: float, nu: float) -> float:
    den = (1 + nu) * (1 - 2 * nu)
    if abs(den) < 1e-8:
        return 0.0
    return e_mpa * (1 - nu) / den


def density_class(family: str, n160: float) -> str:
    if family == "sand":
        if n160 < 4:
            return "Muy suelto"
        if n160 < 10:
            return "Suelto"
        if n160 < 30:
            return "Medianamente denso"
        if n160 < 50:
            return "Denso"
        return "Muy denso"
    if n160 < 2:
        return "Muy blando"
    if n160 < 4:
        return "Blando"
    if n160 < 8:
        return "Media"
    if n160 < 15:
        return "Firme"
    if n160 < 30:
        return "Muy firme"
    return "Duro"


def bearing_capacity_empirical_kpa(family: str, n60: float) -> float:
    if family == "sand":
        return max(40.0, min(500.0, 12.0 * n60))
    return max(35.0, min(350.0, 10.0 * n60))


def bearing_capacity_semiempirical_kpa(
    family: str,
    gamma: float,
    footing_width_m: float,
    foundation_depth_m: float,
    safety_factor: float,
    phi_deg: Optional[float],
    su_kpa: Optional[float],
) -> float:
    if family == "clay":
        su = su_kpa or 0.0
        qult = 5.14 * su + gamma * foundation_depth_m
        return max(25.0, qult / safety_factor)

    phi_rad = (phi_deg or 0.0) * pi / 180.0
    if phi_rad <= 0:
        return 25.0
    nq = exp(pi * tan(phi_rad)) * (tan(pi / 4 + phi_rad / 2) ** 2)
    ngamma = max(0.0, 2.0 * (nq + 1.0) * tan(phi_rad))
    qult = gamma * foundation_depth_m * nq + 0.5 * gamma * footing_width_m * ngamma
    return max(25.0, qult / safety_factor)


def calculate_spt(payload: SPTRequest) -> SPTResponse:
    cfg = payload.config
    ce = cfg.energy_ratio_percent / 60.0
    ordered_layers = validate_calculation_ready(payload)

    rough_layers: list[RoughLayer] = []
    for i, layer in enumerate(ordered_layers, start=1):
        mid = (layer.top + layer.bottom) / 2
        cr = get_cr(mid)
        cs = get_cs(layer.n_raw, layer.sampler)
        cb = get_cb(layer.borehole_diameter_in, layer.family)
        n60 = layer.n_raw * ce
        n60_star = n60 * cr * cs * cb
        gamma_guess = layer.gamma_manual if layer.gamma_manual is not None else gamma_preset(layer.family, layer.soil, n60_star, cfg)
        rough_layers.append(
            RoughLayer(
                idx=i,
                top=layer.top,
                bottom=layer.bottom,
                mid=mid,
                family=layer.family,
                soil=layer.soil,
                n_raw=layer.n_raw,
                cr=cr,
                cs=cs,
                cb=cb,
                n60=n60,
                n60_star=n60_star,
                gamma_guess=gamma_guess,
                description=layer.description,
                observations=layer.observations,
                plasticity=layer.plasticity,
                gamma_manual=layer.gamma_manual,
            )
        )

    layers_out: list[LayerOut] = []
    phi_values: list[float] = []
    su_values: list[float] = []
    es_values: list[float] = []
    ks_values: list[float] = []
    qa_emp_values: list[float] = []
    qa_semi_values: list[float] = []

    for layer in rough_layers:
        sigma_veff = effective_stress_at(layer.mid, rough_layers, cfg.water_table)
        cn = get_cn(sigma_veff, layer.family)
        n160_star = layer.n60_star * cn
        gamma = layer.gamma_manual if layer.gamma_manual is not None else gamma_preset(layer.family, layer.soil, n160_star, cfg)
        phi_deg = phi_sand(n160_star) if layer.family == "sand" else None
        su_kpa = su_clay_kpa(layer.n60, layer.plasticity) if layer.family == "clay" else None
        nu = cfg.nu_sand if layer.family == "sand" else cfg.nu_clay
        es = es_mpa(layer.family, layer.soil, n160_star)
        m = constrained_modulus(es, nu)
        ks = m / cfg.footing_width_m
        qa_emp = bearing_capacity_empirical_kpa(layer.family, layer.n60)
        qa_semi = bearing_capacity_semiempirical_kpa(
            family=layer.family,
            gamma=gamma,
            footing_width_m=cfg.footing_width_m,
            foundation_depth_m=cfg.foundation_depth_m,
            safety_factor=cfg.bearing_safety_factor,
            phi_deg=phi_deg,
            su_kpa=su_kpa,
        )
        classification = density_class(layer.family, n160_star)

        if phi_deg is not None:
            phi_values.append(phi_deg)
        if su_kpa is not None:
            su_values.append(su_kpa)
        es_values.append(es)
        ks_values.append(ks)
        qa_emp_values.append(qa_emp)
        qa_semi_values.append(qa_semi)

        layers_out.append(
            LayerOut(
                idx=layer.idx,
                top=layer.top,
                bottom=layer.bottom,
                mid=layer.mid,
                family=layer.family,
                soil=layer.soil,
                n_raw=layer.n_raw,
                ce=ce,
                cr=layer.cr,
                cs=layer.cs,
                cb=layer.cb,
                cn=cn,
                n60=layer.n60,
                n60_star=layer.n60_star,
                n160_star=n160_star,
                gamma=gamma,
                phi_deg=phi_deg,
                su_kpa=su_kpa,
                es_mpa=es,
                m_mpa=m,
                ks_mn_m3=ks,
                qa_emp_kpa=qa_emp,
                qa_semi_kpa=qa_semi,
                classification=classification,
                description=layer.description,
                observations=layer.observations,
            )
        )

    summary = SummaryOut(
        layer_count=len(layers_out),
        total_depth_m=max((layer.bottom for layer in layers_out), default=0.0),
        n60_avg=sum(layer.n60 for layer in layers_out) / len(layers_out),
        n160_avg=sum(layer.n160_star for layer in layers_out) / len(layers_out),
        phi_avg_deg=(sum(phi_values) / len(phi_values)) if phi_values else None,
        su_avg_kpa=(sum(su_values) / len(su_values)) if su_values else None,
        es_avg_mpa=sum(es_values) / len(es_values),
        ks_avg_mn_m3=sum(ks_values) / len(ks_values),
        qa_emp_avg_kpa=sum(qa_emp_values) / len(qa_emp_values),
        qa_semi_avg_kpa=sum(qa_semi_values) / len(qa_semi_values),
    )

    lines = [
        "TERRANIVO SPT",
        f"Proyecto: {cfg.project}",
        f"Sondeo: {cfg.borehole}",
        "",
        "1. Resumen",
        f"- Numero de estratos: {summary.layer_count}",
        f"- Profundidad total evaluada: {summary.total_depth_m:.2f} m",
        f"- N60 promedio: {summary.n60_avg:.1f}",
        f"- (N1,60)* promedio: {summary.n160_avg:.1f}",
        f"- Es promedio: {summary.es_avg_mpa:.1f} MPa",
        f"- ks promedio preliminar: {summary.ks_avg_mn_m3:.1f} MN/m3",
        f"- Tension admisible empirica promedio: {summary.qa_emp_avg_kpa:.1f} kPa",
        f"- Tension admisible semiempirica promedio: {summary.qa_semi_avg_kpa:.1f} kPa",
    ]
    if summary.phi_avg_deg is not None:
        lines.append(f"- phi' promedio en suelos granulares: {summary.phi_avg_deg:.1f} deg")
    if summary.su_avg_kpa is not None:
        lines.append(f"- Su promedio en suelos cohesivos: {summary.su_avg_kpa:.1f} kPa")

    lines += ["", "2. Estratificacion y parametros estimados"]
    for layer in layers_out:
        main_param = f"phi'~{layer.phi_deg:.1f} deg" if layer.phi_deg is not None else f"Su~{layer.su_kpa:.1f} kPa"
        lines.append(
            f"- Estrato {layer.idx}: {layer.top:.2f}-{layer.bottom:.2f} m | {layer.soil} | N={layer.n_raw:.1f} | "
            f"N60={layer.n60:.1f} | N*60={layer.n60_star:.1f} | (N1,60)*={layer.n160_star:.1f} | {layer.classification} | "
            f"{main_param} | gamma~{layer.gamma:.1f} kN/m3 | Es~{layer.es_mpa:.1f} MPa | M~{layer.m_mpa:.1f} MPa | "
            f"ks~{layer.ks_mn_m3:.1f} MN/m3 | qadm emp~{layer.qa_emp_kpa:.1f} kPa | qadm semi~{layer.qa_semi_kpa:.1f} kPa"
        )

    lines += [
        "",
        "3. Observaciones",
        "- Los parametros generados son preliminares y deben ser validados con laboratorio, correlaciones locales y criterio geotecnico.",
        "- En arcillas se reporta Su preliminar; la cohesion efectiva c' no debe adoptarse directamente solo con SPT.",
        f"- El ks reportado depende del ancho de cimentacion B={cfg.footing_width_m:.2f} m y debe calibrarse para diseno final.",
    ]

    return SPTResponse(summary=summary, layers=layers_out, report_text="\n".join(lines))


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/calculate", response_model=SPTResponse)
def calculate(payload: SPTRequest) -> SPTResponse:
    return calculate_spt(payload)


@app.get("/api/projects", response_model=list[ProjectListItem])
def list_projects() -> list[ProjectListItem]:
    return [
        ProjectListItem(
            project_id=record.project_id,
            name=record.name,
            created_at=record.created_at,
            updated_at=record.updated_at,
            layer_count=len(record.data.layers),
            borehole=record.data.config.borehole,
        )
        for record in list_project_records()
    ]


@app.post("/api/projects", response_model=ProjectListItem)
def save_project(payload: ProjectSaveRequest) -> ProjectListItem:
    project_name = (payload.name or payload.data.config.project).strip() or "Proyecto SPT"
    project_id = slugify_project_name(project_name)
    now = datetime.now(timezone.utc)

    try:
        existing = load_project_record(project_id)
        created_at = existing.created_at
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        created_at = now

    record = SavedProject(
        project_id=project_id,
        name=project_name,
        created_at=created_at,
        updated_at=now,
        data=payload.data,
    )
    save_project_record(record)

    return ProjectListItem(
        project_id=record.project_id,
        name=record.name,
        created_at=record.created_at,
        updated_at=record.updated_at,
        layer_count=len(record.data.layers),
        borehole=record.data.config.borehole,
    )


@app.get("/api/projects/{project_id}", response_model=SavedProject)
def get_project(project_id: str) -> SavedProject:
    return load_project_record(project_id)


@app.post("/api/report/pdf")
def build_pdf(payload: SPTRequest) -> StreamingResponse:
    result = calculate_spt(payload)
    download_name = sanitize_download_name(payload.config.borehole)
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    interpretation, conclusions, recommendations = build_interpretation_sections(result, payload)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    # 1. Portada
    if LOGO_PATH.exists():
        logo = Image(str(LOGO_PATH))
        logo.drawHeight = 3.0 * cm
        logo.drawWidth = 8.2 * cm
        story.append(logo)
        story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph("1. Portada", styles["Heading1"]))
    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph("Terranivo SPT", styles["Title"]))
    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph("Informe Geotecnico Preliminar basado en SPT", styles["Heading2"]))
    story.append(Spacer(1, 0.8 * cm))
    portada_data = [
        ["Proyecto", payload.config.project],
        ["Sondeo", payload.config.borehole],
        ["Fecha de emision", generated_at],
        ["Aplicacion", "Terranivo SPT"],
    ]
    portada_table = Table(portada_data, colWidths=[4.8 * cm, 10.2 * cm])
    portada_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef4ff")),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#173f7a")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d7e0ee")),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("LEADING", (0, 0), (-1, -1), 12),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ])
    )
    story.append(portada_table)
    story.append(Spacer(1, 0.8 * cm))
    story.append(Paragraph("Documento preliminar para apoyo al analisis geotecnico y elaboracion de criterios de diseno.", styles["BodyText"]))
    story.append(PageBreak())

    # 2. Datos generales del proyecto
    story.append(Paragraph("2. Datos generales del proyecto", styles["Heading1"]))
    datos_generales = [
        ["Campo", "Valor"],
        ["Proyecto", payload.config.project],
        ["Sondeo", payload.config.borehole],
        ["Numero de estratos", str(result.summary.layer_count)],
        ["Profundidad total evaluada", f"{result.summary.total_depth_m:.2f} m"],
        ["Nivel freatico", f"{payload.config.water_table:.2f} m" if payload.config.water_table is not None else "No reportado"],
        ["Ancho de cimentacion B", f"{payload.config.footing_width_m:.2f} m"],
        ["Profundidad de desplante Df", f"{payload.config.foundation_depth_m:.2f} m"],
        ["Factor de seguridad", f"{payload.config.bearing_safety_factor:.2f}"],
        ["Relacion de energia", f"{payload.config.energy_ratio_percent:.1f} %"],
    ]
    datos_table = Table(datos_generales, colWidths=[6 * cm, 9 * cm])
    datos_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173f7a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c9d4e5")),
            ("BACKGROUND", (0, 1), (-1, -1), colors.whitesmoke),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("LEADING", (0, 0), (-1, -1), 11),
        ])
    )
    story.append(datos_table)
    story.append(Spacer(1, 0.35 * cm))

    # 3. Resumen ejecutivo
    story.append(Paragraph("3. Resumen ejecutivo", styles["Heading1"]))
    summary_data = [
        ["Parametro", "Valor"],
        ["Numero de estratos", str(result.summary.layer_count)],
        ["Profundidad total", f"{result.summary.total_depth_m:.2f} m"],
        ["N60 promedio", f"{result.summary.n60_avg:.1f}"],
        ["(N1,60)* promedio", f"{result.summary.n160_avg:.1f}"],
        ["Es promedio", f"{result.summary.es_avg_mpa:.1f} MPa"],
        ["ks promedio", f"{result.summary.ks_avg_mn_m3:.1f} MN/m3"],
        ["qadm empirica promedio", f"{result.summary.qa_emp_avg_kpa:.1f} kPa"],
        ["qadm semiempirica promedio", f"{result.summary.qa_semi_avg_kpa:.1f} kPa"],
    ]
    if result.summary.phi_avg_deg is not None:
        summary_data.append(["phi' promedio", f"{result.summary.phi_avg_deg:.1f} deg"])
    if result.summary.su_avg_kpa is not None:
        summary_data.append(["Su promedio", f"{result.summary.su_avg_kpa:.1f} kPa"])

    summary_table = Table(summary_data, colWidths=[7 * cm, 8 * cm])
    summary_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173f7a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9d4e5")),
            ("BACKGROUND", (0, 1), (-1, -1), colors.whitesmoke),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("LEADING", (0, 0), (-1, -1), 11),
        ])
    )
    story.append(summary_table)
    story.append(Spacer(1, 0.35 * cm))

    # 4. Perfil estratigrafico (tabla)
    story.append(Paragraph("4. Perfil estratigrafico", styles["Heading1"]))
    perfil_data = [["Estrato", "Prof. (m)", "Familia", "Suelo", "Descripcion", "Observaciones"]]
    for layer in result.layers:
        perfil_data.append([
            str(layer.idx),
            f"{layer.top:.2f}-{layer.bottom:.2f}",
            "Granular" if layer.family == "sand" else "Cohesivo",
            layer.soil,
            layer.description or "-",
            layer.observations or "-",
        ])
    perfil_table = Table(
        perfil_data,
        colWidths=[1.2 * cm, 2.3 * cm, 2.1 * cm, 1.5 * cm, 4.0 * cm, 4.0 * cm],
    )
    perfil_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f62fe")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#c9d4e5")),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("LEADING", (0, 0), (-1, -1), 10),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f6f9ff")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ])
    )
    story.append(perfil_table)
    story.append(Spacer(1, 0.35 * cm))

    # 5. Parametros geotecnicos
    story.append(Paragraph("5. Parametros geotecnicos", styles["Heading1"]))
    parametros_data = [["Estrato", "N", "N60", "(N1,60)*", "gamma", "phi'/Su", "Es", "M", "ks", "qadm emp", "qadm semi", "Clasificacion"]]
    for layer in result.layers:
        parametros_data.append([
            str(layer.idx),
            f"{layer.n_raw:.1f}",
            f"{layer.n60:.1f}",
            f"{layer.n160_star:.1f}",
            f"{layer.gamma:.1f}",
            f"{layer.phi_deg:.1f} deg" if layer.phi_deg is not None else f"{layer.su_kpa:.1f} kPa",
            f"{layer.es_mpa:.1f}",
            f"{layer.m_mpa:.1f}",
            f"{layer.ks_mn_m3:.1f}",
            f"{layer.qa_emp_kpa:.1f}",
            f"{layer.qa_semi_kpa:.1f}",
            layer.classification,
        ])
    parametros_table = Table(
        parametros_data,
        colWidths=[0.9 * cm, 1.0 * cm, 1.1 * cm, 1.5 * cm, 1.1 * cm, 1.8 * cm, 1.1 * cm, 1.1 * cm, 1.1 * cm, 1.4 * cm, 1.5 * cm, 1.8 * cm],
    )
    parametros_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173f7a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#c9d4e5")),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("LEADING", (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fbff")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ])
    )
    story.append(parametros_table)
    story.append(Spacer(1, 0.35 * cm))

    # 6. Graficos
    story.append(Paragraph("6. Graficos", styles["Heading1"]))
    story.append(Paragraph("Estratos y correlacion de N de campo, N60 y (N1,60)* con la profundidad.", styles["BodyText"]))
    story.append(Spacer(1, 0.15 * cm))
    story.append(build_spt_chart(result.layers))
    story.append(Spacer(1, 0.35 * cm))

    # 7. Interpretacion automatica
    story.append(Paragraph("7. Interpretacion automatica", styles["Heading1"]))
    add_bullet_paragraphs(story, interpretation, styles["BodyText"])
    story.append(Spacer(1, 0.25 * cm))

    # 8. Conclusiones
    story.append(Paragraph("8. Conclusiones", styles["Heading1"]))
    add_bullet_paragraphs(story, conclusions, styles["BodyText"])
    story.append(Spacer(1, 0.25 * cm))

    # 9. Recomendaciones
    story.append(Paragraph("9. Recomendaciones", styles["Heading1"]))
    add_bullet_paragraphs(story, recommendations, styles["BodyText"])

    doc.build(story, onFirstPage=draw_brand_watermark, onLaterPages=draw_brand_watermark)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="reporte_{download_name}.pdf"'},
    )
