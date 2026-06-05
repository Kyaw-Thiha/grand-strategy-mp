import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { players, gameSessions } from '../db/schema'
import { lobbies } from '../lobby-store'

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

/**
 * POST /internal/game-end
 * Called by Colyseus when a game room ends. Writes results to game_sessions and
 * removes the lobby entry so it no longer shows in /lobby/public.
 * Body: { room_id: string, result_json?: unknown, started_at?: string }
 */
internal.post('/game-end', async (c) => {
  const body = await c.req.json<{
    room_id?: string
    result_json?: unknown
    started_at?: string
  }>()

  const [session] = await db.insert(gameSessions).values({
    startedAt: body.started_at ? new Date(body.started_at) : new Date(),
    endedAt: new Date(),
    resultJson: body.result_json ?? null,
  }).returning()

  // Clean up the in-memory lobby entry for this room
  if (body.room_id) {
    for (const [code, entry] of Array.from(lobbies.entries())) {
      if (entry.room_id === body.room_id) {
        lobbies.delete(code)
        break
      }
    }
  }

  return c.json({ session_id: session.id })
})

export default internal
