import { pgTable, uuid, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const players = pgTable('players', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  steamId: text('steam_id'),
  hasHostPass: boolean('has_host_pass').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const divisionTemplates = pgTable('division_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  templateJson: jsonb('template_json').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const gameSessions = pgTable('game_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  resultJson: jsonb('result_json'),
})
