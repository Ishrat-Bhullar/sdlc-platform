const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Invalid request data',
      details: error.details.map((d) => d.message),
    });
  }
  next();
};

// Simple validators without Joi dependency
const validators = {
  required: (fields) => (req, res, next) => {
    const missing = fields.filter((f) => !req.body[f]);
    if (missing.length) {
      return res.status(400).json({
        error: 'ValidationError',
        message: `Missing required fields: ${missing.join(', ')}`,
      });
    }
    next();
  },

  email: (req, res, next) => {
    const { email } = req.body;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'ValidationError', message: 'Invalid email format' });
    }
    next();
  },
};

module.exports = { validate, validators };