# Frontend React - SPT Report Pro

## Instalar
```bash
npm install
```

## Ejecutar
```bash
npm run dev
```

La app se abrira en `http://127.0.0.1:5173`.

## Acceso con Google
La app usa Firebase Authentication con Google Sign-In y una lista blanca de correos definida en `src/App.jsx`.

## Variables de entorno
Crea un archivo `.env` tomando como base `.env.example`:

```bash
VITE_FIREBASE_API_KEY=tu_api_key
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_APP_ID=tu_app_id
```

## Configuracion en Firebase
1. Crea un proyecto en Firebase.
2. En `Authentication > Sign-in method`, habilita `Google`.
3. En `Authentication > Settings > Authorized domains`, agrega tu dominio de Vercel.
4. En `Project settings`, copia los valores web de Firebase y pegalos en las variables `VITE_FIREBASE_*`.

## Configuracion en Vercel
Agrega las mismas variables `VITE_FIREBASE_*` en el proyecto de Vercel y vuelve a desplegar.
