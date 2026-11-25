// Browser stand-in for Node built-ins that libraries reference but never call
// in the browser (Anchor's NodeWallet reads `fs` only under Node).
module.exports = {};
