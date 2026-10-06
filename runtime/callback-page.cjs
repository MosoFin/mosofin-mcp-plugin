'use strict';

// Presentation only. mcp-remote still receives and validates every OAuth
// callback; this swaps its plain-text "return to the CLI" reply for a MosoFin
// page, without ever echoing the code, state, or provider-supplied error text.
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const CALLBACK_PATH = '/oauth/callback';
const template = readFileSync(path.join(__dirname, 'callback.html'), 'utf8');
const logo = readFileSync(path.join(__dirname, '../assets/logo.svg')).toString('base64');

const icons = {
  success: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m8 16 5.5 5.5L24 11"/></svg>',
  failure: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="16" cy="16" r="11"/><path d="M16 10v7m0 5v.1"/></svg>',
};

const copy = {
  success: {
    EYEBROW: 'Signed in',
    TITLE: 'You’re connected to MosoFin.',
    DESCRIPTION: 'Close this tab and go back to the conversation where you started. Say “done” and your question will pick up where it left off.',
    NEXT_STEP: 'Say “done” to continue with your books.',
  },
  failure: {
    EYEBROW: 'Sign-in not finished',
    TITLE: 'Let’s try that again.',
    DESCRIPTION: 'MosoFin sign-in wasn’t completed. Go back to your conversation and ask to sign in to MosoFin when you’re ready.',
    NEXT_STEP: 'Ask to sign in to MosoFin again.',
  },
};

function renderPage(success, nonce) {
  const kind = success ? 'success' : 'failure';
  const values = { NONCE: nonce, LOGO: logo, STATUS_ICON: icons[kind], STATUS: kind, ...copy[kind] };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown callback page field: ${key}`);
    return values[key];
  });
}

// mcp-remote 0.14.2 replies with exactly these bodies; anything else passes through.
function classify(statusCode, body) {
  if (typeof body !== 'string') return undefined;
  if (statusCode === 200 && body.includes('Authorization successful!') && body.includes('return to the CLI.')) return true;
  if (statusCode === 400 && (body.startsWith('Authorization failed:') || body === 'Error: No authorization code received')) return false;
  return undefined;
}

function installCallbackPage() {
  const createServer = http.createServer;
  http.createServer = function (...args) {
    const server = createServer.apply(this, args);
    server.prependListener('request', (request, response) => {
      if (request.method !== 'GET' || request.socket.localAddress !== '127.0.0.1'
          || request.url.split('?', 1)[0] !== CALLBACK_PATH) return;
      const end = response.end;
      response.end = function (chunk, encoding, callback) {
        const body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
        const success = classify(this.statusCode, body);
        if (this.headersSent || success === undefined) return end.call(this, chunk, encoding, callback);
        const nonce = randomBytes(18).toString('base64');
        const html = renderPage(success, nonce);
        this.setHeader('Content-Type', 'text/html; charset=utf-8');
        this.setHeader('Content-Length', Buffer.byteLength(html));
        this.removeHeader('ETag');
        this.setHeader('Cache-Control', 'no-store');
        this.setHeader('Referrer-Policy', 'no-referrer');
        this.setHeader('X-Content-Type-Options', 'nosniff');
        this.setHeader('Content-Security-Policy', `default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
        return end.call(this, html, 'utf8', typeof encoding === 'function' ? encoding : callback);
      };
    });
    return server;
  };
}

module.exports = { installCallbackPage, renderPage, CALLBACK_PATH };
