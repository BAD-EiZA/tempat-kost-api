/**
 * Vercel serverless entry — nest build must produce dist/ first.
 * Unwraps CJS default export from Nest main.
 */
const mod = require('../dist/main.js');
module.exports = mod.default || mod;
