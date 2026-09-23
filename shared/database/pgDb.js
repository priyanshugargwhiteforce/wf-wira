// db.js
const pkg = require("pg");
const path = require("path");
require("dotenv").config(
  { 
    quiet: true, 
    path: path.resolve(__dirname, "../../.env") 
  }
);

const pool = new pkg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

module.exports = pool;
