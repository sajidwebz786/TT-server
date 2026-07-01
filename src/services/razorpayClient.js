import crypto from "crypto";

const keyId = () => process.env.RAZORPAY_KEY_ID || "";
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || "";
const baseUrl = "https://api.razorpay.com/v1";

export function razorpayConfigured() {
  return Boolean(keyId() && keySecret());
}

export function razorpayTestMode() {
  return keyId().startsWith("rzp_test_");
}

function authHeader() {
  return `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString("base64")}`;
}

async function razorpayRequest(path, body) {
  if (!razorpayConfigured()) throw new Error("Razorpay is not configured");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader()
    },
    body: JSON.stringify(body || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.description || data?.message || `Razorpay request failed with ${response.status}`);
  }
  return data;
}

export async function createRazorpayOrder({ amount, receipt, notes }) {
  const rupees = Number(amount || 0);
  if (!Number.isFinite(rupees) || rupees <= 0) throw new Error("Valid payment amount is required");
  const order = await razorpayRequest("/orders", {
    amount: Math.round(rupees * 100),
    currency: "INR",
    receipt: String(receipt || `orbita_${Date.now()}`).slice(0, 40),
    payment_capture: 1,
    notes: notes || {}
  });
  return { ...order, keyId: keyId(), testMode: razorpayTestMode() };
}

export function verifyRazorpayPayment({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  if (!razorpayConfigured()) throw new Error("Razorpay is not configured");
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return false;
  const expected = crypto
    .createHmac("sha256", keySecret())
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(razorpay_signature));
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function refundRazorpayPayment({ paymentId, amount, notes }) {
  if (!paymentId) throw new Error("Razorpay payment id is required for refund");
  const body = {};
  if (Number(amount) > 0) body.amount = Math.round(Number(amount) * 100);
  if (notes) body.notes = notes;
  return razorpayRequest(`/payments/${paymentId}/refund`, body);
}

export const razorpayClient = {
  configured: razorpayConfigured,
  testMode: razorpayTestMode,
  createOrder: createRazorpayOrder,
  verifyPayment: verifyRazorpayPayment,
  refundPayment: refundRazorpayPayment
};
