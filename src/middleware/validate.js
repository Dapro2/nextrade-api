const Joi = require('joi');

function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], { abortEarly: false });
    if (error) {
      const details = error.details.map((d) => d.message);
      return res.status(400).json({ error: 'Validation failed', details });
    }
    req[property] = value; // use sanitised value
    next();
  };
}

// Schemas
const schemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(64).required(),
    full_name: Joi.string().min(2).max(100).required(),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    totp_code: Joi.string().length(6).optional(),
  }),

  trade: Joi.object({
    pair: Joi.string().uppercase().pattern(/^[A-Z]+\/[A-Z]+$/).required(),
    side: Joi.string().valid('buy', 'sell').required(),
    amount: Joi.number().positive().precision(8).required(),
    order_type: Joi.string().valid('market', 'limit').default('market'),
    limit_price: Joi.when('order_type', {
      is: 'limit',
      then: Joi.number().positive().required(),
      otherwise: Joi.forbidden(),
    }),
  }),

  deposit: Joi.object({
    coin: Joi.string().uppercase().min(2).max(10).required(),
    amount: Joi.number().positive().precision(8).required(),
  }),
};

module.exports = { validate, schemas };
