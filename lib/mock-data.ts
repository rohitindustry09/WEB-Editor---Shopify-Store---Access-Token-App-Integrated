import type {
  Collection,
  ContentPage,
  Customer,
  Discount,
  InventoryRow,
  Market,
  Order,
  Product,
} from "./types";

export const STORE = {
  name: "The Brasstown",
  domain: "brasstown.myshopify.com",
  plan: "Shopify",
  currency: "INR",
};

export const products: Product[] = [
  { id: "p1", title: "Brass Handcrafted Aarti Diya Set of 2 – Traditional Pooja Oil Lamp for Aarti, Puja & Home Mandir", sku: "BT-DIYA-002", icon: "🪔", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Diya", vendor: "The Brasstown", price: 899 },
  { id: "p2", title: "Brass Wine Glass Set of 2 – Handcrafted Traditional Peetal Goblet Glasses for Home, Royal Dining Décor", sku: "BT-GLS-014", icon: "🍷", status: "Active", inventory: 10, category: "Wine Glasses", channels: 6, catalogs: 2, productType: "Glassware", vendor: "The Brasstown", price: 1299 },
  { id: "p3", title: "Brass Venkateswara Balaji Srinivasa Idol with Prabhavali Chowki – Tirupati Balaji Statue for Puja & Home Mandir", sku: "BT-IDL-031", icon: "🛕", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Idol", vendor: "The Brasstown", price: 4499 },
  { id: "p4", title: "Brass Traditional Makara Torana Arch Standi – Makara Torana Arch Stand for Idols & Home Temple Pooja 12 Inch", sku: "BT-ARC-009", icon: "🕍", status: "Active", inventory: 10, category: "Religious Altars", channels: 6, catalogs: 2, productType: "Altar Fixture", vendor: "The Brasstown", price: 2199 },
  { id: "p5", title: "Traditonal Handcrafted Brass Chowki for mandir – Traditional Pooja Peetha / Singhasan for Idols, Kalash & More", sku: "BT-CHK-005", icon: "🪑", status: "Active", inventory: 10, category: "Religious Altars", channels: 6, catalogs: 2, productType: "Chowki", vendor: "The Brasstown", price: 1599 },
  { id: "p6", title: "Brass Pure Peetal Thali Pooja Aarti for Mandir – Peetal Pooja Plate for Hindu Worship & Temple Rituals 11.5 Inch", sku: "BT-THL-011", icon: "🍽️", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Thali", vendor: "The Brasstown", price: 1099 },
  { id: "p7", title: "Brass Venkateswara Balaji Srinivasa Idol – Tirupati Balaji Statue for Puja & Home Mandir 8.5 Inch", sku: "BT-IDL-032", icon: "🛕", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Idol", vendor: "The Brasstown", price: 3299 },
  { id: "p8", title: "Brass Prabhavali for God Idols – Handcrafted Arch Backdrop Wall Hanging for Home Temple, Deity Décor", sku: "BT-PRB-006", icon: "✨", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Décor", vendor: "The Brasstown", price: 1799 },
  { id: "p9", title: "Handcrafted Brass Glass Set of 2 – Traditional Peetal Water Vessel for Pooja, Dining, Home Décor & Gifting 4.5 Inch", sku: "BT-GLS-015", icon: "🥃", status: "Active", inventory: 10, category: "Serving Pitchers & Carafes", channels: 6, catalogs: 2, productType: "Glassware", vendor: "The Brasstown", price: 999 },
  { id: "p10", title: "Handcrafted Brass Glass – Traditional Peetal Water Vessel for Pooja, Dining, Home Décor & Gifting 4.5 Inch", sku: "BT-GLS-016", icon: "🥃", status: "Active", inventory: 10, category: "Serving Pitchers & Carafes", channels: 6, catalogs: 2, productType: "Glassware", vendor: "The Brasstown", price: 549 },
  { id: "p11", title: "Traditional Brass Lakshmi Narasimha Idol – Traditional Narayana Swamy Chola Style Sculpture for Pooja, Home", sku: "BT-IDL-033", icon: "🛕", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Idol", vendor: "The Brasstown", price: 5199 },
  { id: "p12", title: "Unique Brass Vishnu Idol – Handcrafted Narayana Govinda Murti Traditional Chola Sculpture for Pooja", sku: "BT-IDL-034", icon: "🛕", status: "Active", inventory: 0, category: "Religious Items", channels: 6, catalogs: 2, productType: "Idol", vendor: "The Brasstown", price: 4899 },
  { id: "p13", title: "Brass Dancing Parvati Mata Murti – Parvathi Devi Statue for Home Temple & Pooja 15.5 Inch", sku: "BT-IDL-035", icon: "🛕", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Idol", vendor: "The Brasstown", price: 4299 },
  { id: "p14", title: "Brass Mini Ganapati Vinayaka Idol – Handcrafted Traditional Chola Style Ganesha Murti for Pooja, Home", sku: "BT-IDL-036", icon: "🐘", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Idol", vendor: "The Brasstown", price: 1899 },
  { id: "p15", title: "Brass Ganapati Vinayaka Idol – Handcrafted Traditional Chola Style Ganesha Murti for Pooja, Home Mandir", sku: "BT-IDL-037", icon: "🐘", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Idol", vendor: "The Brasstown", price: 2699 },
  { id: "p16", title: "Brass Kalash Set with Coconut Stand – Traditional Pooja Kalash for Housewarming & Festive Rituals", sku: "BT-KLS-004", icon: "🫙", status: "Draft", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Kalash", vendor: "The Brasstown", price: 1399 },
  { id: "p17", title: "Brass Peetal Pooja Bell – Handcrafted Temple Ghanti for Aarti & Daily Worship 6 Inch", sku: "BT-BEL-003", icon: "🔔", status: "Active", inventory: 10, category: "Religious Items", channels: 6, catalogs: 2, productType: "Bell", vendor: "The Brasstown", price: 749 },
  { id: "p18", title: "Brass Peetal Serving Bowl Set of 3 – Traditional Katori for Dining & Home Décor", sku: "BT-BWL-021", icon: "🥣", status: "Archived", inventory: 10, category: "Serving Pitchers & Carafes", channels: 4, catalogs: 1, productType: "Serveware", vendor: "The Brasstown", price: 1199 },
];

export const collections: Collection[] = [
  {
    id: "c1",
    title: "Pooja Room Essentials",
    type: "manual",
    icon: "🪔",
    productIds: ["p1", "p4", "p5", "p6", "p8", "p16", "p17"],
    channels: 6,
    updatedAt: "2026-08-14",
    description: "Everything for setting up or refreshing a home mandir.",
  },
  {
    id: "c2",
    title: "Brass Idols Collection",
    type: "manual",
    icon: "🛕",
    productIds: ["p3", "p7", "p11", "p12", "p13", "p14", "p15"],
    channels: 6,
    updatedAt: "2026-08-10",
    description: "Handcrafted deity idols in the Chola & Tirupati style.",
  },
  {
    id: "c3",
    title: "Dining & Glassware",
    type: "smart",
    icon: "🍷",
    productIds: ["p2", "p9", "p10", "p18"],
    channels: 6,
    updatedAt: "2026-08-02",
    description: "Auto-includes products tagged Wine Glasses or Serving Pitchers & Carafes.",
  },
  {
    id: "c4",
    title: "Festive Season 2026",
    type: "manual",
    icon: "✨",
    productIds: ["p1", "p3", "p7", "p11", "p14", "p15"],
    channels: 6,
    updatedAt: "2026-07-28",
    description: "Curated for Ganesh Chaturthi & Diwali gifting.",
  },
];

export const orders: Order[] = [
  { id: "o1", name: "#1042", date: "2026-08-19", customer: "Ananya Rao", paymentStatus: "Paid", fulfillmentStatus: "Unfulfilled", total: 4499, shippingAddress: "Jubilee Hills, Hyderabad, TG 500033", items: [{ productId: "p3", title: products[2].title, quantity: 1, price: 4499 }] },
  { id: "o2", name: "#1041", date: "2026-08-19", customer: "Karthik Iyer", paymentStatus: "Paid", fulfillmentStatus: "Fulfilled", total: 2148, shippingAddress: "T. Nagar, Chennai, TN 600017", items: [{ productId: "p1", title: products[0].title, quantity: 1, price: 899 }, { productId: "p6", title: products[5].title, quantity: 1, price: 1099 }] },
  { id: "o3", name: "#1040", date: "2026-08-18", customer: "Priya Menon", paymentStatus: "Pending", fulfillmentStatus: "Unfulfilled", total: 1899, shippingAddress: "Kochi, KL 682016", items: [{ productId: "p14", title: products[13].title, quantity: 1, price: 1899 }] },
  { id: "o4", name: "#1039", date: "2026-08-18", customer: "Rohit Sharma", paymentStatus: "Paid", fulfillmentStatus: "Partial", total: 3298, shippingAddress: "Andheri West, Mumbai, MH 400058", items: [{ productId: "p2", title: products[1].title, quantity: 1, price: 1299 }, { productId: "p9", title: products[8].title, quantity: 2, price: 999 }] },
  { id: "o5", name: "#1038", date: "2026-08-17", customer: "Sneha Reddy", paymentStatus: "Refunded", fulfillmentStatus: "Fulfilled", total: 2699, shippingAddress: "Banjara Hills, Hyderabad, TG 500034", items: [{ productId: "p15", title: products[14].title, quantity: 1, price: 2699 }] },
  { id: "o6", name: "#1037", date: "2026-08-16", customer: "Arjun Nair", paymentStatus: "Paid", fulfillmentStatus: "Fulfilled", total: 5199, shippingAddress: "Indiranagar, Bengaluru, KA 560038", items: [{ productId: "p11", title: products[10].title, quantity: 1, price: 5199 }] },
  { id: "o7", name: "#1036", date: "2026-08-16", customer: "Divya Krishnan", paymentStatus: "Paid", fulfillmentStatus: "Unfulfilled", total: 1548, shippingAddress: "Anna Nagar, Chennai, TN 600040", items: [{ productId: "p17", title: products[16].title, quantity: 1, price: 749 }, { productId: "p10", title: products[9].title, quantity: 1, price: 549 }] },
  { id: "o8", name: "#1035", date: "2026-08-15", customer: "Vikram Singh", paymentStatus: "Paid", fulfillmentStatus: "Fulfilled", total: 4299, shippingAddress: "Malviya Nagar, Jaipur, RJ 302017", items: [{ productId: "p13", title: products[12].title, quantity: 1, price: 4299 }] },
];

export const customers: Customer[] = [
  { id: "cu1", name: "Ananya Rao", email: "ananya.rao@example.com", location: "Hyderabad, TG", orders: 3, totalSpent: 12897, tags: ["VIP"] },
  { id: "cu2", name: "Karthik Iyer", email: "karthik.iyer@example.com", location: "Chennai, TN", orders: 1, totalSpent: 2148, tags: [] },
  { id: "cu3", name: "Priya Menon", email: "priya.menon@example.com", location: "Kochi, KL", orders: 2, totalSpent: 3798, tags: ["Wholesale"] },
  { id: "cu4", name: "Rohit Sharma", email: "rohit.sharma@example.com", location: "Mumbai, MH", orders: 5, totalSpent: 18420, tags: ["VIP", "Repeat"] },
  { id: "cu5", name: "Sneha Reddy", email: "sneha.reddy@example.com", location: "Hyderabad, TG", orders: 1, totalSpent: 2699, tags: [] },
  { id: "cu6", name: "Arjun Nair", email: "arjun.nair@example.com", location: "Bengaluru, KA", orders: 4, totalSpent: 15630, tags: ["Repeat"] },
];

export const inventory: InventoryRow[] = products.map((p, i) => ({
  id: `inv-${p.id}`,
  productId: p.id,
  title: p.title,
  sku: p.sku,
  location: i % 3 === 0 ? "Hyderabad Warehouse" : i % 3 === 1 ? "Chennai Fulfilment Center" : "Bengaluru Hub",
  available: p.inventory,
  committed: p.inventory > 0 ? Math.min(2, p.inventory) : 0,
  onHand: p.inventory + (p.inventory > 0 ? 2 : 0),
}));

export const discounts: Discount[] = [
  { id: "d1", code: "DIWALI15", type: "Percentage", value: "15% off", status: "Active", used: 214 },
  { id: "d2", code: "FREESHIP", type: "Free shipping", value: "Free shipping", status: "Active", used: 88 },
  { id: "d3", code: "WELCOME100", type: "Fixed amount", value: "₹100 off", status: "Active", used: 356 },
  { id: "d4", code: "GANESH2026", type: "Percentage", value: "20% off", status: "Scheduled", used: 0 },
  { id: "d5", code: "SUMMER10", type: "Percentage", value: "10% off", status: "Expired", used: 512 },
];

export const contentPages: ContentPage[] = [
  { id: "cp1", title: "About The Brasstown", type: "Page", status: "Published", updatedAt: "2026-06-02", author: "Priya" },
  { id: "cp2", title: "Caring for Handcrafted Brass", type: "Blog post", status: "Published", updatedAt: "2026-07-19", author: "Dev" },
  { id: "cp3", title: "Shipping & Returns", type: "Page", status: "Published", updatedAt: "2026-05-11", author: "Priya" },
  { id: "cp4", title: "Ganesh Chaturthi Gifting Guide", type: "Blog post", status: "Draft", updatedAt: "2026-08-15", author: "Anika" },
];

export const markets: Market[] = [
  { id: "m1", name: "India", region: "Domestic", currency: "INR", status: "Active" },
  { id: "m2", name: "United States", region: "North America", currency: "USD", status: "Active" },
  { id: "m3", name: "United Kingdom", region: "Europe", currency: "GBP", status: "Inactive" },
];

export const salesSeries = [
  { label: "Aug 13", value: 18420 },
  { label: "Aug 14", value: 22110 },
  { label: "Aug 15", value: 15680 },
  { label: "Aug 16", value: 27430 },
  { label: "Aug 17", value: 19980 },
  { label: "Aug 18", value: 31250 },
  { label: "Aug 19", value: 24870 },
];

export function findProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function findCollection(id: string): Collection | undefined {
  return collections.find((c) => c.id === id);
}

export function findOrder(id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
