# SPT Report Pro v2

Versión profesional 2 para generación de reportes SPT:
- Frontend en React + Vite
- Backend en FastAPI
- Exportación PDF desde backend
- Gráfico estratigráfico en el frontend

## Estructura
- `frontend/` interfaz web
- `backend/` API y generador PDF

## Puesta en marcha rápida

### 1) Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
# En Windows PowerShell: .venv\Scripts\activate
pip install -r requirements.txt
fastapi dev app/main.py
```

### 2) Frontend
En otra terminal:
```bash
cd frontend
npm install
npm run dev
```

## Endpoints principales
- `GET /api/health`
- `POST /api/calculate`
- `POST /api/report/pdf`

## Funcionalidad incluida
- Entrada de estratos con profundidad, tipo de suelo y N de campo.
- Cálculo de N60, N*60 y (N1,60)*.
- Estimación preliminar de φ', Su, γ, Es, M y ks.
- Tabla de resultados.
- Borrador de reporte técnico.
- Exportación a PDF.
- Perfil estratigráfico básico.

## Siguiente mejora sugerida
- Logotipo institucional y plantilla PDF corporativa.
- Gráfico N corregido vs profundidad.
- Base de datos de proyectos.
- Correlaciones seleccionables por norma o autor.
