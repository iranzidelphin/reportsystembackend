let keepAliveTimer = null

function startKeepAlive() {
  if (keepAliveTimer) return keepAliveTimer
  if (process.env.NODE_ENV !== 'production' || !process.env.RENDER_URL) return null

  const interval = Number(process.env.KEEP_ALIVE_INTERVAL || 780000)
  const healthUrl = `${process.env.RENDER_URL.replace(/\/+$/, '')}/health`

  const ping = async () => {
    try {
      const response = await fetch(healthUrl)
      if (response.ok) {
        console.log(`Keep-alive health check succeeded: ${response.status}`)
      } else {
        console.warn(`Keep-alive health check failed: ${response.status}`)
      }
    } catch (error) {
      console.warn(`Keep-alive health check error: ${error.message}`)
    }
  }

  // Render Free Tier can spin services down when idle; this periodic /health
  // request keeps the deployed service active without touching the database.
  keepAliveTimer = setInterval(ping, interval)
  keepAliveTimer.unref?.()
  ping()
  return keepAliveTimer
}

module.exports = { startKeepAlive }
