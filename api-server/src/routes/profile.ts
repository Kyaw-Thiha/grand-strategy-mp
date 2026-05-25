import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { players } from '../db/schema'

type JwtPayload = { sub: string; steam_id: string; has_host_pass: boolean }

const profile = new Hono()

profile.get('/', async (c) => {
  const payload = c.get('jwtPayload') as JwtPayload
  const [player] = await db.select({
    id: players.id,
    email: players.email,
    steamId: players.steamId,
    hasHostPass: players.hasHostPass,
    createdAt: players.createdAt,
  }).from(players).where(eq(players.id, payload.sub)).limit(1)

  if (!player) return c.json({ error: 'Player not found' }, 404)
  return c.json(player)
})

profile.put('/', async (c) => {
  const payload = c.get('jwtPayload') as JwtPayload
  const { email } = await c.req.json<{ email?: string }>()

  if (!email) return c.json({ error: 'Nothing to update' }, 400)

  const [updated] = await db.update(players)
    .set({ email })
    .where(eq(players.id, payload.sub))
    .returning({ id: players.id, email: players.email })

  return c.json(updated)
})

export default profile
