import pg from 'pg';

const config = process.env.INSTANCE_CONNECTION_NAME
  ? {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
    }
  : {
      connectionString: process.env.DATABASE_URL,
    };

const pool = new pg.Pool(config);

export default pool;
