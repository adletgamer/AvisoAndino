# Prompt 04: Frontend de registro y confirmación (Codex o Cursor)

---
Contexto: **Aviso Andino**. Lee `AGENTS.md`, `docs/API.md` y `docs/RULES.md` §3 y §5. App en `apps/web` (Vite + React 19 + TS + react-leaflet 5 + Leaflet 1.9, teselas OSM con atribución). Todo en **español sencillo**, mobile-first, alto contraste, funciona en pantallas de 360 px y en conexiones lentas (bundle < 300 KB gzip sin contar Leaflet).

## Páginas (React Router o un router hash mínimo)
1. `/` **Inicio**: una frase ("Recibe en tu celular los avisos oficiales de SENAMHI para tu colegio"), 3 pasos ilustrados, botones "Registrarme" y "Ver panel público", y la nota "Solo avisos oficiales. La IA no decide."
2. `/registro`:
   - **Buscar mi colegio**: input con debounce de 400 ms → consulta directa (CORS verificado) a `https://geosinpad.indeci.gob.pe/indeci/rest/services/SIRAIM/SDE_IE_ESCALE_MINEDU/MapServer/0/query` con `where=CEN_EDU LIKE '%<texto>%' AND D_ESTADO='Activo'` (o `COD_MOD='<7 dígitos>'`), `outFields=COD_MOD,CEN_EDU,D_NIV_MOD,CEN_POB,D_DIST,D_PROV,D_DPTO,NLAT_IE,NLONG_IE`, `resultRecordCount=10`, `returnGeometry=false` y `f=json`. **Escapa comillas simples** del input (`'` → `''`) y limita a letras, números y espacios. **No pidas ni muestres** `DIRECTOR`, `TELEFONO` ni `EMAIL`. Fixture: `fixtures/minedu-schools-search.puno.sample.json`.
   - **O poner un pin**: mapa centrado en Perú, clic o botón "Usar mi ubicación" (geolocalización del navegador).
   - Canal: **SMS** (celular +51 9XXXXXXXX, con aviso "En esta etapa piloto solo podemos enviar SMS a números habilitados"), **Telegram** (recomendado para probar) o **Solo ver simulación**.
   - Nivel mínimo: "Solo NARANJA y ROJO (recomendado)" o "También AMARILLO". Fenómenos con checkboxes (default: heladas, friaje, lluvias, nevada).
   - Checkbox obligatorio de consentimiento (Ley 29733): finalidad, conservación de 180 días y cómo darse de baja. Honeypot oculto `website`.
   - **Vista previa del SMS** en vivo usando `@aviso/core` `render()` (el mismo código que el backend) con el contador "N/160, 1 SMS".
   - Resultado: pantalla de éxito según `next` (deep link de Telegram, "revisa tu SMS" o "listo").
3. `/c/:code` **Confirmación**: `GET /api/confirm/:code` → tarjeta grande con el color del nivel, título oficial, fechas, lugar, Tmin, recomendaciones y el enlace a SENAMHI → botón grande **"Recibí el aviso"** (`POST /api/confirm`) → "¡Gracias! Comparte con otras familias". Si ya estaba confirmado, lo indica. 404 amigable.
4. `/b/:code` **Baja** con confirmación.
5. Footer: "Datos: SENAMHI, INDECI GeoSINPAD, MINEDU ESCALE · Weather data by Open-Meteo.com (CC BY 4.0) · Mapa © OpenStreetMap", enlace al repo y aviso de proyecto de hackathon (no oficial).

## Técnica
- `VITE_API_BASE` (default `/api`). Cliente fetch tipado con los schemas zod de `@aviso/core`. Manejo de errores 400/409/422/429 con mensajes humanos.
- Accesibilidad: labels, foco visible, contraste AA y `lang="es"`. Los colores de nivel siempre van acompañados de su texto (AMARILLO/NARANJA/ROJO).
- Tests: Vitest + Testing Library para el formulario (validación del teléfono, consentimiento obligatorio, preview ≤160) y la página de confirmación (GET no confirma, el botón sí).
- Build `pnpm --filter @aviso/web build` → `apps/web/dist`, desplegado por el `BucketDeployment` de CDK.

## Criterios de aceptación
- Desde un celular real: registrarse con Telegram o SIMULATED en < 60 s, y abrir `/c/:code` de un envío y confirmar.
- Lighthouse móvil: Performance ≥ 80 y Accessibility ≥ 90 (captura).
- Tests en verde. Desplegado en la URL pública de CloudFront (vía agente).
