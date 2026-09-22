import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, authed, createUser, resetDatabase } from './helpers/fixtures.js';
import { getDb } from '../src/db/index.js';

describe('authentication', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('registers a user, hashes the password and returns a session', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Aria Kapoor', email: 'Aria@Example.com', password: 'Passw0rd!' })
      .expect(201);

    expect(response.body.user).toMatchObject({ email: 'aria@example.com', role: 'USER' });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const stored = getDb()
      .prepare<[string], { password_hash: string }>('SELECT password_hash FROM users WHERE email = ?')
      .get('aria@example.com');
    expect(stored?.password_hash).toBeDefined();
    expect(stored?.password_hash).not.toContain('Passw0rd!');
    expect(stored?.password_hash.startsWith('$2')).toBe(true);
  });

  it('rejects a weak password and a malformed email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'a@example.com', password: 'short' })
      .expect(400);
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'Passw0rd!' })
      .expect(400);
  });

  it('never lets a client assign itself the ADMIN role', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sneaky', email: 'sneaky@example.com', password: 'Passw0rd!', role: 'ADMIN' })
      .expect(201);
    expect(response.body.user.role).toBe('USER');
  });

  it('refuses a duplicate email with 409', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'First', email: 'dup@example.com', password: 'Passw0rd!' })
      .expect(201);
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Second', email: 'DUP@example.com', password: 'Passw0rd!' })
      .expect(409);
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await createUser({ email: 'login@example.com' });
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'Passw0rd!' })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrong-password' })
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password: 'Passw0rd!' })
      .expect(401);
  });

  it('returns the current user and protects the endpoint', async () => {
    const user = await createUser({ name: 'Nina Rao' });
    const me = await request(app).get('/api/auth/me').set(authed(user.token)).expect(200);
    expect(me.body.user).toMatchObject({ id: user.id, name: 'Nina Rao' });

    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set(authed('not-a-real-token')).expect(401);
  });

  it('clears the session cookie on logout', async () => {
    const agent = request.agent(app);
    await createUser({ email: 'logout@example.com' });
    await agent.post('/api/auth/login').send({ email: 'logout@example.com', password: 'Passw0rd!' }).expect(200);
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });
});
