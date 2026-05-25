import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import auth from './routes/auth'
import profile from './routes/profile'

const app = new Hono()

app.route('/auth', auth)

app.use('/profile/*', jwt({ secret: process.env.JWT_SECRET!, alg: 'HS256' }))
app.route('/profile', profile)

export default app
