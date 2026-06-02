import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import { lobbies } from '../lobby-store'

const lobby = new Hono()

const jwtMiddleware = jwt({ secret: process.env.JWT_SECRET!, alg: 'HS256' })

function generateJoinCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

/**
 * POST /lobby/create
 * Host reserves a join code slot. Requires has_host_pass in JWT.
 * Client must call /lobby/activate after creating the Colyseus room to link the room_id.
 */
lobby.post('/create', jwtMiddleware, async (c) => {
  const payload = c.get('jwtPayload') as { sub: string; has_host_pass: boolean }
  if (!payload.has_host_pass) return c.json({ error: 'Host pass required' }, 403)

  let code: string
  do { code = generateJoinCode() } while (lobbies.has(code))

  lobbies.set(code, {
    join_code: code,
    room_id: null,
    host_player_id: payload.sub,
    created_at: Date.now(),
  })

  return c.json({ join_code: code })
})

/**
 * POST /lobby/activate
 * Host links their Colyseus room_id to the pending join code.
 * Body: { join_code: string, room_id: string }
 */
lobby.post('/activate', jwtMiddleware, async (c) => {
  const payload = c.get('jwtPayload') as { sub: string }
  const { join_code, room_id } = await c.req.json<{ join_code: string; room_id: string }>()

  const entry = lobbies.get(join_code)
  if (!entry) return c.json({ error: 'Invalid join code' }, 404)
  if (entry.host_player_id !== payload.sub) return c.json({ error: 'Forbidden' }, 403)
  if (entry.room_id !== null) return c.json({ error: 'Already activated' }, 409)

  entry.room_id = room_id
  return c.json({ ok: true })
})

/**
 * GET /lobby/resolve/:code
 * Resolves a join code to a Colyseus room_id. Used by joining clients.
 */
lobby.get('/resolve/:code', (c) => {
  const entry = lobbies.get(c.req.param('code').toUpperCase())
  if (!entry || entry.room_id === null) return c.json({ error: 'Lobby not found' }, 404)
  return c.json({ room_id: entry.room_id })
})

/**
 * GET /lobby/public
 * Lists all active (room_id != null) lobbies.
 */
lobby.get('/public', (c) => {
  const open = Array.from(lobbies.values())
    .filter(e => e.room_id !== null)
    .map(e => ({ join_code: e.join_code, room_id: e.room_id, created_at: e.created_at }))
  return c.json(open)
})

export default lobby
