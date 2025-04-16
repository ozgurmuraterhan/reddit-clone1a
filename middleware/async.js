/**
 * Async handler middleware to avoid try/catch blocks in controllers
 * This wraps async controller functions and forwards any errors to Express error handler
 *
 * @param {Function} fn - Async controller function to wrap
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
