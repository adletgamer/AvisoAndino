# Reglas deterministas: qué se envía, a quién y cuándo

Todo lo que sigue es **código puro y testeado** en `packages/core` (sin llamadas de red ni LLM). Si una regla cambia, cambian primero sus tests.

## 1. Entradas normalizadas

```ts
type Level = 1 | 2 | 3 | 4;               // "Nivel N" → N. 1 = verde = NO es aviso
type Hazard = 'HELADA' | 'LLUVIA' | 'FRIAJE' | 'NEVADA' | 'LLOVIZNA' | 'CALOR' | 'VIENTO' | 'DESCONOCIDO';
interface WarningArea { level: Level; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; bbox: [number,number,number,number] }
interface NormalizedWarning {
  warningId: string;        // "SENAMHI#2026#388#2"  (fuente#año#nro#mapa)
  source: 'SENAMHI_WFS' | 'INDECI_PP24H' | 'REPLAY';
  year: number; nroAviso: number; mapa: number;
  codFen: number; hazard: Hazard; title: string;     // título de la lista SENAMHI
  fechaEmi: string; fechIni: string; fechFin: string; // ISO UTC
  areas: WarningArea[];
  contentHash: string;      // sha256(level+fechas+geometría redondeada a 4 decimales)
}
```

**Mapa `cod_fen` (+ título) → `hazard`** (inferido el 28-sep-2026, ver RESEARCH.md §1B; `parseInt` porque llega como "1" o "01"). Firma: `hazardOf(codFen, title)`:

| cod_fen | hazard | ¿habilitado por defecto? |
|---|---|---|
| 7 | "Descenso de temperatura": **HELADA** si el título contiene `NOCTURNA`; **FRIAJE** si contiene `DIURNA` o `FRIAJE` (p. ej. aviso 247/2026) | **Sí** |
| 2 | FRIAJE (lluvia en la selva/friaje) | **Sí** |
| 1 | LLUVIA (precipitaciones) | **Sí** |
| 4 | NEVADA | **Sí** |
| 3 | LLOVIZNA | No |
| 5 | CALOR (temperatura diurna) | No (opt-in) |
| 10 | VIENTO | No (opt-in) |
| otro | DESCONOCIDO | **No se envía**; se registra `WARN unknown_cod_fen` y aparece en el dashboard para revisión |

Fallback INDECI capa 5 (PP24H): `hazard = LLUVIA`, `nroAviso = 0`, `warningId = INDECI#PP24H#<FECHA yyyy-mm-dd>`, vigencia = `FECHA` 00:00 a 23:59 hora Lima. **No se usa su `DESCRIPCIO`** (trae el texto de quebradas).

## 2. Matching (por suscriptor)

1. **Elegibilidad**: `status == ACTIVE`, canal habilitado y `hazard ∈ subscriber.hazards` (por defecto `[HELADA, FRIAJE, LLUVIA, NEVADA]`).
2. **Vigencia**: `now < fechFin`. No se envían avisos vencidos, salvo en modo replay, que usa un reloj simulado.
3. **Geometría**: prefiltro `bbox` y después `booleanPointInPolygon([lon, lat], area.geometry)` de `@turf/boolean-point-in-polygon` (el borde cuenta como dentro, `ignoreBoundary: false`). Coordenadas en **[lon, lat] EPSG:4326**.
4. **Nivel efectivo** = **máximo** `level` de las áreas que contienen el punto (los polígonos de SENAMHI se solapan). Si ningún área lo contiene → nivel 1.
5. **Umbral**: se envía si `nivelEfectivo >= subscriber.minLevel`. **Default `minLevel = 3` (NARANJA)**. Nivel 2 (AMARILLO) es opt-in: en la sierra es casi diario en invierno y cada SMS cuesta USD 0,23. **Nivel 1 nunca se envía.**
6. **Agregación por aviso**: un aviso tiene hasta 3 mapas (días). Para un suscriptor se toma el máximo nivel entre los mapas vigentes y el rango de fechas en que aplica (p. ej. `30/09-02/10`). **Un solo SMS por aviso**, no uno por día.
7. **Dedup / idempotencia**: `deliveryId = ${subscriberId}#${year}#${nroAviso}#L${nivel}`, con `PutItem` y `ConditionExpression: attribute_not_exists(deliveryId)`.
   - Mismo aviso y mismo nivel → nunca se repite.
   - **Escalamiento**: si un mapa posterior sube el nivel (2→3 o 3→4) y ya se había enviado un nivel menor → se envía **una** actualización con plantilla `SUBE_NIVEL`.
   - Si baja el nivel → no se envía nada.
   - Si SENAMHI **extiende** el aviso con un número nuevo ("EXTENSIÓN DEL AVISO 375") → se trata como aviso nuevo. Si el suscriptor recibió el anterior hace menos de 24 h con el mismo nivel, se omite (regla `EXTENSION_SUPPRESS`, detectada por la palabra "EXTENSI" en el título).
8. **Horario de silencio** (hora Lima): **nivel 2** no se envía entre 21:00 y 05:59; se reprograma para las 06:00 (SQS `DelaySeconds`, máximo 15 min, o un EventBridge Scheduler one-time). **Niveles 3 y 4 se envían siempre.**
9. **Topes de costo**: máximo **3 SMS por suscriptor por día** y **N global por día** (`SMS_DAILY_CAP`, default 30). Superado el tope → el canal se degrada a `SIMULATED` o Telegram y se registra `capped=true`. Nunca se descarta en silencio.
10. **Open-Meteo solo enriquece**: si `hazard == HELADA` y hay pronóstico, se añade la `Tmin` mínima de los días del aviso para el punto (redondeada a entero). **Open-Meteo nunca crea una alerta.** El modo "pre-aviso por modelo" queda como feature flag `MODEL_PREALERT=false`. Si alguien lo activa, el mensaje debe decir "PRONOSTICO MODELO (no oficial)" y solo va al canal SIMULADO/Telegram.

## 3. Plantillas SMS (GSM-7, máximo 160 caracteres)

**Regla de codificación**: los SMS se sanean a **GSM-7**. Se quitan tildes `á í ó ú Á Í Ó Ú` → `a i o u A I O U` (la `é`, `É`, `ñ` y `Ñ` sí existen en GSM-7, pero para simplificar se normaliza todo a ASCII salvo `ñ/Ñ`). Un solo carácter fuera de GSM-7 convierte el mensaje a UCS-2: 70 caracteres por segmento, 3 segmentos y el triple de costo (USD 0,23 cada uno a Perú). El test `gsm7.test.ts` falla si alguna plantilla renderizada no es GSM-7 o pasa de 160.

Valores del peor caso usados para contar: `COLOR=AMARILLO` (8), `fechas=30/09-02/10` (11), `lugar` truncado a 18, `tmin=-12`, `link=d111111abcdef8.cloudfront.net/c/K7P2QX` (38, sin `https://`; los teléfonos lo enlazan igual).

| id | plantilla | máx. |
|---|---|---|
| `HELADA` | `SENAMHI {COLOR}: heladas {fechas} en {lugar}. Min prevista {tmin}C. Abrigue a ninos y animales. Confirme: {link}` | **156** |
| `HELADA_SIN_TMIN` | `SENAMHI {COLOR}: heladas {fechas} en {lugar}. Abrigue a ninos y animales. Confirme: {link}` | 137 |
| `LLUVIA` | `SENAMHI {COLOR}: lluvias fuertes {fechas} en {lugar}. Cuidado con huaicos y rios. Confirme: {link}` | 145 |
| `FRIAJE` | `SENAMHI {COLOR}: friaje y lluvias {fechas} en {lugar}. Abrigue a los ninos. Confirme: {link}` | 139 |
| `NEVADA` | `SENAMHI {COLOR}: nevada {fechas} en {lugar}. Proteja a ninos y animales. Confirme: {link}` | 136 |
| `GENERICO` | `SENAMHI {COLOR}: aviso {nro} {fechas} en {lugar}. Siga a sus autoridades. Confirme: {link}` | 135 |
| `SUBE_NIVEL` | `SENAMHI SUBE a {COLOR}: aviso {nro} {fechas} en {lugar}. Extreme cuidado. Confirme: {link}` | 135 |
| `BIENVENIDA` | `Aviso Andino: registro OK para {lugar}. Le avisaremos solo con avisos oficiales SENAMHI. Baja: {link}` | 144 |

- `COLOR`: 2→`AMARILLO`, 3→`NARANJA`, 4→`ROJO`.
- `fechas`: `dd/mm` si es un solo día o `dd/mm-dd/mm`, en hora Lima (`fechIni` 05:00Z = 00:00 Lima).
- `lugar`: `centroPoblado` o, si no hay, el distrito; saneado a GSM-7 y truncado a 18 caracteres sin cortar palabras si se puede.
- Telegram y SIMULADO pueden usar la versión larga (hasta 600 caracteres, con recomendaciones oficiales y el enlace a SENAMHI) y un botón inline "1 ✅ Recibí".

## 4. Reescritura con Bedrock (opcional, nunca decide)

- `REWRITE_ENABLED` (SSM) viene en `false` por defecto. Modelo `us.amazon.nova-micro-v1:0`, `temperature 0.2`, `maxTokens 120`, timeout 3 s.
- Entrada: hechos ya decididos (`COLOR`, `fechas`, `lugar`, `tmin?`, `hazard`) + título oficial + texto oficial recortado. Instrucción: español sencillo y cálido, sin tildes, máximo `160 - len(" Confirme: "+link)` caracteres, **sin añadir datos**.
- **Validador determinista** (si falla cualquier punto → plantilla, métrica `RewriteFallback`):
  1. saneado GSM-7 y longitud total ≤ 160;
  2. contiene `SENAMHI` y la palabra exacta de `COLOR`;
  3. contiene el string `fechas` exacto;
  4. todos los números del texto ⊂ números de los hechos (no inventa temperaturas ni fechas);
  5. no contiene URLs (el enlace lo añade el código);
  6. sin palabras de la lista negra (`no hay peligro`, `cancelado`, `tranquilo`…).
- La reescritura se cachea por `warningId#hazard#COLOR#fechas` y se reutiliza para todos los suscriptores de ese aviso.

## 5. Confirmación

- `confirmCode`: 6 caracteres de Crockford base32 (sin I, L, O, U), aleatorio y único (GSI). Expira con el TTL de Delivery (30 días).
- `GET /c/:code` **solo muestra** el aviso. La confirmación exige un `POST` (botón), porque los previsualizadores de enlaces (WhatsApp, iMessage) hacen GET.
- Telegram: respuesta `1`, `si` o `sí` (normalizada) o el botón inline → confirma la **última** delivery no confirmada de ese chat en las últimas 72 h.
- `%confirmado = confirmadas / enviadas`. Las SIMULATED se cuentan aparte.

## 6. Métricas (definiciones exactas)

- **alertas enviadas**: Deliveries `status ∈ {SENT, DELIVERED}` por canal.
- **minutos detección→envío**: `sentAt - warning.firstSeenAt` (mediana y p90). También se muestra **publicación→envío** como `sentAt - fechaEmi(00:00 Lima)`, marcando que SENAMHI solo publica la fecha y no la hora; es una cota superior.
- **% confirmado**: definido arriba.
- **cobertura**: suscriptores activos por departamento.

## 7. Casos de prueba (con fixtures reales)

Puntos: Puno ciudad (−70.02, −15.84), Huancavelica (−74.97, −12.79), Lima (−77.03, −12.05), Cusco (−71.97, −13.53), Iquitos (−73.25, −3.75). Niveles esperados calculados con la **geometría completa** del WFS (28-sep-2026). Los fixtures `*.decimated.geojson` dan el **mismo nivel máximo** en estos puntos, aunque algún polígono individual difiera cerca de los bordes.

| # | Fixture / entrada | Suscriptor | Esperado |
|---|---|---|---|
| 1 | `senamhi-wfs-aviso.388_2_2026` (HELADA) | Huancavelica, minLevel 3 | nivel 3 → **envía `HELADA`**, COLOR=NARANJA |
| 2 | ídem | Puno, minLevel 3 | nivel 2 → **no envía** (`below_min_level`) |
| 3 | ídem | Puno, minLevel 2 | nivel 2 → envía AMARILLO |
| 4 | ídem | Lima, minLevel 2 | nivel 1 → **no envía** |
| 5 | ídem | Cusco, minLevel 2 | nivel 2 → envía |
| 6 | `388_1` + `388_2` (mismo aviso, 2 días) | Huancavelica, minLevel 2 | 388_1 = N2 y 388_2 = N3 → **un** SMS N3 con fechas `30/09-01/10`, no dos |
| 7 | `383_1_2026` (LLUVIA) | Puno, minLevel 2 | nivel 2 → `LLUVIA` |
| 8 | 388_2 procesado dos veces (reentrega de SQS) | Huancavelica | segunda vez `ConditionalCheckFailed` → 0 SMS extra |
| 9 | 388 enviado N2 y luego llega un mapa con N3 | Puno, minLevel 2 | 1 SMS `SUBE_NIVEL` |
| 10 | Warning con `cod_fen=99` | cualquiera | no envía, log `unknown_cod_fen` |
| 11 | Warning vencido (`fechFin < now`) | cualquiera | no envía (salvo replay) |
| 12 | N2 a las 22:30 Lima | Puno, minLevel 2 | reprogramado a las 06:00 |
| 13 | N3 a las 22:30 Lima | Huancavelica | se envía de inmediato |
| 14 | 4.º SMS del día al mismo suscriptor | – | degradado a SIMULATED, `capped=true` |
| 15 | Render de todas las plantillas con el peor caso | – | GSM-7 y ≤ 160 |
| 16 | Rewrite de Bedrock con "−20C" cuando tmin = −12 | – | validador rechaza (número nuevo) → plantilla |
| 17 | Rewrite sin la palabra NARANJA | – | rechaza → plantilla |
| 18 | `indeci-layer5-avisopp24h...simplified.geojson`, punto (−69.5, −16.5) | minLevel 3 | nivel 3 (el oráculo del servidor INDECI también dio "Nivel 3") |
| 19 | `cod_fen` "01" vs "1" | – | ambos → LLUVIA |
| 19b | `cod_fen` 7 con título "DESCENSO DE TEMPERATURA DIURNA EN LA SELVA - CUARTO FRIAJE" | – | FRIAJE (no HELADA) |
| 19c | Replay aviso 230/2026 mapa 1, colegio 40383 Huambo (−72.108, −15.730) | minLevel 3 | nivel 3 → HELADA NARANJA (verificado con el oráculo WFS) |
| 20 | Oráculo: para los 5 puntos, nuestro PIP == `CQL_FILTER=INTERSECTS` del WFS (test de integración opcional `RUN_LIVE=1`) | – | iguales |
| 21 | GET `/c/:code` | – | no confirma; POST sí; el segundo POST es idempotente |
| 22 | Telegram "Sí" / "1" / "si " | – | confirma la última delivery pendiente |
