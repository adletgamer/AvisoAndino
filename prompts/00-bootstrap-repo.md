# Prompt 00: Bootstrap del repo (Claude Code o Codex)

Copia y pega todo lo que sigue en el agente, con el repo abierto en la raíz.

---
Eres el agente de código del proyecto **Aviso Andino** (avisos oficiales de SENAMHI → SMS ≤160 GSM-7 para colegios rurales del Perú; hackathon AWS "Zero to Shipped", deadline 2-oct-2026 23:59 PDT).
Lee antes de hacer nada: `AGENTS.md`, `docs/STACK.md`, `docs/RULES.md`, `docs/DATA_MODEL.md` y `docs/RESEARCH.md`.

El repo ya trae el esqueleto (package.json con workspaces, stubs de `packages/core`, `services/*`, `infra`, `apps/web`) y fixtures reales en `fixtures/`.

## Tareas
1. Comprueba `node -v` (Node 24; si no está, avísame y sigue con ≥ 22). Ejecuta `npm install` y completa los `package.json` de cada workspace con las dependencias de `docs/STACK.md` (versiones con `^`).
2. Configura TypeScript (`tsconfig.base.json` strict, `moduleResolution: bundler`) y referencias por workspace. Alias `@aviso/core` → `packages/core/src`.
3. Configura ESLint (typescript-eslint flat config) + Prettier, y Vitest con `vitest.config.ts` raíz (`test.projects`, ya creado).
4. Scripts raíz: `lint`, `test`, `synth`, `diff`, `deploy`, `dev`, `seed:demo`, que deleguen en los workspaces.
5. Crea `.gitignore` (node_modules, cdk.out, dist, .env*, excepto .env.example), `.nvmrc` = 24 y `.editorconfig`.
6. Ya existe `packages/core/test/smoke.fixtures.test.ts` (carga `fixtures/senamhi-wfs-aviso.388_2_2026.decimated.geojson` y verifica 4 features). Asegúrate de que corre con `npm test` desde la raíz.
7. (Opcional) GitHub Actions `ci.yml`: `npm ci`, `npm run lint`, `npm test`, `npm run synth`. Sin deploy.
8. Crea `docs/DECISIONS.md` (ADR breve) con las decisiones de STACK.md y un hueco para el número del caso de soporte de SMS.

## Criterios de aceptación
- `npm ci && npm run lint && npm test` en verde desde un clon limpio.
- `npm run synth` genera `infra/cdk.out` sin errores (la stack puede estar casi vacía).
- Ningún secreto ni account ID en el repo. `git status` limpio tras commit `chore: bootstrap monorepo`.
- Resumen final: árbol de carpetas y comandos verificados, con su salida abreviada.
