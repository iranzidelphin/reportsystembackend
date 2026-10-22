module.exports = (err, req, res, next) => {
  const databaseUnavailable = [
    'MongoServerSelectionError',
    'MongooseServerSelectionError',
    'MongoNetworkError',
  ].includes(err.name) || err.code === 'ENOTFOUND'

  if (databaseUnavailable) {
    console.error('Database unavailable:', err.message)
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'The database is temporarily unreachable. Check your internet or database connection, then try again.',
    })
  }

  console.error(err)
  const status = err.status || 500
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Something went wrong. Please try again.' : err.message,
    errors: err.errors || [],
  })
}
