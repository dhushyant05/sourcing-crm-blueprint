import type { Lead, LeadStatus, Quotation, Shipment, Supplier, User } from './types';

const day = (n: number) => new Date(Date.UTC(2026, 9, 31) - n * 864e5).toISOString();
const clients = ['Arora Home Store', 'Mehta Kitchenware', 'Sri Balaji Traders', 'Kapoor Retail', 'Nair Hospitality',
  'Patel Packaging', 'GreenLeaf Organics', 'Urban Nest Decor', 'Royal Fabrics', 'Desai Electricals', 'Zenith Toys', 'Iyer & Sons'];
const products = ['Steel bottles 750ml', 'Bamboo cutting boards', 'LED panel lights 18W', 'Ceramic dinner sets', 'Kraft paper bags',
  'Silicone baking mats', 'Cotton tote bags', 'Wall clocks (wood)', 'Polyester curtains', 'Smart plugs', 'Wooden puzzles', 'Glass jars 500ml'];
const statuses: LeadStatus[] = ['NEW', 'NEW', 'ASSIGNED', 'SOURCING', 'SOURCING', 'QUOTED', 'QUOTED', 'APPROVED', 'SHIPPING', 'WON', 'NEW', 'LOST'];

const leads: Lead[] = clients.map((c, i) => ({
  id: `L${i + 1}`, name: `${c} — ${products[i]}`, clientName: c, productInterest: products[i],
  contactPhone: `+91 98${(4412300 + i * 7919).toString().slice(0, 8)}`, contactEmail: `buyer@${c.split(' ')[0].toLowerCase()}.in`,
  quantity: [500, 1200, 300, 2000, 800, 5000, 1500, 250, 900, 600, 1000, 2400][i],
  targetPrice: [220, 180, 340, 950, 12, 140, 65, 480, 310, 520, 160, 45][i], targetCurrency: 'INR',
  status: statuses[i], assignedOffice: i % 3 ? 'CHINA' : 'INDIA', assignedChinaAgent: ['Li Wei', 'Chen Jing', 'Wang Fang'][i % 3],
  sourceChannel: ['WhatsApp', 'Referral', 'Website', 'Trade fair'][i % 4], createdAt: day(i * 2 + 1),
}));

const quotations: Quotation[] = leads.filter((l) => ['QUOTED', 'APPROVED', 'SHIPPING', 'WON'].includes(l.status)).map((l, i) => ({
  id: `Q${i + 1}`, name: `QT-26${(1040 + i).toString()}`, leadId: l.id, productName: l.productInterest,
  supplierName: ['Yiwu Huaxin Trading', 'Ningbo Brightway', 'Guangzhou Hometex', 'Shenzhen Joylight', 'Foshan Ceramics Co.'][i % 5],
  unitCost: [11.5, 9.2, 22, 48, 3.1, 7.4][i % 6], currency: (['CNY', 'CNY', 'USD', 'CNY', 'INR', 'USD'] as const)[i % 6], quantity: l.quantity ?? 100,
  clientUnitPrice: [168, 142, 29.5, 720, 52, 1.45][i % 6], clientCurrency: (['INR', 'INR', 'USD', 'INR', 'INR', 'USD'] as const)[i % 6],
  status: ['SENT', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'DRAFT', 'SENT'][i % 6], validityDate: day(-14 + i), createdAt: day(i + 2),
}));

const shipments: Shipment[] = [
  { id: 'S1', name: 'SO-2611', clientName: 'Sri Balaji Traders', stage: 'IN_TRANSIT', carrier: 'Maersk', trackingNumber: 'MAEU7731902', origin: 'Ningbo', destination: 'Nhava Sheva', eta: day(-9), updatedAt: day(0) },
  { id: 'S2', name: 'SO-2609', clientName: 'Mehta Kitchenware', stage: 'AT_PORT', carrier: 'COSCO', trackingNumber: 'COSU6210457', origin: 'Shenzhen', destination: 'Chennai', eta: day(-2), updatedAt: day(1) },
  { id: 'S3', name: 'SO-2604', clientName: 'Desai Electricals', stage: 'DELIVERED', carrier: 'DHL Express', trackingNumber: '4021 8833 10', origin: 'Shenzhen', destination: 'Mumbai', eta: day(5), updatedAt: day(5) },
  { id: 'S4', name: 'SO-2613', clientName: 'Urban Nest Decor', stage: 'BOOKED', carrier: 'ONE', trackingNumber: '—', origin: 'Yiwu', destination: 'Mundra', eta: day(-24), updatedAt: day(0) },
];

const suppliers: Supplier[] = [
  { id: 'SP1', name: 'Yiwu Huaxin Trading', city: 'Yiwu', category: 'Household', rating: 4.6, contactName: 'Zhang Min', wechat: 'huaxin_zm' },
  { id: 'SP2', name: 'Ningbo Brightway', city: 'Ningbo', category: 'Kitchenware', rating: 4.3, contactName: 'Liu Yang', wechat: 'brightway_ly' },
  { id: 'SP3', name: 'Guangzhou Hometex', city: 'Guangzhou', category: 'Textiles', rating: 4.8, contactName: 'Huang Lei', wechat: 'hometex_hl' },
  { id: 'SP4', name: 'Shenzhen Joylight', city: 'Shenzhen', category: 'Electronics', rating: 4.1, contactName: 'Zhao Qing', wechat: 'joylight_zq' },
  { id: 'SP5', name: 'Foshan Ceramics Co.', city: 'Foshan', category: 'Ceramics', rating: 4.5, contactName: 'Sun Hao', wechat: 'fsceramic' },
];


const users: User[] = [
  { id: 'U1', email: 'dhushyanth@sourceec.in', name: 'Dhushyanth Kumar', role: 'SUPER_ADMIN', active: true, createdAt: day(60) },
  { id: 'U2', email: 'priya@sourceec.in', name: 'Priya Nair', role: 'INDIA_ADMIN', active: true, createdAt: day(50) },
  { id: 'U3', email: 'rahul@sourceec.in', name: 'Rahul Mehta', role: 'INDIA_STAFF', active: true, createdAt: day(40) },
  { id: 'U4', email: 'liwei@sourceec.in', name: 'Li Wei', role: 'CHINA_ADMIN', active: true, createdAt: day(45) },
  { id: 'U5', email: 'chenjing@sourceec.in', name: 'Chen Jing', role: 'CHINA_STAFF', active: true, createdAt: day(30) },
];

export const demo = { leads, quotations, shipments, suppliers, users };
