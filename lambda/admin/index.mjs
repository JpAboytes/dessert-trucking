import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';

// Web Push (PWA): debe usar EL MISMO par de claves VAPID que el lambda `solicitudes`,
// porque las suscripciones se crearon con esa clave pública. Si falta config, se omite.
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@deserttransport.com';
const webPushReady = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (webPushReady) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS',
};

const resp = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

const dbConfig = () => ({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'desert2018',
  ssl: { rejectUnauthorized: false },
  connectTimeout: 10000,
});

// Adjunta a cada solicitud su arreglo `fotos: [{ tipo, url }]` (una sola query).
async function adjuntarFotos(connection, rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.idserviciomovil);
  const placeholders = ids.map(() => '?').join(', ');
  const [fotos] = await connection.execute(
    `SELECT idserviciomovil, tipo, url FROM serviciomovil_fotos
      WHERE idserviciomovil IN (${placeholders}) ORDER BY idfoto`,
    ids
  );
  const porId = new Map();
  for (const f of fotos) {
    if (!porId.has(f.idserviciomovil)) porId.set(f.idserviciomovil, []);
    porId.get(f.idserviciomovil).push({ tipo: f.tipo, url: f.url });
  }
  for (const r of rows) r.fotos = porId.get(r.idserviciomovil) ?? [];
  return rows;
}

// 'Autorizado' es el nombre histórico de la acción del admin; el estado resultante
// del ticket ahora es 'En proceso' (reparación en proceso). Se acepta el alias por compat.
const ALIAS_ESTATUS = { Autorizado: 'En proceso' };

// Tipo de cambio MXN→USD: cuántos pesos por dólar. Se consulta en vivo y, si la API
// falla (timeout/red), se usa el default para no bloquear la autorización de pago.
const FX_DEFAULT_MXN_POR_USD = 18;
async function tipoCambioMXNporUSD() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    const rate = j?.rates?.MXN;
    if (typeof rate === 'number' && rate > 0) return rate;
  } catch (e) {
    console.error('[admin] FX falló, uso default:', e?.message);
  }
  return FX_DEFAULT_MXN_POR_USD;
}

// Web Push al solicitante (PWA): envía a TODAS sus suscripciones. Best-effort: limpia
// las que el push service da por expiradas/incompatibles (404/410/403/VapidPkHashMismatch).
async function notificarSolicitanteWeb(connection, id, titulo, cuerpo) {
  if (!webPushReady) return;
  try {
    const [subs] = await connection.execute(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
         FROM push_subscriptions ps
         JOIN serviciomovil s ON s.idsolicitante = ps.idusuario
        WHERE s.idserviciomovil = ?`,
      [id]
    );
    const payload = JSON.stringify({ title: titulo, body: cuerpo, url: '/' });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
      } catch (err) {
        const cuerpoErr = String(err?.body ?? '');
        const claveIncompatible = err?.statusCode === 403 || (err?.statusCode === 400 && /vapid/i.test(cuerpoErr));
        if (err?.statusCode === 404 || err?.statusCode === 410 || claveIncompatible) {
          await connection.execute('DELETE FROM push_subscriptions WHERE id = ?', [s.id]).catch(() => {});
        } else {
          console.error('[webpush] fallo sub', s.id, '| status=', err?.statusCode);
        }
      }
    }));
  } catch (e) {
    console.error('[webpush] error al notificar al solicitante:', e?.message ?? e);
  }
}

// Notifica al solicitante por Expo (app nativa) y Web Push (PWA). No lanza; falla en silencio.
async function notificarSolicitante(connection, id, titulo, cuerpo, data) {
  try {
    const [pr] = await connection.execute(
      `SELECT u.push_token FROM serviciomovil s
         JOIN usuario u ON u.idusuario = s.idsolicitante
        WHERE s.idserviciomovil = ?`,
      [id]
    );
    const row = pr[0];
    if (row?.push_token?.startsWith('ExponentPushToken')) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to: row.push_token,
          sound: 'default',
          channelId: 'solicitudes',
          priority: 'high',
          title: titulo,
          body: cuerpo,
          data: { solicitudId: String(id), ...data },
        }),
      });
    }
  } catch (e) {
    console.error('[push] error al enviar notificación Expo:', e?.message ?? e);
  }

  // Canal paralelo: Web Push para el mecánico que usa el PWA.
  await notificarSolicitanteWeb(connection, id, titulo, cuerpo);
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod;

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  // Verificar JWT
  const authHeader = event.headers?.Authorization ?? event.headers?.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return resp(401, { success: false, message: 'No autorizado' });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return resp(401, { success: false, message: 'Token inválido o expirado' });
  }

  if (decoded.tusuario !== 'Administrador') {
    return resp(403, { success: false, message: 'Acceso denegado' });
  }

  // ── GET /admin/solicitudes ────────────────────────────────
  if (method === 'GET') {
    let connection;
    try {
      connection = await mysql.createConnection(dbConfig());
      const [rows] = await connection.execute(
        `SELECT s.idserviciomovil, s.estatus, s.tunidad, s.odometro,
                s.numeconomico, s.descripcion, s.costo, s.costoreal,
                s.fechahora, s.fechacierre, s.autorizacionpago, s.PO,
                s.idpagador, s.comentariorechazo, s.comentariocheckbox,
                DATE_FORMAT(s.semanapago, '%Y-%m-%d') AS semanapago,
                us.nombre AS nombresolicitante,
                ua.nombre AS nombreaprobador,
                up.nombre AS nombrepagador
         FROM serviciomovil s
         JOIN  usuario us ON us.idusuario = s.idsolicitante
         LEFT JOIN usuario ua ON ua.idusuario = s.idaprobador
         LEFT JOIN usuario up ON up.idusuario = s.idpagador
         ORDER BY s.fechahora DESC`
      );
      await adjuntarFotos(connection, rows);
      return resp(200, { success: true, data: rows });
    } catch (error) {
      console.error('[admin] error:', error?.code, '|', error?.sqlMessage ?? error?.message);
      return resp(500, { success: false, message: error.message });
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  }

  // ── PATCH /admin/solicitudes/{id} ─────────────────────────
  if (method === 'PATCH') {
    const id = event.pathParameters?.id;
    if (!id) return resp(400, { success: false, message: 'Falta el id de la solicitud' });

    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch {
      return resp(400, { success: false, message: 'Body JSON inválido' });
    }
    body = body ?? {};

    const folio = String(id);

    // ── Marcar como PAGADO: { pagar: true, comentarioCheckbox? } ───
    // Solo sobre un ticket con pago AUTORIZADO (Reparado + autorizacionpago=1).
    // estatus → 'Pagado' (sale de cuentas por pagar). Comentario opcional.
    if (body.pagar === true) {
      const comentario = typeof body.comentarioCheckbox === 'string' ? body.comentarioCheckbox.trim() : '';
      let connection;
      try {
        connection = await mysql.createConnection(dbConfig());
        const [cur] = await connection.execute(
          'SELECT estatus, autorizacionpago FROM serviciomovil WHERE idserviciomovil = ?',
          [id]
        );
        if (cur.length === 0) return resp(404, { success: false, message: 'Solicitud no encontrada' });
        if (!(cur[0].estatus === 'Reparado' && cur[0].autorizacionpago === 1)) {
          return resp(409, { success: false, message: 'Solo se puede pagar un ticket con pago autorizado' });
        }
        await connection.execute(
          "UPDATE serviciomovil SET estatus = 'Pagado', comentariocheckbox = ? WHERE idserviciomovil = ?",
          [comentario ? comentario.slice(0, 255) : null, id]
        );
        return resp(200, { success: true, message: 'Pago registrado' });
      } catch (error) {
        console.error('[admin] error pagar:', error?.code, '|', error?.sqlMessage ?? error?.message);
        return resp(500, { success: false, message: error.message });
      } finally {
        if (connection) await connection.end().catch(() => {});
      }
    }

    // ── Decisión de pago: { autorizacionPago: true|false } ───
    // Solo aplica a un ticket 'Reparado' que aún no tiene decisión de pago.
    if (Object.prototype.hasOwnProperty.call(body, 'autorizacionPago')) {
      const aprobado = body.autorizacionPago === true || body.autorizacionPago === 1;
      // Al rechazar el pago el comentario es OBLIGATORIO (lo verá el mecánico).
      const comentario = typeof body.comentarioRechazo === 'string' ? body.comentarioRechazo.trim() : '';
      if (!aprobado && !comentario) {
        return resp(400, { success: false, message: 'El comentario es obligatorio para rechazar el pago' });
      }
      let connection;
      try {
        connection = await mysql.createConnection(dbConfig());
        const [cur] = await connection.execute(
          'SELECT estatus, autorizacionpago, tunidad, numeconomico, PO, costoreal FROM serviciomovil WHERE idserviciomovil = ?',
          [id]
        );
        if (cur.length === 0) return resp(404, { success: false, message: 'Solicitud no encontrada' });
        if (cur[0].estatus !== 'Reparado') {
          return resp(409, { success: false, message: `El pago solo se decide sobre un ticket Reparado (actual: ${cur[0].estatus})` });
        }
        // Un pago AUTORIZADO (1) es terminal. Un pago RECHAZADO (0) se puede corregir
        // y autorizar después (NULL = aún sin decidir).
        if (cur[0].autorizacionpago === 1) {
          return resp(409, { success: false, message: 'El pago de este ticket ya fue autorizado' });
        }

        // Guarda quién decidió el pago (idpagador) y, si se rechaza, el comentario.
        // Al autorizar se limpia el comentario (p. ej. al corregir un pago rechazado).
        await connection.execute(
          'UPDATE serviciomovil SET autorizacionpago = ?, idpagador = ?, comentariorechazo = ? WHERE idserviciomovil = ?',
          [aprobado ? 1 : 0, decoded.idusuario, aprobado ? null : comentario.slice(0, 500), id]
        );

        // Al AUTORIZAR el pago, registra el monto en la fila de servicio detallado:
        //   Camión   → servicioc.tmoMX  (MXN) · servicioc.tmoUS  (USD)
        //   Remolque → serviciocajas.tmoMXR (MXN) · serviciocajas.tmo (USD)
        // El USD sale de FX en vivo (default 18 si la API falla). La fila se localiza por
        // el PO embebido en PO_camiones / PO_remolques ("{id}-{PO}-{numeconomico}").
        // Es best-effort: si algo falla aquí NO se revierte la autorización (solo se loguea).
        if (aprobado) {
          const tmoMX = Number(cur[0].costoreal);
          if (Number.isFinite(tmoMX)) {
            try {
              const rate = await tipoCambioMXNporUSD();
              const tmoUS = Number((tmoMX / rate).toFixed(2));
              if (cur[0].tunidad === 'Camión') {
                await connection.execute(
                  `UPDATE servicioc SET tmoMX = ?, tmoUS = ?
                    WHERE PO_camiones LIKE CONCAT('%-', ?, '-', ?)`,
                  [tmoMX, tmoUS, String(cur[0].PO), cur[0].numeconomico]
                );
              } else {
                await connection.execute(
                  `UPDATE serviciocajas SET tmoMXR = ?, tmo = ?
                    WHERE PO_remolques LIKE CONCAT('%-', ?, '-', ?)`,
                  [tmoMX, tmoUS, String(cur[0].PO), cur[0].numeconomico]
                );
              }
            } catch (e) {
              console.error('[admin] no se pudo registrar el monto en servicio detallado:', e?.sqlMessage ?? e?.message);
            }
          }
        }

        await notificarSolicitante(
          connection,
          id,
          aprobado ? `Pago autorizado · #${folio}` : `Pago rechazado · #${folio}`,
          aprobado ? 'El pago de tu reparación fue autorizado.' : 'El pago de tu reparación no fue autorizado.',
          { autorizacionpago: aprobado ? 1 : 0 }
        );

        return resp(200, { success: true, message: aprobado ? 'Pago autorizado' : 'Pago rechazado' });
      } catch (error) {
        console.error('[admin] error:', error?.code, '|', error?.sqlMessage ?? error?.message);
        return resp(500, { success: false, message: error.message });
      } finally {
        if (connection) await connection.end().catch(() => {});
      }
    }

    // ── Reasignar semana de pago: { semanaPago: 'YYYY-MM-DD' | null } ───
    // Mueve un PO "por pagar" a otra semana. Guarda el override en serviciomovil.semanapago
    // (la vista de Pagos bucketea por esta fecha) y SINCRONIZA servicio(c/cajas).fecha, que se
    // pobló con la fecha de creación al autorizar. null = quita el override (vuelve a la de cierre).
    if (Object.prototype.hasOwnProperty.call(body, 'semanaPago')) {
      const semana = body.semanaPago;
      const quitar = semana === null;
      if (!quitar && !(typeof semana === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(semana))) {
        return resp(400, { success: false, message: 'semanaPago debe ser una fecha YYYY-MM-DD o null' });
      }
      let connection;
      try {
        connection = await mysql.createConnection(dbConfig());
        await connection.beginTransaction();
        try {
          const [cur] = await connection.execute(
            `SELECT estatus, autorizacionpago, tunidad, numeconomico, PO, fechahora
               FROM serviciomovil WHERE idserviciomovil = ? FOR UPDATE`,
            [id]
          );
          if (cur.length === 0) {
            await connection.rollback();
            return resp(404, { success: false, message: 'Solicitud no encontrada' });
          }
          // Alcance: solo tickets "por pagar" (Reparado + pago autorizado).
          if (!(cur[0].estatus === 'Reparado' && cur[0].autorizacionpago === 1)) {
            await connection.rollback();
            return resp(409, { success: false, message: 'Solo se reasigna la semana de un ticket con pago autorizado' });
          }

          // 1. Override en serviciomovil (fuente de verdad de la vista de Pagos).
          await connection.execute(
            'UPDATE serviciomovil SET semanapago = ? WHERE idserviciomovil = ?',
            [quitar ? null : semana, id]
          );

          // 2. Sincroniza servicio(c/cajas).fecha. Localiza la fila por el PO embebido
          //    ("{id}-{PO}-{numeconomico}"), igual que el update de tmo. Al quitar, revierte
          //    a la fecha de creación (DATE(fechahora)).
          const esCamion = cur[0].tunidad === 'Camión';
          const tabla = esCamion ? 'servicioc' : 'serviciocajas';
          const colPO = esCamion ? 'PO_camiones' : 'PO_remolques';
          const [upd] = await connection.execute(
            `UPDATE ${tabla} SET fecha = ${quitar ? 'DATE(?)' : '?'}
              WHERE ${colPO} LIKE CONCAT('%-', ?, '-', ?)`,
            [quitar ? cur[0].fechahora : semana, String(cur[0].PO), cur[0].numeconomico]
          );
          if (upd.affectedRows === 0) {
            console.warn(`[admin] semanaPago: sin fila en ${tabla} para PO ${cur[0].PO} / ${cur[0].numeconomico}`);
          }

          await connection.commit();
          return resp(200, { success: true, message: quitar ? 'Semana de pago restablecida' : 'Semana de pago actualizada' });
        } catch (e) {
          await connection.rollback();
          throw e;
        }
      } catch (error) {
        console.error('[admin] error semanaPago:', error?.code, '|', error?.sqlMessage ?? error?.message);
        return resp(500, { success: false, message: error.message });
      } finally {
        if (connection) await connection.end().catch(() => {});
      }
    }

    // ── Cambio de estatus: { estatus: 'En proceso' | 'Rechazado' } ──
    let { estatus } = body;
    estatus = ALIAS_ESTATUS[estatus] ?? estatus;

    const ORIGEN_VALIDO = {
      'En proceso': 'Pendiente',   // autorizar (genera PO + servicio detallado)
      'Rechazado':  'Pendiente',   // declinar
    };
    if (!(estatus in ORIGEN_VALIDO)) {
      return resp(400, { success: false, message: 'estatus inválido' });
    }

    // ── Autorización: En proceso (genera PO + inserts) ──────
    if (estatus === 'En proceso') {
      let connection;
      try {
        connection = await mysql.createConnection(dbConfig());
        let poNumber = null;
        await connection.beginTransaction();
        try {
          // Datos de la solicitud + nombre del solicitante (mecánico)
          const [solRows] = await connection.execute(
            `SELECT s.PO, s.estatus, s.tunidad, s.numeconomico, s.odometro, s.descripcion, s.fechahora,
                    u.nombre AS solicitante
               FROM serviciomovil s
               JOIN usuario u ON u.idusuario = s.idsolicitante
              WHERE s.idserviciomovil = ?
              FOR UPDATE`,
            [id]
          );
          if (solRows.length === 0) {
            await connection.rollback();
            return resp(404, { success: false, message: 'Solicitud no encontrada' });
          }
          const sv = solRows[0];

          // Solo autorizable desde Pendiente (o re-autorizar algo ya En proceso → idempotente)
          if (sv.estatus !== 'Pendiente' && sv.estatus !== 'En proceso') {
            await connection.rollback();
            return resp(409, { success: false, message: `No se puede autorizar una solicitud en estado ${sv.estatus}` });
          }

          const yaAprobado = sv.PO != null;

          // 1. Asignar PO: conserva el existente o genera MAX(PO)+1 con reintento
          //    (índice UNIQUE en serviciomovil.PO + ER_DUP_ENTRY evita colisiones).
          if (yaAprobado) {
            poNumber = sv.PO;
            await connection.execute(
              'UPDATE serviciomovil SET estatus = ?, idaprobador = ? WHERE idserviciomovil = ?',
              [estatus, decoded.idusuario, id]
            );
          } else {
            let assigned = false;
            for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
              const [m] = await connection.execute(
                // PO se almacena como TEXTO en la BD; MAX() sin CAST es lexicográfico
                // ("9" > "10") y devuelve un candidato que ya existe → ER_DUP_ENTRY perpetuo.
                // Castear a entero da el verdadero máximo numérico.
                'SELECT COALESCE(MAX(CAST(PO AS UNSIGNED)), 0) + 1 AS next FROM serviciomovil'
              );
              const candidate = m[0].next;
              try {
                await connection.execute(
                  'UPDATE serviciomovil SET estatus = ?, idaprobador = ?, PO = ? WHERE idserviciomovil = ?',
                  [estatus, decoded.idusuario, candidate, id]
                );
                poNumber = candidate;
                assigned = true;
              } catch (e) {
                if (e?.code === 'ER_DUP_ENTRY') continue;
                throw e;
              }
            }
            if (!assigned) {
              await connection.rollback();
              return resp(409, { success: false, message: 'No se pudo asignar PO, reintenta' });
            }
          }

          // 2. Solo en la PRIMERA aprobación: crear la row de servicio detallado.
          //    - La fecha se redondea al inicio del día (DATE(?) → 00:00:00).
          //    - El odómetro solo se arrastra si la solicitud lo trae (los remolques
          //      no lo capturan); si es NULL se omite la columna y queda el default.
          if (!yaAprobado) {
            const conOdometro = sv.odometro != null;

            if (sv.tunidad === 'Camión') {
              const [c] = await connection.execute(
                'SELECT IdCamion AS unidadId FROM camion WHERE NombreC = ? LIMIT 1',
                [sv.numeconomico]
              );
              const idcamion = c[0]?.unidadId ?? null;
              const cols   = ['fecha',   'descripcion', 'mecanico', 'idcamion'];
              const vals   = ['DATE(?)', '?',           '?',        '?'];
              const params = [sv.fechahora, sv.descripcion, sv.solicitante, idcamion];
              if (conOdometro) { cols.splice(1, 0, 'odometro'); vals.splice(1, 0, '?'); params.splice(1, 0, sv.odometro); }
              const [ins] = await connection.execute(
                `INSERT INTO servicioc (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
                params
              );
              const idservicioC = ins.insertId;
              await connection.execute(
                'UPDATE servicioc SET PO_camiones = ? WHERE idservicioC = ?',
                [`${idservicioC}-${poNumber}-${sv.numeconomico}`, idservicioC]
              );
            } else {
              const [cj] = await connection.execute(
                'SELECT idcaja AS unidadId FROM cajas WHERE Numero = ? LIMIT 1',
                [sv.numeconomico]
              );
              const idcaja = cj[0]?.unidadId ?? null;
              const cols   = ['fecha',   'descripcion', 'mecanico', 'idcaja'];
              const vals   = ['DATE(?)', '?',           '?',        '?'];
              const params = [sv.fechahora, sv.descripcion, sv.solicitante, idcaja];
              if (conOdometro) { cols.splice(1, 0, 'odometro'); vals.splice(1, 0, '?'); params.splice(1, 0, sv.odometro); }
              const [ins] = await connection.execute(
                `INSERT INTO serviciocajas (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
                params
              );
              const idservicioCaja = ins.insertId;
              await connection.execute(
                'UPDATE serviciocajas SET PO_remolques = ? WHERE idservicioCaja = ?',
                [`${idservicioCaja}-${poNumber}-${sv.numeconomico}`, idservicioCaja]
              );
            }
          }

          await connection.commit();
        } catch (e) {
          await connection.rollback();
          throw e;
        }

        // Notificar al solicitante: autorizada, en proceso de reparación.
        await notificarSolicitante(
          connection,
          id,
          `Solicitud #${folio} autorizada`,
          'Tu solicitud fue autorizada y está en proceso de reparación.',
          { estatus }
        );

        return resp(200, { success: true, message: 'Solicitud autorizada — en proceso de reparación', PO: poNumber });
      } catch (error) {
        console.error('[admin] error:', error?.code, '|', error?.sqlMessage ?? error?.message);
        return resp(500, { success: false, message: error.message });
      } finally {
        if (connection) await connection.end().catch(() => {});
      }
    }

    // ── Rechazo de la solicitud (desde Pendiente) ───────────
    let connection;
    try {
      connection = await mysql.createConnection(dbConfig());

      const [cur] = await connection.execute(
        'SELECT estatus FROM serviciomovil WHERE idserviciomovil = ?',
        [id]
      );
      if (cur.length === 0) return resp(404, { success: false, message: 'Solicitud no encontrada' });
      if (cur[0].estatus !== 'Pendiente') {
        return resp(409, { success: false, message: `Solo se puede rechazar una solicitud Pendiente (actual: ${cur[0].estatus})` });
      }

      await connection.execute(
        'UPDATE serviciomovil SET estatus = ?, idaprobador = ? WHERE idserviciomovil = ?',
        [estatus, decoded.idusuario, id]
      );

      await notificarSolicitante(
        connection,
        id,
        `Solicitud #${folio} rechazada`,
        'Tu solicitud fue rechazada.',
        { estatus }
      );

      return resp(200, { success: true, message: 'Solicitud rechazada' });
    } catch (error) {
      console.error('[admin] error:', error?.code, '|', error?.sqlMessage ?? error?.message);
      return resp(500, { success: false, message: error.message });
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  }

  return resp(405, { success: false, message: 'Método no permitido' });
};
