// Test-environment fixes for Colyseus v0.17 quirks that only manifest
// when multiple test suites share a single mocha process.

// --- Fix 1: transport.shutdown() is not awaited ---
// Server.gracefullyShutdown() calls this.transport.shutdown() without await,
// so the HTTP server still holds the port when the next boot() tries to listen.
// We patch gracefullyShutdown to wait for the HTTP server's 'close' event.
const { Server } = require("@colyseus/core");
const origGracefullyShutdown = Server.prototype.gracefullyShutdown;
Server.prototype.gracefullyShutdown = async function patchedGracefullyShutdown(exit, err) {
  const httpServer = this.transport && this.transport.server;
  // Register before origGracefullyShutdown so we don't miss the event
  const waitForClose = (httpServer && httpServer.listening)
    ? new Promise(function(resolve) { httpServer.once("close", resolve); })
    : Promise.resolve();
  await origGracefullyShutdown.call(this, exit, err);
  // Forcefully terminate any remaining WS connections so the HTTP server's 'close' fires promptly
  const wss = this.transport && this.transport.wss;
  if (wss && wss.clients) {
    wss.clients.forEach(function(ws) { try { ws.terminate(); } catch(_) {} });
  }
  // Close idle HTTP keep-alive connections (WS upgrades leave the underlying
  // TCP connection tracked by Node's HTTP server even after WS termination).
  if (httpServer && typeof httpServer.closeIdleConnections === 'function') {
    httpServer.closeIdleConnections();
  }
  await waitForClose;
};

// --- Fix 2: ERR_HTTP_HEADERS_SENT noise ---
// Colyseus's auth-rejection HTTP flow fires a double-response error asynchronously
// after a suite's server shuts down. In separate mocha processes this was swallowed
// at exit; in a shared process mocha catches it as an uncaughtException and fails
// whatever test happens to be running. We intercept via a root-hook beforeAll so
// we run AFTER mocha registers its own listener, and slot our filter in front of it.
exports.mochaHooks = {
  beforeAll() {
    const prior = process.rawListeners("uncaughtException").slice();
    process.removeAllListeners("uncaughtException");
    process.on("uncaughtException", function (err, origin) {
      if (err && err.code === "ERR_HTTP_HEADERS_SENT") return;
      prior.forEach(function (fn) { fn(err, origin); });
    });
  },
};
