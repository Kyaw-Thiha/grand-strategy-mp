import { describe, test, expect, beforeAll } from 'bun:test'
import app from '../index'

const TEST_EMAIL = `test_${Date.now()}@example.com`
const TEST_PASSWORD = 'testpassword123'
let token: string

describe('POST /auth/email', () => {
  test('registers a new user and returns a JWT', async () => {
    const res = await app.request('/auth/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string }
    expect(body.token).toBeString()
    token = body.token
  })

  test('logs in an existing user with correct password', async () => {
    const res = await app.request('/auth/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string }
    expect(body.token).toBeString()
  })

  test('rejects wrong password with 401', async () => {
    const res = await app.request('/auth/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
  })

  test('rejects missing fields with 400', async () => {
    const res = await app.request('/auth/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /auth/refresh', () => {
  test('issues a new token from a valid token', async () => {
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { token: string }
    expect(body.token).toBeString()
  })

  test('rejects missing token with 401', async () => {
    const res = await app.request('/auth/refresh', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

describe('GET /profile', () => {
  test('returns player data with valid JWT', async () => {
    const res = await app.request('/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { email: string }
    expect(body.email).toBe(TEST_EMAIL)
  })

  test('rejects request without JWT with 401', async () => {
    const res = await app.request('/profile')
    expect(res.status).toBe(401)
  })
})
