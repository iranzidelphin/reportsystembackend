const app = require('./app')
const connectDb = require('./config/db')
const { ensureDefaultAdmin } = require('./utils/defaultAdmin')
const { startKeepAlive } = require('./utils/keepAlive')

const port = process.env.PORT || 5000

connectDb()
  .then(async () => {
    await ensureDefaultAdmin()
    app.listen(port, () => {
      console.log(`API listening on ${port}`)
      startKeepAlive()
    })
  })
  .catch((error) => {
    console.error('Database connection failed:', error.message)
    process.exit(1)
  })
