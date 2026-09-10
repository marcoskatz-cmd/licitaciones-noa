# API de escritura — Licitaciones viales NOA

Apps Script ligado a la planilla **"Licitaciones viales NOA — seguimiento"**.
La rutina diaria de Claude (cloud) no puede escribir en Sheets con el conector de
Drive, así que le hace un `POST` a este script. El script agrega las filas,
descarta duplicados y avisa si la planilla cambió de forma.

## Endpoints

| Método | Cuerpo | Respuesta |
|---|---|---|
| `GET` | — | `{ ok, columnas, faltan, filas, token_configurado }` (diagnóstico, sin datos) |
| `POST` | `{ "token": "...", "filas": [ {…}, … ] }` | `{ ok, agregadas, duplicadas, descartadas }` |
| `POST` | `{ "accion": "configurar", "token": "..." }` | Guarda el token. **Solo funciona una vez** (mientras no haya token). |

Cada objeto de `filas` usa los nombres de columna de la planilla
(`organismo`, `numero`, `objeto`, `fecha_apertura`, …). Si falta
`fecha_deteccion` se pone la fecha de hoy; si falta `estado_seguimiento` se
pone `nuevo`.

**Duplicados:** se descarta una fila si ya existe otra con el mismo
`organismo` + `numero`, o el mismo `objeto` + `fecha_apertura`.

**Auto-diagnóstico:** si a la planilla le falta alguna columna esperada, el
`POST` no escribe nada y devuelve `faltan: [...]`.

## Ejemplo con curl

```bash
curl -sL -X POST "$URL" -H "Content-Type: application/json" \
  -d '{"token":"'"$TOKEN"'","filas":[{"organismo":"DPV Jujuy","numero":"CP 12/2026","objeto":"Bacheo RP 1","provincia_obra":"Jujuy","fecha_apertura":"2026-09-30","relevancia":"alta","fuente":"vialidad.jujuy.gob.ar","url":"https://..."}]}'
```

`-L` es obligatorio: Apps Script redirige a `script.googleusercontent.com`.

## Deploy (clasp, nunca copy-paste)

```bash
cd apps-script
clasp push
clasp deploy -i <deploymentId> -d "descripción"
```

El `scriptId` está en `.clasp.json`. Si `clasp push` da `invalid_grant`,
las credenciales caducaron: `clasp login` con la cuenta de INGECO.

## Primera vez

1. `clasp push` y `clasp deploy`.
2. Abrir el script en el editor y correr `verificar()` una vez para autorizar
   el permiso de Sheets (sin esto la web app devuelve una página de
   "autorización requerida").
3. `POST` con `{"accion":"configurar","token":"<token largo>"}`.
4. Guardar el mismo token en la rutina de Claude.

Para rotar el token: correr `borrarToken()` en el editor y repetir el paso 3.
