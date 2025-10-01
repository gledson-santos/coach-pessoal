"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withConnection = exports.getPool = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
const config_1 = require("./config");
const pool = promise_1.default.createPool({
    host: config_1.config.database.host,
    port: config_1.config.database.port,
    user: config_1.config.database.user,
    password: config_1.config.database.password,
    database: config_1.config.database.database,
    waitForConnections: true,
    connectionLimit: config_1.config.database.connectionLimit,
    enableKeepAlive: true,
});
const getPool = () => pool;
exports.getPool = getPool;
const withConnection = async (handler) => {
    const connection = await pool.getConnection();
    try {
        return await handler(connection);
    }
    finally {
        connection.release();
    }
};
exports.withConnection = withConnection;
