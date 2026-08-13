const { register } = require("tsx/cjs/api");

register();

const { handler } = require("./serverless.ts");

module.exports.handler = handler;
