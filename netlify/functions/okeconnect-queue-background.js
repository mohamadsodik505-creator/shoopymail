const crypto = require('crypto');
const { processQueue } = require('./okeconnect');

exports.handler = async (event) => {
  const expectedSecret = process.env.WITHDRAWAL_QUEUE_SECRET;
  const suppliedSecret =
    event.headers?.['x-withdrawal-queue-secret'] ||
    event.headers?.['X-Withdrawal-Queue-Secret'] ||
    '';

  if (!expectedSecret || !constantTimeEqual(suppliedSecret, expectedSecret)) {
    return { statusCode: 403, body: 'Forbidden' };
  }

  try {
    await processQueue();
    return { statusCode: 200, body: 'Queue processed' };
  } catch (error) {
    console.error('[WITHDRAWAL QUEUE] Background processing failed:', error.message);
    throw error;
  }
};

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
