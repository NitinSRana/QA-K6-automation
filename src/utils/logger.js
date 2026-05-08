const timestamp = () => new Date().toISOString();

const logger = {
  info: (msg, ...args) => console.log(`[${timestamp()}] INFO  ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[${timestamp()}] ERROR ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[${timestamp()}] WARN  ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${timestamp()}] DEBUG ${msg}`, ...args);
    }
  },
};

module.exports = logger;
