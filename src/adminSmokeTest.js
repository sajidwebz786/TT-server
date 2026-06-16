const API_URL = "http://localhost:5000/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Failed ${path}`);
  return data;
}

const admin = await request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "admin@traveltimes.com", password: "admin123" })
});

const headers = { Authorization: `Bearer ${admin.token}` };
const [customers, support, chat, tracking] = await Promise.all([
  request("/admin/customers", { headers }),
  request("/admin/support", { headers }),
  request("/admin/chat", { headers }),
  request("/admin/tracking", { headers })
]);

console.log(JSON.stringify({
  customers: customers.length,
  supportTickets: support.length,
  chatMessages: chat.length,
  trackingEvents: tracking.length
}, null, 2));
