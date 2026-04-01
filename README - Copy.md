# StreetStyle Webstore

Mobile-first street-style fashion e-commerce MVP with admin dashboard.

## Features
- Product catalog with filtering (size, color, price, search)
- Shopping cart
- Wishlist
- User auth (register/login)
- Secure checkout: Stripe Checkout + backend order persistence
- Order tracking by order code
- Customer support info
- Admin dashboard for products, orders, analytics
- Promo code engine

## Tech stack
- Node.js (Express)
- SQLite
- JWT authentication
- Stripe payment integration
- Frontend with vanilla HTML/CSS/JS (responsive)

## Quick start
1. Create `.env` in project root with keys:
   - `SUPABASE_URL=https://ngttebgoceqerbnyiwrv.supabase.co`
   - `SUPABASE_ANON_KEY=<your-supabase-anon-key>`
   - `STRIPE_SECRET_KEY=<your-stripe-key>`
   - `STRIPE_WEBHOOK_SECRET=<your-whsec>`
   - `JWT_SECRET=<your-jwt-secret>`
   - optional:
     - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
2. Install dependencies:
   - `npm install`
3. Start server:
   - `npm start`
4. Open `http://localhost:3000`
5. Admin panel:
   - `http://localhost:3000/admin`
   - default admin credentials: `admin@streetstyle.io` / `admin123`

## Stripe Checkout
- Checkout uses `/api/checkout-session` and redirects to Stripe.
- Webhook endpoint: `/api/webhook`.

## Notes
- Static product images use placeholder online URLs; you can replace values in `db.js`.
- For production, enable secure `HTTPS`, `helmet`, and strong password policy.
- Add tests with Jest/Supertest or Cypress for E2E.

## Admin password and reset workflows

1. Admin change password endpoint:
   - `POST /api/admin/change-password` with `Authorization: Bearer <token>` and body `{ oldPassword, newPassword }`

2. Password reset request:
   - `POST /api/password-reset-request` with body `{ email }`
   - returns `resetUrl` in dev.

3. Password reset execution:
   - `POST /api/password-reset` with body `{ token, newPassword }`


## Azure deployment shortcut (one command)

1. Add Azure CLI and login:
   - `az login`
2. Create app service:
   - `az webapp up --name streetstyle-webstore --resource-group streetstyle-rg --runtime "NODE|18-lts"`
3. Configure settings:
   - `az webapp config appsettings set --name streetstyle-webstore --resource-group streetstyle-rg --settings JWT_SECRET="your_secret" STRIPE_SECRET_KEY="sk_live_..." SUPABASE_URL="https://ngttebgoceqerbnyiwrv.supabase.co" SUPABASE_ANON_KEY="<anon_key>"`
4. Open app:
   - `az webapp browse --name streetstyle-webstore --resource-group streetstyle-rg`

## Supabase quick setup

- Project URL: https://ngttebgoceqerbnyiwrv.supabase.co
- Anon key: <your anon key>
- Create tables in SQL: 
  - `products`, `users`, `orders`, `order_items`, `wishlist`, `promo_codes`, `password_reset_tokens`
