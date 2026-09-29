import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'es' | 'en';
export const LOCALES: readonly Locale[] = ['es', 'en'];
export const STORAGE_KEY = 'aviso-andino.lang';

const es = {
  meta: {
    title: 'Aviso Andino: avisos oficiales SENAMHI en tu celular',
    description: 'Recibe por SMS los avisos oficiales de SENAMHI (heladas, friaje, lluvias) para tu colegio rural.',
  },
  nav: {
    label: 'Navegación principal',
    home: 'Inicio',
    how: 'Cómo funciona',
    register: 'Registrarme',
    status: 'Estado',
    panel: 'Panel',
    demo: 'Demo',
    toggleLabel: 'Cambiar idioma: ver la página en inglés',
    skip: 'Saltar al contenido',
  },
  hero: {
    eyebrow: 'Alertas para colegios rurales del Perú',
    title: 'El aviso oficial, claro y directo al celular',
    intro: 'Convertimos avisos de SENAMHI e INDECI en mensajes breves con el nivel, los días y una recomendación práctica.',
    ctaPrimary: 'Registrar mi colegio',
    ctaSecondary: 'Conoce cómo funciona',
    sceneLabel: 'Ilustración: montañas de los Andes con un marcador de alerta',
  },
  how: {
    eyebrow: 'Cómo funciona',
    title: 'De un polígono oficial a un mensaje útil',
    steps: [
      { title: 'Revisamos', body: 'Consultamos fuentes oficiales cada 15 minutos.' },
      { title: 'Verificamos', body: 'Reglas deterministas comprueban ubicación, nivel y vigencia.' },
      { title: 'Avisamos', body: 'Preparamos un SMS GSM-7 de hasta 160 caracteres.' },
    ],
  },
  phone: {
    eyebrow: 'Demo en vivo',
    title: 'Un SMS que se entiende al primer vistazo',
    body: 'Reproduce el aviso real 230 de SENAMHI (heladas ROJO, junio 2026). Pasa por el mismo pipeline que un aviso nuevo: reglas, deduplicación, cola y envío. El teléfono muestra el SMS exacto que generó.',
    sender: 'SENAMHI · Aviso Andino',
    now: 'ahora',
    simulated: 'Simulación: no se envió ningún SMS real',
    counter: (n: number) => `${n}/160 caracteres · 1 SMS`,
    captionLabel: '',
    caption: '',
    replay: 'Ver llegar de nuevo',
    deviceLabel: 'Teléfono simulado mostrando un SMS de aviso',
  },
  principle: {
    eyebrow: 'Principio de seguridad',
    title: 'La IA no decide una alerta',
    body: 'Quién recibe un aviso, cuándo y con qué nivel se determina únicamente con datos oficiales y código probado. La reescritura con IA está apagada por defecto.',
  },
  status: {
    eyebrow: 'Estado del servicio',
    title: 'MVP preparado para despliegue',
    api: 'API',
    available: 'Disponible',
    ingest: 'Ingesta real',
    active: 'Activa',
    paused: 'Pausada',
    sms: 'SMS real',
    smsActive: 'Activo',
    safeMode: 'Modo seguro',
    checking: 'Comprobando la API…',
    error: 'La API se habilitará al desplegar la stack.',
    updated: 'Actualizado',
  },
  register: {
    eyebrow: 'Registro',
    title: 'Registra tu colegio',
    intro: 'Solo te escribiremos cuando SENAMHI emita un aviso oficial para tu zona.',
    channel: 'Canal',
    channels: { SIMULATED: 'Solo ver simulación', TELEGRAM: 'Telegram (recomendado para probar)', SMS: 'SMS' },
    smsNote: 'En esta etapa piloto solo podemos enviar SMS a números habilitados. El SMS es de una sola vía: para confirmar, abre el enlace del mensaje y toca «Recibí el aviso».',
    telegramNote: 'En Telegram puedes confirmar respondiendo 1 o tocando el botón del mensaje.',
    phone: 'Celular',
    phoneHint: 'Formato +51 9XXXXXXXX',
    phoneError: 'Escribe un celular peruano: +51 seguido de 9 y 8 dígitos.',
    location: 'Ubicación del colegio',
    place: 'Centro poblado o colegio',
    lat: 'Latitud',
    lon: 'Longitud',
    useLocation: 'Usar mi ubicación',
    locationError: 'La ubicación debe estar dentro del Perú.',
    level: 'Nivel mínimo',
    levels: { 3: 'Solo NARANJA y ROJO (recomendado)', 2: 'También AMARILLO' },
    hazards: 'Fenómenos',
    hazardNames: { HELADA: 'Heladas', FRIAJE: 'Friaje', LLUVIA: 'Lluvias', NEVADA: 'Nevada' },
    consent: 'Acepto recibir avisos. Usaremos tu dato solo para esto, lo guardamos 180 días y puedes darte de baja con el enlace de cada mensaje (Ley 29733).',
    consentError: 'Necesitamos tu consentimiento para registrarte.',
    preview: 'Vista previa del SMS de bienvenida',
    submit: 'Registrarme',
    sending: 'Enviando…',
    success: '¡Listo! Tu registro quedó guardado.',
    successSimulated: '¡Listo! Quedaste registrado en modo solo simulación (nunca te enviaremos un SMS).',
    successTelegram: 'Casi listo: abre Telegram para activar tu registro.',
    openTelegram: 'Abrir Telegram',
    tryDemo: 'Ver tu SMS en la demo',
    smsNotAvailable: 'Por ahora el SMS solo llega a números verificados. Usa Telegram o el modo solo simulación.',
    alreadyRegistered: 'Este número ya está registrado.',
    unavailable: 'El registro todavía no está habilitado en este piloto. Vuelve pronto.',
    failed: 'No pudimos registrarte. Inténtalo de nuevo en unos minutos.',
  },
  confirm: {
    eyebrow: 'Confirmación',
    loading: 'Buscando el aviso…',
    notFound: 'No encontramos este aviso o el enlace ya venció.',
    level: 'Nivel',
    dates: 'Fechas',
    place: 'Lugar',
    tmin: 'Temperatura mínima',
    recommendations: 'Recomendaciones',
    official: 'Ver el aviso oficial en SENAMHI',
    button: 'Recibí el aviso',
    thanks: '¡Gracias! Comparte el aviso con otras familias.',
    already: 'Este aviso ya estaba confirmado.',
    error: 'No pudimos confirmar ahora. Inténtalo otra vez.',
  },
  demo: {
    button: 'Reproducir aviso 230 (heladas, jun 2026)',
    buttonBusy: 'Procesando…',
    buttonAgain: 'Reproducir otra vez',
    running: (s: number) => `Procesando en el pipeline real… ${s} s`,
    sampleNote: 'Ejemplo con la plantilla real. Presiona el botón para generar el SMS con el pipeline.',
    hint: 'Solo simulación: nunca se envía un SMS real desde este botón. Regístrate en modo simulación para ver tu propio SMS.',
    hintRegistered: 'Incluye tu registro de solo simulación: si tu ubicación está en la zona del aviso, verás tu propio SMS.',
    visitorMissing: 'Tu ubicación no está en la zona de este aviso (o el nivel es menor al que elegiste); mostramos el SMS del colegio demo 40383 de Huambo.',
    limited: 'Se alcanzó el límite diario de demos. Intenta mañana.',
    failed: 'No pudimos iniciar la demo. Inténtalo otra vez.',
    empty: 'El pipeline no generó un SMS a tiempo. Revisa el panel o inténtalo otra vez.',
    simNote: 'Simulación: no se envió ningún SMS real',
    realNote: (phone: string) => `SMS real enviado a ${phone}`,
    replayLabel: 'Replay (aviso histórico)',
    metaRun: 'Tipo',
    metaLatency: 'Latencia desde el inicio del replay',
    metaSimNow: 'Hora simulada del aviso',
    metaTarget: 'Destinatario',
    targetMine: 'Tu registro (simulación)',
    targetSeed: 'Colegio demo 40383, Huambo',
    panelLink: 'Ver métricas en el panel',
  },
  panel: {
    eyebrow: 'Panel',
    title: 'Métricas reales',
    intro: 'Datos leídos de DynamoDB en este momento. Sin números de ejemplo: si algo no ha pasado, se muestra vacío.',
    refresh: 'Actualizar',
    updated: 'Actualizado',
    loading: 'Cargando…',
    error: 'No pudimos cargar el panel.',
    warningTitle: 'Aviso del último replay',
    noWarning: 'Todavía no se ha ejecutado ningún replay.',
    avisoLabel: 'Aviso',
    issued: 'Emitido',
    validity: 'Vigencia',
    maxLevel: 'Nivel máximo',
    dataSource: 'Datos',
    sourceSnapshot: 'Snapshot oficial SENAMHI guardado en el repo',
    sourceOfficial: 'Descargado de SENAMHI (WFS + lista)',
    simulatedNow: 'Hora simulada',
    productionTitle: 'Producción (avisos nuevos)',
    productionNote: 'Latencia de publicación → SMS. SENAMHI publica solo la fecha de emisión, así que es una cota superior.',
    productionEmpty: 'Aún no hay envíos de producción: la ingesta automática está apagada.',
    replayTitle: 'Demo con avisos históricos',
    replayNote: 'La latencia se mide desde que se presiona «Reproducir» hasta que el sender entrega el mensaje. No se mezcla con producción.',
    replayEmpty: 'Todavía no hay mensajes de replay.',
    sent: 'Enviados',
    confirmed: 'Confirmados',
    confirmedPct: '% confirmación',
    latencyPublication: 'Latencia publicación → SMS',
    latencyReplay: 'Latencia replay (inicio → envío)',
    realSms: 'SMS reales',
    colTime: 'Hora (Lima)',
    colPlace: 'Lugar',
    colLevel: 'Nivel',
    colChannel: 'Canal',
    colPhone: 'Teléfono',
    colStatus: 'Estado',
    colLatency: 'Latencia',
    colLatencyReplay: 'Latencia replay',
    colConfirmed: 'Confirmó',
    channels: { SMS: 'SMS (simulado)', SIMULATED: 'Simulado', TELEGRAM: 'Telegram' } as Record<string, string>,
    channelRealSms: 'SMS real',
    simulatedPhone: 'simulado',
    statuses: { PENDING: 'En cola', SCHEDULED: 'Programado', SENDING: 'Enviando', SENT: 'Enviado', DELIVERED: 'Entregado', FAILED: 'Falló' },
    runsTitle: (n: number) => `Últimos ${n} replays`,
    modeReal: 'con SMS real',
    modeSim: 'solo simulación',
    subscribers: (active: number, sim: number, sms: number) =>
      `Registros activos: ${active} (solo simulación: ${sim}, SMS: ${sms}). No incluye el colegio demo.`,
  },
  notFound: { title: 'Página no encontrada', back: 'Volver al inicio' },
  footer: {
    data: 'Datos: SENAMHI, INDECI GeoSINPAD y MINEDU ESCALE · Proyecto de hackathon, no oficial.',
    repo: 'Código en GitHub',
  },
};

export type Dictionary = typeof es;

const en: Dictionary = {
  meta: {
    title: 'Aviso Andino: official SENAMHI warnings on your phone',
    description: 'Get official SENAMHI weather warnings (frost, cold spells, heavy rain) by SMS for your rural school.',
  },
  nav: {
    label: 'Main navigation',
    home: 'Home',
    how: 'How it works',
    register: 'Sign up',
    status: 'Status',
    panel: 'Dashboard',
    demo: 'Demo',
    toggleLabel: 'Change language: view the page in Spanish',
    skip: 'Skip to content',
  },
  hero: {
    eyebrow: 'Alerts for rural schools in Peru',
    title: 'The official warning, clear and straight to your phone',
    intro: 'We turn SENAMHI and INDECI warnings into short messages with the level, the dates and one practical recommendation.',
    ctaPrimary: 'Register my school',
    ctaSecondary: 'See how it works',
    sceneLabel: 'Illustration: Andes mountains with an alert marker',
  },
  how: {
    eyebrow: 'How it works',
    title: 'From an official polygon to a useful message',
    steps: [
      { title: 'We check', body: 'We query official sources every 15 minutes.' },
      { title: 'We verify', body: 'Deterministic rules check location, level and validity.' },
      { title: 'We alert', body: 'We prepare a GSM-7 SMS of up to 160 characters.' },
    ],
  },
  phone: {
    eyebrow: 'Live demo',
    title: 'An SMS you understand at a glance',
    body: 'Replay real SENAMHI warning 230 (RED frost, June 2026). It runs through the same pipeline as a new warning: rules, deduplication, queue and sender. The phone shows the exact SMS it produced (in Spanish, without accents, one SMS).',
    sender: 'SENAMHI · Aviso Andino',
    now: 'now',
    simulated: 'Simulation: no real SMS was sent',
    counter: (n: number) => `${n}/160 characters · 1 SMS`,
    captionLabel: 'English translation (the SMS itself is sent in Spanish):',
    caption: 'SENAMHI ORANGE: frost 30/09–01/10 in CHARAMAYA. Forecast low −9 °C. Keep children and animals warm. Confirm: <link>',
    replay: 'Watch it arrive again',
    deviceLabel: 'Simulated phone showing a warning SMS',
  },
  principle: {
    eyebrow: 'Safety principle',
    title: 'AI never decides an alert',
    body: 'Who gets a warning, when and at what level is decided only by official data and tested code. AI rewriting is off by default.',
  },
  status: {
    eyebrow: 'Service status',
    title: 'MVP ready for deployment',
    api: 'API',
    available: 'Available',
    ingest: 'Live ingestion',
    active: 'Active',
    paused: 'Paused',
    sms: 'Real SMS',
    smsActive: 'Active',
    safeMode: 'Safe mode',
    checking: 'Checking the API…',
    error: 'The API will be enabled once the stack is deployed.',
    updated: 'Updated',
  },
  register: {
    eyebrow: 'Sign up',
    title: 'Register your school',
    intro: 'We only write when SENAMHI issues an official warning for your area.',
    channel: 'Channel',
    channels: { SIMULATED: 'Simulation only', TELEGRAM: 'Telegram (recommended for testing)', SMS: 'SMS' },
    smsNote: 'During this pilot we can only send SMS to approved numbers. SMS is one-way: to confirm, open the link in the message and tap “I received the warning”.',
    telegramNote: 'On Telegram you can confirm by replying 1 or tapping the button in the message.',
    phone: 'Mobile number',
    phoneHint: 'Format +51 9XXXXXXXX',
    phoneError: 'Enter a Peruvian mobile: +51 followed by 9 and 8 digits.',
    location: 'School location',
    place: 'Village or school name',
    lat: 'Latitude',
    lon: 'Longitude',
    useLocation: 'Use my location',
    locationError: 'The location must be inside Peru.',
    level: 'Minimum level',
    levels: { 3: 'Only ORANGE and RED (recommended)', 2: 'Also YELLOW' },
    hazards: 'Hazards',
    hazardNames: { HELADA: 'Frost', FRIAJE: 'Cold spell (friaje)', LLUVIA: 'Heavy rain', NEVADA: 'Snowfall' },
    consent: 'I agree to receive warnings. Your data is used only for this, kept for 180 days, and you can unsubscribe with the link in every message (Peru Law 29733).',
    consentError: 'We need your consent to register you.',
    preview: 'Welcome SMS preview (sent in Spanish)',
    submit: 'Sign up',
    sending: 'Sending…',
    success: 'Done! Your registration was saved.',
    successSimulated: 'Done! You are registered in simulation-only mode (we will never send you an SMS).',
    successTelegram: 'Almost there: open Telegram to activate your registration.',
    openTelegram: 'Open Telegram',
    tryDemo: 'See your SMS in the demo',
    smsNotAvailable: 'For now SMS only reaches verified numbers. Use Telegram or simulation-only mode.',
    alreadyRegistered: 'This number is already registered.',
    unavailable: 'Sign-up is not enabled in this pilot yet. Please come back soon.',
    failed: 'We could not register you. Please try again in a few minutes.',
  },
  confirm: {
    eyebrow: 'Confirmation',
    loading: 'Looking up the warning…',
    notFound: 'We could not find this warning or the link has expired.',
    level: 'Level',
    dates: 'Dates',
    place: 'Place',
    tmin: 'Minimum temperature',
    recommendations: 'Recommendations',
    official: 'See the official SENAMHI warning',
    button: 'I received the warning',
    thanks: 'Thank you! Share the warning with other families.',
    already: 'This warning was already confirmed.',
    error: 'We could not confirm right now. Please try again.',
  },
  demo: {
    button: 'Replay warning 230 (frost, Jun 2026)',
    buttonBusy: 'Processing…',
    buttonAgain: 'Replay again',
    running: (s: number) => `Running through the real pipeline… ${s} s`,
    sampleNote: 'Example with the real template. Press the button to generate the SMS with the pipeline.',
    hint: 'Simulation only: this button never sends a real SMS. Sign up in simulation mode to see your own SMS.',
    hintRegistered: 'Includes your simulation-only registration: if your location is inside the warning area, you will see your own SMS.',
    visitorMissing: 'Your location is outside this warning area (or below the level you chose); showing the SMS for demo school 40383 in Huambo.',
    limited: 'The daily demo limit was reached. Please try tomorrow.',
    failed: 'We could not start the demo. Please try again.',
    empty: 'The pipeline did not produce an SMS in time. Check the dashboard or try again.',
    simNote: 'Simulation: no real SMS was sent',
    realNote: (phone: string) => `Real SMS sent to ${phone}`,
    replayLabel: 'Replay (historical warning)',
    metaRun: 'Type',
    metaLatency: 'Latency from replay start',
    metaSimNow: 'Simulated warning time',
    metaTarget: 'Recipient',
    targetMine: 'Your registration (simulation)',
    targetSeed: 'Demo school 40383, Huambo',
    panelLink: 'See metrics on the dashboard',
  },
  panel: {
    eyebrow: 'Dashboard',
    title: 'Real metrics',
    intro: 'Read from DynamoDB right now. No sample numbers: if something has not happened yet, it stays empty.',
    refresh: 'Refresh',
    updated: 'Updated',
    loading: 'Loading…',
    error: 'We could not load the dashboard.',
    warningTitle: 'Warning in the latest replay',
    noWarning: 'No replay has run yet.',
    avisoLabel: 'Warning',
    issued: 'Issued',
    validity: 'Valid',
    maxLevel: 'Highest level',
    dataSource: 'Data',
    sourceSnapshot: 'Official SENAMHI snapshot stored in the repo',
    sourceOfficial: 'Downloaded from SENAMHI (WFS + list)',
    simulatedNow: 'Simulated time',
    productionTitle: 'Production (new warnings)',
    productionNote: 'Publication → SMS latency. SENAMHI only publishes the issue date, so this is an upper bound.',
    productionEmpty: 'No production messages yet: automatic ingestion is off.',
    replayTitle: 'Demo with historical warnings',
    replayNote: 'Latency is measured from pressing “Replay” until the sender delivers the message. Never mixed with production.',
    replayEmpty: 'No replay messages yet.',
    sent: 'Sent',
    confirmed: 'Confirmed',
    confirmedPct: 'Confirmation rate',
    latencyPublication: 'Publication → SMS latency',
    latencyReplay: 'Replay latency (start → send)',
    realSms: 'Real SMS',
    colTime: 'Time (Lima)',
    colPlace: 'Place',
    colLevel: 'Level',
    colChannel: 'Channel',
    colPhone: 'Phone',
    colStatus: 'Status',
    colLatency: 'Latency',
    colLatencyReplay: 'Replay latency',
    colConfirmed: 'Confirmed',
    channels: { SMS: 'SMS (simulated)', SIMULATED: 'Simulated', TELEGRAM: 'Telegram' } as Record<string, string>,
    channelRealSms: 'Real SMS',
    simulatedPhone: 'simulated',
    statuses: { PENDING: 'Queued', SCHEDULED: 'Scheduled', SENDING: 'Sending', SENT: 'Sent', DELIVERED: 'Delivered', FAILED: 'Failed' },
    runsTitle: (n: number) => `Latest ${n} replays`,
    modeReal: 'with real SMS',
    modeSim: 'simulation only',
    subscribers: (active: number, sim: number, sms: number) =>
      `Active registrations: ${active} (simulation only: ${sim}, SMS: ${sms}). Demo school not included.`,
  },
  notFound: { title: 'Page not found', back: 'Back to home' },
  footer: {
    data: 'Data: SENAMHI, INDECI GeoSINPAD and MINEDU ESCALE · Hackathon project, not official.',
    repo: 'Code on GitHub',
  },
};

export const DICTIONARIES: Record<Locale, Dictionary> = { es, en };

function isLocale(value: unknown): value is Locale {
  return value === 'es' || value === 'en';
}

/** Prioridad: ?lang= (y se persiste) > localStorage > español. */
export function detectLocale(search: string, storage: Pick<Storage, 'getItem'> | null): Locale {
  const fromQuery = new URLSearchParams(search).get('lang')?.toLowerCase();
  if (isLocale(fromQuery)) return fromQuery;
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage bloqueado (modo privado): se ignora.
  }
  return 'es';
}

interface I18nValue {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
  toggle: () => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initial ?? detectLocale(typeof window === 'undefined' ? '' : window.location.search, safeStorage()),
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = DICTIONARIES[locale].meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', DICTIONARIES[locale].meta.description);
    try {
      safeStorage()?.setItem(STORAGE_KEY, locale);
    } catch {
      // sin persistencia
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang') && url.searchParams.get('lang') !== locale) {
      url.searchParams.set('lang', locale);
      window.history.replaceState(window.history.state, '', url);
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const toggle = useCallback(() => setLocaleState((current) => (current === 'es' ? 'en' : 'es')), []);
  const value = useMemo(() => ({ locale, t: DICTIONARIES[locale], setLocale, toggle }), [locale, setLocale, toggle]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n fuera de I18nProvider');
  return value;
}
