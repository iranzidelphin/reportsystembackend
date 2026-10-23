require('dotenv').config()

const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const auth = require('./controllers/auth')
const tx = require('./controllers/transactions')
const core = require('./controllers/core')
const pdf = require('./controllers/pdf')
const products = require('./controllers/products')
const offlineSync = require('./controllers/offlineSync')
const { protect, allow } = require('./middleware/auth')
const error = require('./middleware/error')

const app = express()
const isDevelopment = process.env.NODE_ENV !== 'production'
const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((url) => url.trim().replace(/\/+$/, ''))
  .filter(Boolean)

app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || clientUrls.includes(origin.replace(/\/+$/, ''))) return callback(null, true)

    // Vite may choose a different port when its default port is already busy.
    if (isDevelopment) {
      try {
        const { hostname, protocol } = new URL(origin)
        if (protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname)) {
          return callback(null, true)
        }
      } catch {
        // Invalid Origin values are rejected below.
      }
    }

    // A disallowed Origin should omit CORS headers without throwing a server error.
    return callback(null, false)
  },
}))
app.use(express.json({ limit: '100kb' }))
app.use(morgan('dev'))

app.get('/', (req, res) => res.status(200).json({ status: 'ok', message: 'manageyourstock API running' }))
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }))
app.get('/api/health', (req, res) => res.json({ success: true, message: 'manageyourstock API running' }))

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try later.' },
})
const syncLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'SYNC_RATE_LIMITED', message: 'Too many sync requests. Your queued records are safe; retry shortly.' },
})

function registerApiRoutes(prefix = '/api') {
  app.post(`${prefix}/auth/login`, loginLimit, auth.login)
  app.post(`${prefix}/auth/logout`, protect, auth.logout)
  app.get(`${prefix}/auth/me`, protect, auth.me)
  app.post(`${prefix}/auth/change-password`, protect, auth.changePassword)

  app.get(`${prefix}/dashboard/summary`, protect, core.dashboard)
  app.post(`${prefix}/sync/batch`, protect, allow('ADMIN', 'MANAGER', 'STAFF'), syncLimit, offlineSync.batch)


  app.route(`${prefix}/products`)
    .get(protect, products.list)
    .post(protect, allow('ADMIN'), products.create)
  app.get(`${prefix}/products/options`, protect, products.options)
  app.post(`${prefix}/products/options`, protect, allow('ADMIN'), products.createOption)
  app.patch(`${prefix}/products/options/:field`, protect, allow('ADMIN'), products.updateOption)
  app.route(`${prefix}/products/:id`)
    .get(protect, products.get)
    .put(protect, allow('ADMIN'), products.update)
    .delete(protect, allow('ADMIN'), products.remove)

  app.route(`${prefix}/transactions`)
    .get(protect, tx.list)
    .post(protect, allow('ADMIN', 'MANAGER', 'STAFF'), tx.create)
  app.post(`${prefix}/transactions/batch`, protect, allow('ADMIN', 'MANAGER', 'STAFF'), tx.createBatch)

  app.route(`${prefix}/transactions/:id`)
    .get(protect, tx.get)
    .put(protect, allow('ADMIN', 'MANAGER', 'STAFF'), tx.update)
    .delete(protect, allow('ADMIN', 'MANAGER', 'STAFF'), tx.remove)

  app.route(`${prefix}/expenses`)
    .get(protect, core.expenses.list)
    .post(protect, allow('ADMIN'), core.expenses.create)

  app.route(`${prefix}/expenses/:id`)
    .put(protect, allow('ADMIN'), core.expenses.update)
    .delete(protect, allow('ADMIN'), core.expenses.remove)

  app.get(`${prefix}/reports/sales`, protect, core.report)
  app.get(`${prefix}/reports/sales/pdf`, protect, pdf.salesPdf)
  app.get(`${prefix}/reports/imported-stock/pdf`, protect, pdf.stockPdf)
  app.get(`${prefix}/activity-logs`, protect, allow('ADMIN'), core.logs)

  app.route(`${prefix}/users`)
    .get(protect, allow('ADMIN'), core.users.list)
    .post(protect, allow('ADMIN'), core.users.create)

  app.route(`${prefix}/users/:id`)
    .put(protect, allow('ADMIN'), core.users.update)
    .delete(protect, allow('ADMIN'), core.users.remove)
}

registerApiRoutes('/api')

// Compatibility aliases prevent "Route not found" if a deployed frontend
// accidentally points VITE_API_URL at the backend root instead of /api.
registerApiRoutes('')

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }))
app.use(error)

module.exports = app
