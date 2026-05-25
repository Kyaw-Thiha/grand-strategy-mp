import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import auth from './routes/auth'
import profile from './routes/profile'
import internal from './routes/internal'

const app = new Hono()

app.route('/auth', auth)

app.use('/profile/*', jwt({ secret: process.env.JWT_SECRET!, alg: 'HS256' }))
app.route('/profile', profile)

// Internal routes — Colyseus only, guarded by INTERNAL_SECRET
app.use('/internal/*', (c, next) => {
  const header = c.req.header('Authorization')
  if (header !== `Internal ${process.env.INTERNAL_SECRET}`) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return next()
})
app.route('/internal', internal)

export default app
