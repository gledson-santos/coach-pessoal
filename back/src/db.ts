import mysql from "mysql2/promise";
import { config } from "./config";

const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  waitForConnections: true,
  connectionLimit: config.database.connectionLimit,
  enableKeepAlive: true,
});

export const getPool = () => pool;

export type DbConnection = mysql.PoolConnection;

export const withConnection = async <T>(handler: (conn: DbConnection) => Promise<T>): Promise<T> => {
  const connection = await pool.getConnection();
  try {
    return await handler(connection);
  } finally {
    connection.release();
  }
};
