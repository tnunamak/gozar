import { createInterface } from 'node:readline/promises';
import { gozarError } from './error-normalizer.mjs';

/** Generic CLI intake. Secret TTY input is never echoed; no descriptor chooses a provider branch. */
export async function promptInputRequirement(descriptor, { stdin = process.stdin, stderr = process.stderr } = {}) {
  stderr.write(`${descriptor.label}${descriptor.required ? ' (required)' : ''}\n`);
  if (descriptor.help) stderr.write(`${descriptor.help}\n`);
  if (descriptor.obtainUrl) stderr.write(`Obtain: ${descriptor.obtainUrl}\n`);
  if (!descriptor.secret || !stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    stderr.write(descriptor.secret ? 'Secret (hidden): ' : 'Value: ');
    const reader = createInterface({ input: stdin, terminal: false });
    try { return await reader.question(''); } finally { reader.close(); }
  }
  const wasRaw = stdin.isRaw;
  return new Promise((resolve, reject) => {
    let text = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      stdin.off('data', data); stdin.off('end', ended); stdin.off('error', failed);
      // A hung-up PTY may reject mode changes. Still retire listeners and settle
      // the read; never let cleanup turn EOF into an uncaught process exception.
      try { stdin.setRawMode(wasRaw); }
      catch { error ??= gozarError('invalid_input', 'Input terminal mode could not be restored'); }
      stdin.pause(); stderr.write('\n');
      error ? reject(error) : resolve(value);
    };
    const ended = () => finish(gozarError('invalid_input', 'Input ended before a value was submitted'));
    const failed = () => finish(gozarError('invalid_input', 'Input could not be read'));
    const data = bytes => {
      for (const character of bytes.toString('utf8')) {
        if (character === '\r' || character === '\n') { finish(null, text); return; }
        if (character === '\u0003') { finish(gozarError('invalid_input', 'Input cancelled')); return; }
        if (character === '\u007f' || character === '\b') text = text.slice(0, -1);
        else if (character >= ' ') text += character;
        if (Buffer.byteLength(text) > 65536) { finish(gozarError('invalid_input', 'Input is too long')); return; }
      }
    };
    stdin.setRawMode(true); stdin.on('data', data); stdin.once('end', ended); stdin.once('error', failed);
    // Display readiness only after echo is disabled and handlers are installed.
    stderr.write('Secret (hidden): '); stdin.resume();
  });
}
