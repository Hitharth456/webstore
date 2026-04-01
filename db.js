const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'webstore.db');
const db = new sqlite3.Database(dbPath);

const init = () => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image TEXT,
      color TEXT,
      size TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      orderCode TEXT UNIQUE,
      status TEXT DEFAULT 'Pending',
      total REAL NOT NULL,
      shippingAddress TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER,
      productId INTEGER,
      quantity INTEGER,
      unitPrice REAL,
      FOREIGN KEY (orderId) REFERENCES orders(id),
      FOREIGN KEY (productId) REFERENCES products(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      productId INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, productId),
      FOREIGN KEY (userId) REFERENCES users(id),
      FOREIGN KEY (productId) REFERENCES products(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      description TEXT,
      discountPercent INTEGER,
      active INTEGER DEFAULT 1,
      expiresAt DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expiresAt DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      FOREIGN KEY (userId) REFERENCES users(id)
    )`);

    db.get(`SELECT COUNT(*) as c FROM users WHERE role='admin'`, (err, row) => {
      if (!err && row.c === 0) {
        const bcrypt = require('bcrypt');
        const pass = 'admin123';
        bcrypt.hash(pass, 10, (e, hash) => {
          if (!e) {
            db.run(`INSERT OR IGNORE INTO users (email, username, passwordHash, role) VALUES (?, ?, ?, 'admin')`,
              ['admin@streetstyle.io', 'Admin', hash]);
            console.log('Created default admin user: admin@streetstyle.io / admin123');
          }
        });
      }
    });

    db.get(`SELECT COUNT(*) as c FROM products`, (err, row) => {
      if (!err && row.c === 0) {
        const stmt = db.prepare(`INSERT INTO products (name, description, price, image, color, size, stock) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const items = [
          ['Urban Snapback Hoodie', 'Black oversized hoodie with neon accents.', 54.99, 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=640&q=80', 'Black', 'M', 40],
          ['Graffiti Logo Tee', 'Vintage fit cotton tee with graffiti print.', 29.99, 'https://images.unsplash.com/photo-1495121605193-b116b5b09a60?auto=format&fit=crop&w=640&q=80', 'White', 'L', 60],
          ['Slim Cargo Pants', 'taupe cargo pants with utility pockets.', 69.99, 'https://images.unsplash.com/photo-1495121605193-b116b5b09a60?auto=format&fit=crop&w=640&q=80', 'Taupe', 'S', 30],
          ['Runner Street Sneakers', 'Lightweight street runner sneakers.', 89.99, 'https://images.unsplash.com/photo-1552346152-5d9f8f632111?auto=format&fit=crop&w=640&q=80', 'Grey', '42', 20]
        ];
        items.forEach(i => stmt.run(...i));
        stmt.finalize();
      }
    });
  });
};

module.exports = { db, init };
