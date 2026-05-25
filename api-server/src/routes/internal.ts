import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { players } from '../db/schema'

const internal = new Hono()

// Called by Colyseus when a player attempts to create/host a room
internal.get('/verify-host-pass/:userId', async (c) => {
  const [player] = await db
    .select({ hasHostPass: players.hasHostPass })
    .from(players)
    .where(eq(players.id, c.req.param('userId')))
    .limit(1)

  if (!player) return c.json({ error: 'Player not found' }, 404)
  return c.json({ hasHostPass: player.hasHostPass })
})

export default internal
