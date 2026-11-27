import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createPool } from '../../server/db/pool.js'
import { migrate } from '../../server/db/migrate.js'
import { buildApp } from '../../server/app.js'
import { drainMailDeliveries } from '../../server/services/mail.js'
import { expireVerifications } from '../../server/modules/accounts/verification.js'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

const testUrl =
  process.env.PLATFORM_TEST_DATABASE_URL ||
  'postgresql://linkatletas:linkatletas_dev@127.0.0.1:54329/linkatletas_platform_test'
if (!new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('Banco exclusivo _test obrigatório.')
const pool = createPool(testUrl),
  origin = 'http://localhost:5173'
let app: FastifyInstance,
  athlete: any,
  coach: any,
  stranger: any,
  admin: any,
  contractId: string,
  workoutId: string,
  mediaId: string
const call = (actor: any, method: any, url: string, payload?: any) =>
  app.inject({
    method,
    url: `/api${url}`,
    headers: {
      origin,
      ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  })
const signup = async (name: string, role = 'athlete') => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/native/register',
    payload: {
      name,
      role,
      email: `${name}@platform-test.local`,
      password: 'SenhaTeste123!',
    },
  })
  expect(response.statusCode, response.body).toBe(201)
  expect(response.headers['set-cookie']).toBeUndefined()
  return response.json()
}
describe.sequential('Plataforma, SMTP e S3 reais locais', () => {
  beforeAll(async () => {
    // This fixture uses its own database, never the demonstration or another suite's data.
    await migrate(pool)
    await pool.query('TRUNCATE users CASCADE')
    app = await buildApp({ pool })
    athlete = await signup('Atleta')
    coach = await signup('Treinador', 'coach')
    stranger = await signup('Terceiro')
    admin = await signup('Administrador')
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [
      admin.user.id,
    ])
    await pool.query(
      "UPDATE profiles SET sports=ARRAY['Corrida'],goals=ARRAY['Performance'],levels=ARRAY['Iniciante'],availability=ARRAY['Segunda manhã'],verification_status='approved' WHERE user_id=$1",
      [coach.user.id],
    )
    contractId = (
      await pool.query(
        "INSERT INTO contracts(athlete_id,coach_id,status,decided_at) VALUES($1,$2,'active',now()) RETURNING id",
        [athlete.user.id, coach.user.id],
      )
    ).rows[0].id
    workoutId = (
      await pool.query(
        "INSERT INTO workouts(contract_id,title,sport,scheduled_date,instructions,status) VALUES($1,'Teste privado','Corrida',current_date,'Orientação','published') RETURNING id",
        [contractId],
      )
    ).rows[0].id
    await pool.query(
      'INSERT INTO exercise_blocks(workout_id,position,definition) VALUES($1,0,\'{"name":"Corrida","instructions":"Correr"}\')',
      [workoutId],
    )
  })
  afterAll(async () => {
    await app?.close()
    await pool.end()
  })
  it('Bearer permite mutação nativa, cookie continua exigindo Origin', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/privacy/consents',
      headers: { authorization: `Bearer ${athlete.token}` },
      payload: { purpose: 'health', granted: true },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/privacy/consents',
          headers: { cookie: `la_session=${athlete.token}` },
          payload: { purpose: 'health', granted: true },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/privacy/consents',
          headers: { authorization: 'Bearer ' + '0'.repeat(64) },
          payload: { purpose: 'health', granted: true },
        })
      ).statusCode,
    ).toBe(403)
  })
  it('saúde exige consentimento, cifra e exporta exclusivamente os dados próprios', async () => {
    expect(
      (await call(stranger, 'PUT', '/privacy/health', { notes: 'Privado' }))
        .statusCode,
    ).toBe(403)
    expect(
      (
        await call(athlete, 'PUT', '/privacy/health', {
          notes: 'Observação sensível',
          heightCm: 180,
          weightKg: 80,
        })
      ).statusCode,
    ).toBe(200)
    const stored = (
      await pool.query(
        'SELECT encrypted_data FROM private_health WHERE user_id=$1',
        [athlete.user.id],
      )
    ).rows[0].encrypted_data
    expect(stored).not.toContain('Observação sensível')
    const exported = await call(athlete, 'GET', '/privacy/export')
    expect(exported.statusCode, exported.body).toBe(200)
    expect(exported.json().health.notes).toBe('Observação sensível')
    expect(exported.body).not.toContain(stranger.user.email)
    await call(athlete, 'PUT', '/privacy/consents', {
      purpose: 'health',
      granted: false,
    })
    expect(
      (await call(athlete, 'GET', '/privacy/health')).json().health,
    ).toBeNull()
  })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=',
    'base64',
  )
  const upload = (
    actor: any,
    bytes = png,
    name = 'performance.png',
    mime = 'image/png',
  ) => {
    const boundary = 'linkatletas-platform-boundary'
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return app.inject({
      method: 'POST',
      url: `/api/media?purpose=performance&resourceId=${workoutId}`,
      headers: {
        origin,
        authorization: `Bearer ${actor.token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    })
  }
  it('upload exige consentimento e recusa assinatura falsa/extensão indevida', async () => {
    expect((await upload(athlete)).statusCode).toBe(403)
    await call(athlete, 'PUT', '/privacy/consents', {
      purpose: 'performance',
      granted: true,
    })
    expect(
      (await upload(athlete, Buffer.from('<script>evil</script>'))).statusCode,
    ).toBe(400)
    expect((await upload(athlete, png, 'evil.html')).statusCode).toBe(400)
    const response = await upload(athlete)
    expect(response.statusCode, response.body).toBe(201)
    mediaId = response.json().media.id
  })
  it('S3 contém bytes cifrados, bucket é privado e download autorizado recupera original', async () => {
    const key = (
      await pool.query('SELECT object_key FROM media WHERE id=$1', [mediaId])
    ).rows[0].object_key
    const s3 = new S3Client({
      endpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'linkatletas-local',
        secretAccessKey: 'local-only-change-in-production',
      },
    })
    try {
      const object = await s3.send(
        new GetObjectCommand({ Bucket: 'linkatletas-private', Key: key }),
      )
      const bytes = await object.Body!.transformToByteArray()
      expect(Buffer.from(bytes).equals(png)).toBe(false)
      expect(Buffer.from(bytes).toString().startsWith('la2:')).toBe(true)
    } finally {
      s3.destroy()
    }
    const unauthorized = await fetch(
      `http://127.0.0.1:8333/linkatletas-private/${key}`,
    )
    expect(unauthorized.status).toBe(403)
    const response = await call(coach, 'GET', `/media/${mediaId}/content`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.rawPayload.equals(png)).toBe(true)
    expect(
      (await call(stranger, 'GET', `/media/${mediaId}/content`)).statusCode,
    ).toBe(404)
  })

  it('limits health rows per transaction and preserves the backup reader', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`CREATE ROLE linkatletas_health_policy_test NOLOGIN;
        GRANT USAGE ON SCHEMA public TO linkatletas_health_policy_test;
        GRANT SELECT, INSERT, UPDATE, DELETE ON private_health TO linkatletas_health_policy_test`)
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='linkatletas_backup_reader') THEN
          CREATE ROLE linkatletas_backup_reader NOLOGIN;
        END IF;
        END $$;
        GRANT USAGE ON SCHEMA public TO linkatletas_backup_reader;
        GRANT SELECT ON private_health TO linkatletas_backup_reader`)
      await client.query("INSERT INTO private_health(user_id,encrypted_data) VALUES($1,'first'),($2,'second') ON CONFLICT(user_id) DO NOTHING", [athlete.user.id, coach.user.id])
      await client.query('SET LOCAL ROLE linkatletas_health_policy_test')
      expect((await client.query('SELECT user_id FROM private_health')).rowCount).toBe(0)
      await client.query('SAVEPOINT health_context')
      await client.query("SELECT set_config('linkatletas.user_id',$1,true)", [athlete.user.id])
      expect((await client.query('SELECT user_id FROM private_health')).rows).toEqual([{ user_id: athlete.user.id }])
      expect((await client.query('DELETE FROM private_health WHERE user_id=$1', [coach.user.id])).rowCount).toBe(0)
      await expect(client.query("INSERT INTO private_health(user_id,encrypted_data) VALUES($1,'third')", [stranger.user.id])).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK TO SAVEPOINT health_context')
      expect((await client.query('SELECT user_id FROM private_health')).rowCount).toBe(0)
      await client.query('SET LOCAL ROLE linkatletas_backup_reader')
      expect((await client.query('SELECT user_id FROM private_health WHERE user_id IN ($1,$2)', [athlete.user.id, coach.user.id])).rowCount).toBe(2)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
  it('envio em partes preserva arquivo grande, impede terceiro e finaliza sem duplicar', async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)])
    const started = await call(athlete, 'POST', '/media/uploads', {
      purpose: 'performance',
      resourceId: workoutId,
      name: 'large.png',
      mimeType: 'image/png',
      size: bytes.length,
    })
    expect(started.statusCode, started.body).toBe(201)
    const session = started.json().upload
    expect(
      (
        await call(
          stranger,
          'POST',
          `/media/uploads/${session.id}/complete`,
          {},
        )
      ).statusCode,
    ).toBe(404)
    expect(
      (await call(athlete, 'POST', `/media/uploads/${session.id}/complete`, {}))
        .statusCode,
    ).toBe(409)
    for (let part = 0; part < session.parts; part++) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/media/uploads/${session.id}/parts/${part}`,
        headers: {
          origin,
          authorization: `Bearer ${athlete.token}`,
          'content-type': 'application/octet-stream',
        },
        payload: bytes.subarray(
          part * session.partSize,
          (part + 1) * session.partSize,
        ),
      })
      expect(response.statusCode, response.body).toBe(200)
    }
    const completed = await call(
      athlete,
      'POST',
      `/media/uploads/${session.id}/complete`,
      {},
    )
    expect(completed.statusCode, completed.body).toBe(201)
    const id = completed.json().media.id
    const repeated = await call(
      athlete,
      'POST',
      `/media/uploads/${session.id}/complete`,
      {},
    )
    expect(repeated.json().media.id).toBe(id)
    const downloaded = await call(coach, 'GET', `/media/${id}/content`)
    expect(downloaded.rawPayload.equals(bytes)).toBe(true)
    const ranged = await app.inject({
      method: 'GET',
      url: `/api/media/${id}/content`,
      headers: { authorization: `Bearer ${coach.token}`, range: 'bytes=10-25' },
    })
    expect(ranged.statusCode).toBe(206)
    expect(ranged.headers['content-range']).toBe(`bytes 10-25/${bytes.length}`)
    expect(ranged.rawPayload.equals(bytes.subarray(10, 26))).toBe(true)
    expect((await call(athlete, 'DELETE', `/media/${id}`)).statusCode).toBe(200)
  })
  it('video no limite de 50 MiB atravessa partes e retorna em stream', async () => {
    const bytes = Buffer.alloc(50 * 1024 * 1024)
    bytes.write('ftyp', 4)
    const started = await call(athlete, 'POST', '/media/uploads', {
      purpose: 'performance',
      resourceId: workoutId,
      name: 'limit.mp4',
      mimeType: 'video/mp4',
      size: bytes.length,
    })
    expect(started.statusCode, started.body).toBe(201)
    const session = started.json().upload
    for (let part = 0; part < session.parts; part++) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/media/uploads/${session.id}/parts/${part}`,
        headers: {
          authorization: `Bearer ${athlete.token}`,
          'content-type': 'application/octet-stream',
        },
        payload: bytes.subarray(
          part * session.partSize,
          (part + 1) * session.partSize,
        ),
      })
      expect(response.statusCode, response.body).toBe(200)
    }
    const result = await call(
      athlete,
      'POST',
      `/media/uploads/${session.id}/complete`,
      {},
    )
    expect(result.statusCode, result.body).toBe(201)
    const id = result.json().media.id
    const content = await call(coach, 'GET', `/media/${id}/content`)
    expect(content.statusCode).toBe(200)
    expect(content.rawPayload.equals(bytes)).toBe(true)
    expect((await call(athlete, 'DELETE', `/media/${id}`)).statusCode).toBe(200)
  }, 60_000)
  it('partes invalidas, sessao expirada e assinatura falsa sao recusadas', async () => {
    const started = await call(athlete, 'POST', '/media/uploads', {
      purpose: 'performance',
      resourceId: workoutId,
      name: 'fake.png',
      mimeType: 'image/png',
      size: 10,
    })
    const id = started.json().upload.id
    const send = (part: number, payload: Buffer) =>
      app.inject({
        method: 'PUT',
        url: `/api/media/uploads/${id}/parts/${part}`,
        headers: {
          authorization: `Bearer ${athlete.token}`,
          'content-type': 'application/octet-stream',
        },
        payload,
      })
    expect((await send(1, Buffer.alloc(10))).statusCode).toBe(400)
    expect((await send(0, Buffer.alloc(9))).statusCode).toBe(400)
    expect((await send(0, Buffer.alloc(10))).statusCode).toBe(200)
    expect(
      (await call(athlete, 'POST', `/media/uploads/${id}/complete`, {}))
        .statusCode,
    ).toBe(400)
    await pool.query(
      "UPDATE media_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    )
    expect((await send(0, Buffer.alloc(10))).statusCode).toBe(404)
    expect(
      (await call(athlete, 'DELETE', `/media/uploads/${id}`)).statusCode,
    ).toBe(200)
  })
  it('feedback é privado e revogação elimina mídia do S3 e impede download', async () => {
    expect(
      (
        await call(coach, 'POST', `/media/${mediaId}/feedback`, {
          text: 'Ajuste técnico privado',
        })
      ).statusCode,
    ).toBe(201)
    expect(
      (await call(athlete, 'GET', `/media?resourceId=${workoutId}`)).json()
        .media[0].feedback[0].text,
    ).toBe('Ajuste técnico privado')
    expect(
      (await call(stranger, 'GET', `/media?resourceId=${workoutId}`))
        .statusCode,
    ).toBe(404)
    await call(athlete, 'PUT', '/privacy/consents', {
      purpose: 'performance',
      granted: false,
    })
    expect(
      (await call(athlete, 'GET', `/media/${mediaId}/content`)).statusCode,
    ).toBe(404)
  })
  it('execução mantém notas e métricas cifradas em SQL', async () => {
    const response = await call(
      athlete,
      'PUT',
      `/workouts/${workoutId}/execution`,
      {
        completedBlocks: [0],
        effort: 5,
        notes: 'Observação confidencial',
        metrics: { distanceKm: 5 },
      },
    )
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().workout.execution.notes).toBe(
      'Observação confidencial',
    )
    const row = (
      await pool.query(
        'SELECT notes,metrics,private_payload FROM executions WHERE workout_id=$1',
        [workoutId],
      )
    ).rows[0]
    expect(row.notes).toBe('')
    expect(row.metrics).toEqual({})
    expect(row.private_payload).not.toContain('confidencial')
  })
  it('expiração e suspensão profissional removem descoberta e registram auditoria', async () => {
    const verificationId = (
      await pool.query(
        "INSERT INTO verifications(coach_id,cref,evidence,status,reason) VALUES($1,'TESTE-STATUS','Registro ficticio','approved','Analise original') RETURNING id",
        [coach.user.id],
      )
    ).rows[0].id
    await pool.query(
      "UPDATE profiles SET verification_expires_at=now()-interval '1 second' WHERE user_id=$1",
      [coach.user.id],
    )
    expect((await expireVerifications(pool)).expired).toBe(1)
    expect(
      (
        await pool.query(
          'SELECT verification_status FROM profiles WHERE user_id=$1',
          [coach.user.id],
        )
      ).rows[0].verification_status,
    ).toBe('expired')
    const response = await call(
      admin,
      'PATCH',
      `/admin/coaches/${coach.user.id}/verification`,
      { status: 'suspended', reason: 'Conferência administrativa de teste' },
    )
    expect(response.statusCode, response.body).toBe(200)
    const listed = await call(admin, 'GET', '/admin/verifications')
    expect(listed.statusCode).toBe(200)
    expect(
      listed.json().verifications.find((v: { id: string }) => v.id === verificationId),
    ).toMatchObject({
      status: 'approved',
      reason: 'Analise original',
      currentStatus: 'suspended',
      currentReason: 'Conferência administrativa de teste',
    })
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM administrative_audit WHERE subject_id=$1',
          [coach.user.id],
        )
      ).rows[0].n,
    ).toBe(2)
    const revoked = await call(
      admin,
      'PATCH',
      `/admin/coaches/${coach.user.id}/verification`,
      { status: 'rejected', reason: 'Revogacao ficticia de teste' },
    )
    expect(revoked.statusCode).toBe(200)
    const afterRevocation = await call(admin, 'GET', '/admin/verifications')
    expect(
      afterRevocation.json().verifications.find(
        (v: { id: string }) => v.id === verificationId,
      ),
    ).toMatchObject({
      status: 'approved',
      currentStatus: 'rejected',
      currentReason: 'Revogacao ficticia de teste',
    })
  })
  it('recuperação envia via SMTP, token só tem hash SQL, uso único e invalida sessões', async () => {
    const missing = await call(null, 'POST', '/auth/forgot-password', {
      email: 'ausente@platform-test.local',
    })
    const exists = await call(null, 'POST', '/auth/forgot-password', {
      email: stranger.user.email,
    })
    expect(missing.json()).toEqual(exists.json())
    expect(exists.statusCode).toBe(200)
    await drainMailDeliveries(pool)
    expect((await pool.query('SELECT sent_at FROM mail_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [stranger.user.id])).rows[0].sent_at).not.toBeNull()
    const listing = (await (
      await fetch('http://127.0.0.1:8025/api/v1/messages')
    ).json()) as any
    const item = listing.messages.find((m: any) =>
      m.To.some((to: any) => to.Address === stranger.user.email),
    )
    expect(item).toBeTruthy()
    const message = (await (
      await fetch(`http://127.0.0.1:8025/api/v1/message/${item.ID}`)
    ).json()) as any
    const token = message.Text.match(/token=([a-f0-9]{64})/)[1]
    expect(
      (
        await pool.query(
          'SELECT token_hash FROM password_resets WHERE user_id=$1',
          [stranger.user.id],
        )
      ).rows[0].token_hash,
    ).not.toBe(token)
    expect(
      (
        await call(null, 'POST', '/auth/reset-password', {
          token,
          password: 'SenhaNova123!',
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await call(null, 'POST', '/auth/reset-password', {
          token,
          password: 'SenhaNova123!',
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await call(stranger, 'GET', '/auth/session')).json().user,
    ).toBeNull()
    const login = await call(null, 'POST', '/auth/native/login', {
      email: stranger.user.email,
      password: 'SenhaNova123!',
    })
    expect(login.statusCode, login.body).toBe(200)
    stranger = login.json()
  })
  it('token expirado falha e logout Bearer invalida a sessão', async () => {
    const token = 'a'.repeat(64)
    const { tokenHash } = await import('../../server/shared/security.js')
    await pool.query(
      "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()-interval '1 minute') ON CONFLICT(token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at",
      [tokenHash(token), stranger.user.id],
    )
    expect(
      (
        await call(null, 'POST', '/auth/reset-password', {
          token,
          password: 'SenhaNova123!',
        })
      ).statusCode,
    ).toBe(400)
    expect((await call(stranger, 'POST', '/auth/logout')).statusCode).toBe(200)
    expect(
      (await call(stranger, 'GET', '/auth/session')).json().user,
    ).toBeNull()
  })
  it('exclusão reautentica, anonimiza e invalida a conta', async () => {
    await pool.query(
      "INSERT INTO reviews(contract_id,athlete_id,coach_id,rating,body,reply) VALUES($1,$2,$3,5,'Experiência privada anterior','Resposta profissional anterior')",
      [contractId, athlete.user.id, coach.user.id],
    )
    expect(
      (
        await call(athlete, 'POST', '/privacy/delete', {
          password: 'SenhaErrada123!',
        })
      ).statusCode,
    ).toBe(401)
    const response = await call(athlete, 'POST', '/privacy/delete', {
      password: 'SenhaTeste123!',
    })
    expect(response.statusCode, response.body).toBe(200)
    expect((await call(athlete, 'GET', '/auth/session')).json().user).toBeNull()
    expect(
      (
        await call(null, 'POST', '/auth/native/login', {
          email: athlete.user.email,
          password: 'SenhaTeste123!',
        })
      ).statusCode,
    ).toBe(401)
    const record = (
      await pool.query('SELECT name,email,disabled_at FROM users WHERE id=$1', [
        athlete.user.id,
      ])
    ).rows[0]
    expect(record.name).toBe('Conta encerrada')
    expect(record.email).not.toBe(athlete.user.email)
    expect(record.disabled_at).toBeTruthy()
    expect(
      (
        await pool.query(
          'SELECT status FROM privacy_requests WHERE user_id=$1',
          [athlete.user.id],
        )
      ).rows[0].status,
    ).toBe('completed')
    const review = (
      await pool.query(
        'SELECT body,reply,hidden FROM reviews WHERE contract_id=$1',
        [contractId],
      )
    ).rows[0]
    expect(review).toEqual({
      body: 'Conteúdo eliminado pelo titular.',
      reply: null,
      hidden: true,
    })
  })
})
