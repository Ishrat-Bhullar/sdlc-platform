const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  if (err.code === '23505') {
    return res.status(409).json({ error: 'Conflict', message: 'Resource already exists' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Bad Request', message: 'Referenced resource not found' });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'Something went wrong',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res) => {
  res.status(404).json({ error: 'NotFound', message: `Route ${req.method} ${req.path} not found` });
};

module.exports = { errorHandler, notFound };