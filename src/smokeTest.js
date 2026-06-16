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

const customer = await request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "customer@traveltimes.com", password: "customer123" })
});

const routes = await request("/transport/bus/search?from=Mumbai&to=Goa");
const booking = await request("/bookings", {
  method: "POST",
  headers: { Authorization: `Bearer ${customer.token}` },
  body: JSON.stringify({
    type: "bus",
    itemId: routes[0].id,
    travelDate: "2026-06-15",
    selectedSeats: ["A1", "B1"],
    passengers: [{ name: "Demo Customer", age: 30 }],
    contact: { email: "customer@traveltimes.com" },
    totalAmount: Number(routes[0].price) * 2,
    metadata: { provider: routes[0].providerName, routeCode: routes[0].routeCode }
  })
});

const admin = await request("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "admin@traveltimes.com", password: "admin123" })
});

const adminBookings = await request("/admin/bookings", {
  headers: { Authorization: `Bearer ${admin.token}` }
});

const visible = adminBookings.some((item) => item.bookingCode === booking.bookingCode);
console.log(JSON.stringify({ bookingCode: booking.bookingCode, adminVisible: visible, totalAdminBookings: adminBookings.length }, null, 2));
