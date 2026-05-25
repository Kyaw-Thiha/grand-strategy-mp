import { Hono } from 'hono'
import { sign, verify } from 'hono/jwt'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { players } from '../db/schema'

const auth = new Hono()

const jwtSecret = process.env.JWT_SECRET!
const JWT_TTL = 60 * 60 * 24 // 24h in seconds

function makePayload(player: typeof players.$inferSelect) {
  return {
    sub: player.id,
    steam_id: player.steamId ?? 'dev_steamid',
    has_host_pass: player.hasHostPass,
    exp: Math.floor(Date.now() / 1000) + JWT_TTL,
  }
}

// Register or login with email + password
auth.post('/email', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()

  if (!email || !password) return c.json({ error: 'email and password required' }, 400)

  const [existing] = await db.select().from(players).where(eq(players.email, email)).limit(1)

  let player: typeof players.$inferSelect

  if (!existing) {
    const passwordHash = await Bun.password.hash(password)
    const [created] = await db.insert(players).values({ email, passwordHash }).returning()
    player = created
  } else {
    const valid = await Bun.password.verify(password, existing.passwordHash)
    if (!valid) return c.json({ error: 'Invalid credentials' }, 401)
    player = existing
  }

  const token = await sign(makePayload(player), jwtSecret)
  return c.json({ token })
})

// Issue a fresh token from a valid existing one
auth.post('/refresh', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Missing token' }, 401)

  const oldToken = authHeader.slice(7)
  let payload: { sub: string }
  try {
    payload = await verify(oldToken, jwtSecret, 'HS256') as { sub: string }
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  const [player] = await db.select().from(players).where(eq(players.id, payload.sub)).limit(1)
  if (!player) return c.json({ error: 'Player not found' }, 404)

  const token = await sign(makePayload(player), jwtSecret)
  return c.json({ token })
})

export default auth
