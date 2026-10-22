/**
 * End-to-end smoke test against a running server.
 *
 *   npm run dev          # terminal 1
 *   npm run smoke        # terminal 2
 *
 * Exercises one message per intent and prints what the router decided.
 * Fails loudly when a reply is missing or the server is unreachable.
 */
const { io } = require('socket.io-client');
const { readFileSync, existsSync } = require('fs');

/** Reads PORT out of .env so the smoke test always targets the right server. */
function portFromEnvFile() {
  if (!existsSync('.env')) return '3100';
  const match = readFileSync('.env', 'utf8').match(/^PORT=(\d+)/m);
  return match ? match[1] : '3100';
}

const URL = process.env.SMOKE_URL || `http://localhost:${portFromEnvFile()}`;

const CASES = [
  { label: 'billing', text: 'Refund chahiye, 10 din pehle subscribe kiya tha' },
  { label: 'tech', text: 'Login nahi ho raha, password reset email bhi nahi aaya' },
  { label: 'sales', text: 'Team plan ka pricing kya hai?' },
  { label: 'handoff', text: ' Mujhe bas abhi human se baat karni hai ' },
];

function ask(socket, text) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for reply to: ${text}`)), 40000);

    socket.once('chat:reply', (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    socket.once('error', (data) => {
      clearTimeout(timer);
      reject(new Error(data.message));
    });

    socket.emit('chat:send', { content: text });
  });
}

async function main() {
  const socket = io(URL, { transports: ['websocket'], timeout: 10000 });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`could not connect to ${URL}`)), 10000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`connect_error: ${err.message}`));
    });
  });

  console.log(`connected: ${socket.id}\n`);

  let failures = 0;

  for (const testCase of CASES) {
    try {
      const reply = await ask(socket, testCase.text);
      const ok = Boolean(reply.content && reply.intent);

      console.log(
        `[${ok ? 'PASS' : 'FAIL'}] ${testCase.label.padEnd(8)} -> intent=${reply.intent} ` +
          `confidence=${reply.confidence.toFixed(2)} agent=${reply.agent} ` +
          `sources=${reply.sources.length} handoff=${reply.needsHuman}`,
      );
      console.log(`         "${reply.content.slice(0, 110).replace(/\n/g, ' ')}..."\n`);

      if (!ok) failures++;
    } catch (err) {
      failures++;
      console.log(`[FAIL] ${testCase.label.padEnd(8)} -> ${err.message}\n`);
    }
  }

  socket.close();
  console.log(failures === 0 ? 'All smoke tests passed.' : `${failures} smoke test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`Smoke test aborted: ${err.message}`);
  process.exit(1);
});
