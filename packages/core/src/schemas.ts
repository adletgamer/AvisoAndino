import { z } from "zod";

const locationSchema = z.strictObject({
  lat: z.number().min(-18.4).max(0.1),
  lon: z.number().min(-81.4).max(-68.6),
  codMod: z
    .string()
    .regex(/^\d{7}$/)
    .optional(),
  centroPoblado: z.string().max(80).optional(),
  distrito: z.string().max(80).optional(),
  departamento: z.string().max(40).optional(),
});

export const subscriberRequestSchema = z
  .strictObject({
    channel: z.enum(["SMS", "TELEGRAM", "SIMULATED"]),
    phone: z
      .string()
      .regex(/^\+519\d{8}$/)
      .optional(),
    role: z.enum(["DIRECTOR", "DOCENTE", "FAMILIA", "OTRO"]).default("FAMILIA"),
    location: locationSchema,
    minLevel: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    hazards: z
      .array(
        z.enum([
          "HELADA",
          "FRIAJE",
          "LLUVIA",
          "NEVADA",
          "LLOVIZNA",
          "CALOR",
          "VIENTO",
        ]),
      )
      .default(["HELADA", "FRIAJE", "LLUVIA", "NEVADA"]),
    consent: z.literal(true),
    website: z.literal("").optional(),
  })
  .superRefine((value, context) => {
    if (value.channel === "SMS" && !value.phone) {
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "El teléfono es obligatorio para SMS",
      });
    }
  });

export const confirmRequestSchema = z.strictObject({
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/),
  channel: z.enum(["LINK", "SIMULATED"]).default("LINK"),
});

export const replayRequestSchema = z.strictObject({
  year: z.number().int().min(2021).max(2026),
  nroAviso: z.number().int().min(1).max(999),
  mapa: z.number().int().min(1).max(3).optional(),
  simulatedNow: z.iso.datetime().optional(),
  /** Suscriptor "solo simulación" del visitante: su SMS simulado aparece en el teléfono virtual. */
  subscriberId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
  /** Solo con cabecera x-demo-key válida: suscriptor SMS que recibe el SMS real (sigue sujeto a SMS_ENABLED + allowlist). */
  realSmsSubscriberId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
});
