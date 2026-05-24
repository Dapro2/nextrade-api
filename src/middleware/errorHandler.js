function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);

  // CORS errors
  if (err.message && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({ error: err.message });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Postgres unique violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Resource already exists' });
  }

  // Postgres foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced resource not found' });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : 'Internal server error';

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
