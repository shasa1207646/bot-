import pool from './pool';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS moderator_sessions CASCADE;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id            SERIAL PRIMARY KEY,
        type          VARCHAR(20) NOT NULL DEFAULT 'member',
        discord_id    VARCHAR(30),
        username      VARCHAR(100),
        age           INT,
        name          VARCHAR(100),
        activity      VARCHAR(200),
        games         VARCHAR(300),
        rules         BOOLEAN,
        experience    TEXT,
        motivation    TEXT,
        status        VARCHAR(20) DEFAULT 'pending',
        decided_by    VARCHAR(100),
        created_at    TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE applications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
      ALTER TABLE applications ADD COLUMN IF NOT EXISTS experience TEXT;
      ALTER TABLE applications ADD COLUMN IF NOT EXISTS motivation TEXT;

      CREATE TABLE IF NOT EXISTS oauth_states (
        state             VARCHAR(64) PRIMARY KEY,
        telegram_user_id  TEXT,
        created_at        TIMESTAMP DEFAULT NOW()
      );

      -- Fix: ensure telegram_user_id is TEXT (may be BIGINT in older deployments)
      ALTER TABLE oauth_states ALTER COLUMN telegram_user_id TYPE TEXT USING telegram_user_id::TEXT;

      CREATE TABLE IF NOT EXISTS player_sessions (
        id               VARCHAR(64) PRIMARY KEY,
        discord_id       VARCHAR(30) NOT NULL UNIQUE,
        discord_username VARCHAR(100),
        discord_avatar   VARCHAR(300),
        created_at       TIMESTAMP DEFAULT NOW(),
        expires_at       TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS web_mod_sessions (
        id               VARCHAR(64) PRIMARY KEY,
        discord_id       VARCHAR(30) NOT NULL,
        discord_username VARCHAR(100),
        discord_avatar   VARCHAR(300),
        is_moderator     BOOLEAN DEFAULT false,
        created_at       TIMESTAMP DEFAULT NOW(),
        expires_at       TIMESTAMP
      );

      ALTER TABLE web_mod_sessions ADD COLUMN IF NOT EXISTS telegram_user_id TEXT;

      CREATE TABLE IF NOT EXISTS mutes (
        id          SERIAL PRIMARY KEY,
        user_id     VARCHAR(30) NOT NULL,
        username    VARCHAR(100),
        reason      TEXT,
        muted_at    TIMESTAMP DEFAULT NOW(),
        muted_by    VARCHAR(100),
        expires_at  TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bans (
        id          SERIAL PRIMARY KEY,
        user_id     VARCHAR(30) NOT NULL,
        username    VARCHAR(100),
        reason      TEXT,
        banned_at   TIMESTAMP DEFAULT NOW(),
        banned_by   VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS violations (
        id          SERIAL PRIMARY KEY,
        discord_id  VARCHAR(30) NOT NULL,
        username    VARCHAR(100),
        type        VARCHAR(50) DEFAULT 'badword',
        content     TEXT,
        channel_id  VARCHAR(30),
        logged_at   TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS complaints (
        id               SERIAL PRIMARY KEY,
        reporter_discord VARCHAR(100),
        accused_discord  VARCHAR(100) NOT NULL,
        reason           VARCHAR(200) NOT NULL,
        description      TEXT,
        status           VARCHAR(20) DEFAULT 'pending',
        resolved_by      VARCHAR(100),
        resolved_note    TEXT,
        resolved_at      TIMESTAMP,
        created_at       TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS panel_users (
        id               SERIAL PRIMARY KEY,
        email            VARCHAR(200) UNIQUE NOT NULL,
        password_hash    VARCHAR(200) NOT NULL,
        discord_id       VARCHAR(30),
        discord_username VARCHAR(100),
        discord_avatar   VARCHAR(300),
        role             VARCHAR(20) NOT NULL DEFAULT 'moderator',
        created_at       TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS panel_pending (
        id           VARCHAR(64) PRIMARY KEY,
        email        VARCHAR(200) UNIQUE NOT NULL,
        password_hash VARCHAR(200) NOT NULL,
        panel_role   VARCHAR(20) NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS panel_sessions (
        id               VARCHAR(64) PRIMARY KEY,
        user_id          INT,
        role             VARCHAR(20) NOT NULL,
        discord_username VARCHAR(100),
        discord_avatar   VARCHAR(300),
        created_at       TIMESTAMP DEFAULT NOW(),
        expires_at       TIMESTAMP
      );
    `);

    console.log('[DB] Migrations completed');
  } catch (err) {
    console.error('[DB] Migration error:', err);
  } finally {
    client.release();
  }
}
