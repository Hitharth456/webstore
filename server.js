require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { db, init } = require('./db');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_XXXXXXXXXXXXXXXXXXXXXXXX');

let mailTransporter;
const setupMailTransport = async () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    mailTransporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log('Ethereal test account created:', testAccount.user, testAccount.pass);
  }
};

setupMailTransport().catch((err) => {
  console.error('Failed to setup mail transport', err);
});

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'streetstyle-secret';

init();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  next();
};

app.post('/api/auth/register', (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
  db.get('SELECT * FROM users WHERE email=?', [email], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (row) return res.status(409).json({ message: 'Email exists' });
    bcrypt.hash(password, 10, (err2, hash) => {
      if (err2) return res.status(500).json({ message: 'Hash error' });
      db.run('INSERT INTO users (email, username, passwordHash, role) VALUES (?, ?, ?, ?)', [email, username || '', hash, 'customer'], function(err3) {
        if (err3) return res.status(500).json({ message: 'Inserterror' });
        const user = { id: this.lastID, email, username: username || '', role: 'customer' };
        const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

        const mailOptions = {
          from: process.env.SMTP_FROM || 'StreetStyle Store <no-reply@streetstyle.io>',
          to: email,
          subject: 'Welcome to StreetStyle!',
          html: `<p>Hi ${username || email},</p><p>Welcome to <strong>StreetStyle</strong>! You can now explore the latest street-style fashion catalog, save favorites, and checkout with great offers.</p><p>Happy shopping!</p><p>– StreetStyle Team</p>`
        };
      if (!mailTransporter) {
        console.warn('Mail transporter not ready yet');
      } else {
        mailTransporter.sendMail(mailOptions, (mailErr, info) => {
          if (mailErr) {
            console.error('Welcome email failed', mailErr);
          } else {
            console.log('Welcome email sent', info.response);
            if (nodemailer.getTestMessageUrl(info)) {
              console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
            }
          }
        });
      }

      res.json({ user, token });
      });
    });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
  db.get('SELECT * FROM users WHERE email=?', [email], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!row) return res.status(401).json({ message: 'Invalid credentials' });
    bcrypt.compare(password, row.passwordHash, (e, valid) => {
      if (e || !valid) return res.status(401).json({ message: 'Invalid credentials' });
      const user = { id: row.id, email: row.email, username: row.username, role: row.role };
      const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
      res.json({ user, token });
    });
  });
});

app.post('/api/password-reset-request', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });
  db.get('SELECT * FROM users WHERE email=?', [email], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!row) return res.json({ message: 'If email exists, reset link sent' });
    const token = require('crypto').randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    db.run('INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, ?)', [row.id, token, expiresAt], function(err2) {
      if (err2) return res.status(500).json({ message: 'Database error' });
      // In production send email; for dev return token URL.
      return res.json({ message: 'Password reset link generated', resetUrl: `${req.protocol}://${req.get('host')}/reset-password?token=${token}` });
    });
  });
});

app.post('/api/password-reset', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ message: 'Token and new password required' });
  db.get('SELECT * FROM password_reset_tokens WHERE token=? AND used=0', [token], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!row) return res.status(400).json({ message: 'Invalid token' });
    if (new Date(row.expiresAt) < new Date()) return res.status(400).json({ message: 'Token expired' });
    bcrypt.hash(newPassword, 10, (e, hash) => {
      if (e) return res.status(500).json({ message: 'Hash error' });
      db.run('UPDATE users SET passwordHash=? WHERE id=?', [hash, row.userId], function(err2) {
        if (err2) return res.status(500).json({ message: 'Database error' });
        db.run('UPDATE password_reset_tokens SET used=1 WHERE id=?', [row.id]);
        res.json({ message: 'Password updated successfully' });
      });
    });
  });
});

app.post('/api/admin/change-password', authMiddleware, adminMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ message: 'Old + new password required' });
  db.get('SELECT * FROM users WHERE id=?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!row) return res.status(404).json({ message: 'Admin user not found' });
    bcrypt.compare(oldPassword, row.passwordHash, (e, valid) => {
      if (e || !valid) return res.status(403).json({ message: 'Old password incorrect' });
      bcrypt.hash(newPassword, 10, (err2, hash) => {
        if (err2) return res.status(500).json({ message: 'Hash error' });
        db.run('UPDATE users SET passwordHash=? WHERE id=?', [hash, req.user.id], (err3) => {
          if (err3) return res.status(500).json({ message: 'Database error' });
          res.json({ message: 'Admin password changed successfully' });
        });
      });
    });
  });
});

app.get('/api/products', async (req, res) => {
  const { size, color, minPrice, maxPrice, q } = req.query;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    let query = supabase.from('products').select('*').eq('active', true);
    if (size) query = query.eq('size', size);
    if (color) query = query.eq('color', color);
    if (minPrice) query = query.gte('price', Number(minPrice));
    if (maxPrice) query = query.lte('price', Number(maxPrice));
    if (q) query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) {
      console.error('Supabase products error', error);
      return res.status(500).json({ message: 'Database error' });
    }
    return res.json(data || []);
  }

  let query = 'SELECT * FROM products WHERE active=1';
  const filters = [];
  const params = [];
  if (size) { filters.push('size = ?'); params.push(size); }
  if (color) { filters.push('color = ?'); params.push(color); }
  if (minPrice) { filters.push('price >= ?'); params.push(Number(minPrice)); }
  if (maxPrice) { filters.push('price <= ?'); params.push(Number(maxPrice)); }
  if (q) { filters.push('(name LIKE ? OR description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (filters.length) query += ' AND ' + filters.join(' AND ');
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/product/:id', (req, res) => {
  db.get('SELECT * FROM products WHERE id=?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!row) return res.status(404).json({ message: 'Product not found' });
    res.json(row);
  });
});

app.use('/api/user', authMiddleware);

app.get('/api/user/profile', (req, res) => {
  db.get('SELECT id, email, username, role, createdAt FROM users WHERE id=?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(row);
  });
});

app.get('/api/user/wishlist', (req, res) => {
  db.all(`SELECT p.* FROM wishlist w JOIN products p ON w.productId=p.id WHERE w.userId=?`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/user/wishlist', (req, res) => {
  const { productId } = req.body;
  db.run('INSERT OR IGNORE INTO wishlist (userId, productId) VALUES (?, ?)', [req.user.id, productId], function(err) {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json({ success: true });
  });
});

app.delete('/api/user/wishlist/:productId', (req, res) => {
  db.run('DELETE FROM wishlist WHERE userId=? AND productId=?', [req.user.id, req.params.productId], function(err) {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json({ success: true });
  });
});

app.post('/api/checkout', authMiddleware, (req, res) => {
  const { cart, shippingAddress, promoCode } = req.body;
  if (!cart || !Array.isArray(cart) || cart.length === 0) return res.status(400).json({ message: 'Cart is empty' });
  let total = 0;
  const items = [];

  const doCalc = () => {
    cart.forEach(item => {
      total += item.price * item.quantity;
      items.push(item);
    });
    if (promoCode) {
      db.get('SELECT * FROM promo_codes WHERE code=? AND active=1 AND (expiresAt IS NULL OR expiresAt > CURRENT_TIMESTAMP)', [promoCode], (err, promo) => {
        if (!err && promo) {
          total = total * (1 - promo.discountPercent / 100);
        }
        saveOrder(total);
      });
    } else {
      saveOrder(total);
    }
  };

  const saveOrder = (finalTotal) => {
    const code = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    db.run('INSERT INTO orders (userId, orderCode, total, shippingAddress, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, code, finalTotal, JSON.stringify(shippingAddress), 'Processing'], function(err) {
      if (err) return res.status(500).json({ message: 'Unable to create order' });
      const orderId = this.lastID;
      const stmt = db.prepare('INSERT INTO order_items (orderId, productId, quantity, unitPrice) VALUES (?, ?, ?, ?)');
      items.forEach(item => stmt.run(orderId, item.id, item.quantity, item.price));
      stmt.finalize();
      res.json({ orderId, orderCode: code, total: finalTotal, status: 'Processing' });
    });
  };

  doCalc();
});

app.post('/api/checkout-session', authMiddleware, async (req, res) => {
  const { cart, shippingAddress, promoCode } = req.body;
  if (!cart || !cart.length) return res.status(400).json({ message: 'Cart is empty' });
  try {
    const line_items = cart.map(item => ({
      price_data: {
        currency: 'inr',
        product_data: { name: item.name, description: item.description || '' },
        unit_amount: Math.round(item.price * 100) // rupees to paise
      },
      quantity: item.quantity
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      success_url: `${req.protocol}://${req.get('host')}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}`,
      metadata: {
        userId: req.user.id,
        promoCode: promoCode || ''
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error', error);
    res.status(500).json({ message: 'Payment gateway error' });
  }
});

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_testsecret';
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.log('Webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // fallback: you can map by customer email or metadata to update order status later.
    console.log('Checkout completed:', session.id);
  }

  res.json({ received: true });
});

app.get('/api/order/:orderCode/status', (req, res) => {
  db.get('SELECT id, orderCode, status, total, shippingAddress, createdAt, updatedAt FROM orders WHERE orderCode=?', [req.params.orderCode], (err, row) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (!row) return res.status(404).json({ message: 'Order not found' });
    res.json(row);
  });
});

app.get('/api/user/orders', authMiddleware, (req, res) => {
  db.all('SELECT id, orderCode, status, total, createdAt FROM orders WHERE userId=? ORDER BY createdAt DESC', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(rows);
  });
});

// admin routes
app.get('/api/admin/orders', authMiddleware, adminMiddleware, (req, res) => {
  db.all('SELECT * FROM orders ORDER BY createdAt DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(rows);
  });
});

app.put('/api/admin/order/:id/status', authMiddleware, adminMiddleware, (req, res) => {
  const { status } = req.body;
  db.run('UPDATE orders SET status=?, updatedAt=CURRENT_TIMESTAMP WHERE id=?', [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json({ success: true });
  });
});

app.get('/api/admin/products', authMiddleware, adminMiddleware, (req, res) => {
  db.all('SELECT * FROM products ORDER BY createdAt DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/admin/product', authMiddleware, adminMiddleware, (req, res) => {
  const { name, description, price, image, color, size, stock, active } = req.body;
  db.run('INSERT INTO products (name, description, price, image, color, size, stock, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [name, description, price, image, color, size, stock, active ? 1 : 0], function(err) {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json({ id: this.lastID, success: true });
    });
});

app.put('/api/admin/product/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { name, description, price, image, color, size, stock, active } = req.body;
  db.run('UPDATE products SET name=?, description=?, price=?, image=?, color=?, size=?, stock=?, active=? WHERE id=?',
    [name, description, price, image, color, size, stock, active ? 1 : 0, req.params.id], function(err) {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json({ success: true });
    });
});

app.delete('/api/admin/product/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.run('DELETE FROM products WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ message: 'Database error' });
    res.json({ success: true });
  });
});

app.get('/api/admin/analytics', authMiddleware, adminMiddleware, (req, res) => {
  db.get('SELECT COUNT(*) AS totalUsers FROM users', [], (err, userRow) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    db.get('SELECT COUNT(*) AS totalOrders, SUM(total) AS revenue FROM orders', [], (err2, orderRow) => {
      if (err2) return res.status(500).json({ message: 'Database error' });
      db.get('SELECT COUNT(*) AS totalProducts FROM products', [], (err3, productRow) => {
        if (err3) return res.status(500).json({ message: 'Database error' });
        res.json({ users: userRow.totalUsers, orders: orderRow.totalOrders || 0, revenue: orderRow.revenue || 0, products: productRow.totalProducts });
      });
    });
  });
});

// support contact
app.get('/api/support', (req, res) => {
  res.json({ phone: '+1-800-STREET', email: 'support@streetstyle.io', chatUrl: 'https://tawk.to/chat/demo' });
});

// serve SPA base pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

app.listen(PORT, () => {
  console.log(`Street-style webstore running on http://localhost:${PORT}`);
});
