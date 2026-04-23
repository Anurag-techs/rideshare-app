/**
 * middleware/validate.js
 * Centralized validation using express-validator
 */
const { validationResult } = require('express-validator');

function validate(validations) {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    // Format errors consistently
    const formattedErrors = errors.array().map(err => err.msg).join(', ');
    const error = new Error(formattedErrors);
    error.statusCode = 400;
    return next(error);
  };
}

module.exports = validate;
