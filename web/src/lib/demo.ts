import type { Attachment, Lead, LeadStatus, Quotation, Supplier, User } from './types';

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
  // Shared reference, numbered oldest first (server assigns these in production).
  leadRef: `SE-2610-${String(clients.length - i).padStart(4, '0')}`,
}));

const quotations: Quotation[] = leads.filter((l) => ['QUOTED', 'APPROVED', 'SHIPPING', 'WON'].includes(l.status)).map((l, i) => ({
  id: `Q${i + 1}`, name: `QT-26${(1040 + i).toString()}`, leadId: l.id, leadRef: l.leadRef, productName: l.productInterest,
  supplierName: ['Yiwu Huaxin Trading', 'Ningbo Brightway', 'Guangzhou Hometex', 'Shenzhen Joylight', 'Foshan Ceramics Co.'][i % 5],
  unitCost: [11.5, 9.2, 22, 48, 3.1, 7.4][i % 6], currency: (['CNY', 'CNY', 'USD', 'CNY', 'INR', 'USD'] as const)[i % 6], quantity: l.quantity ?? 100,
  clientUnitPrice: [168, 142, 29.5, 720, 52, 1.45][i % 6], clientCurrency: (['INR', 'INR', 'USD', 'INR', 'INR', 'USD'] as const)[i % 6],
  status: ['SENT', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'DRAFT', 'SENT'][i % 6], validityDate: day(-14 + i), createdAt: day(i + 2),
}));

const suppliers: Supplier[] = [
  { id: 'SP1', name: 'Yiwu Huaxin Trading', city: 'Yiwu', category: 'Household', rating: 4.6, contactName: 'Zhang Min', wechat: 'huaxin_zm' },
  { id: 'SP2', name: 'Ningbo Brightway', city: 'Ningbo', category: 'Kitchenware', rating: 4.3, contactName: 'Liu Yang', wechat: 'brightway_ly' },
  { id: 'SP3', name: 'Guangzhou Hometex', city: 'Guangzhou', category: 'Textiles', rating: 4.8, contactName: 'Huang Lei', wechat: 'hometex_hl' },
  { id: 'SP4', name: 'Shenzhen Joylight', city: 'Shenzhen', category: 'Electronics', rating: 4.1, contactName: 'Zhao Qing', wechat: 'joylight_zq' },
  { id: 'SP5', name: 'Foshan Ceramics Co.', city: 'Foshan', category: 'Ceramics', rating: 4.5, contactName: 'Sun Hao', wechat: 'fsceramic' },
];


const users: User[] = [
  { id: 'U1', email: 'dhushyanth@sourceeasy.in', name: 'Dhushyanth Kumar', role: 'SUPER_ADMIN', active: true, createdAt: day(60) },
  { id: 'U2', email: 'priya@sourceeasy.in', name: 'Priya Nair', role: 'INDIA_ADMIN', active: true, createdAt: day(50) },
  { id: 'U3', email: 'rahul@sourceeasy.in', name: 'Rahul Mehta', role: 'INDIA_STAFF', active: true, createdAt: day(40) },
  { id: 'U4', email: 'liwei@sourceeasy.in', name: 'Li Wei', role: 'CHINA_ADMIN', active: true, createdAt: day(45) },
  { id: 'U5', email: 'chenjing@sourceeasy.in', name: 'Chen Jing', role: 'CHINA_STAFF', active: true, createdAt: day(30) },
];

// L2 arrived through the website enquiry form with photos and a spec sheet.
Object.assign(leads[1], { sourceChannel: 'WEBSITE', contactName: 'Rohit Mehta', unit: 'pcs', deliveryCity: 'Chennai',
  referenceUrl: 'https://www.alibaba.com/product-detail/bamboo-cutting-board', enquiryMessage: 'Need 3 sizes with juice groove and laser-engraved logo. Sample first please.', attachmentCount: 4 });
const attachments: Record<string, Attachment[]> = {
  L2: [
    { id: 'a1', name: 'board-front.jpg', mime: 'image/jpeg', size: 1843200, createdAt: day(3) },
    { id: 'a2', name: 'board-back.jpg', mime: 'image/jpeg', size: 1622016, createdAt: day(3) },
    { id: 'a3', name: 'Mehta-bamboo-spec.pdf', mime: 'application/pdf', size: 248000, createdAt: day(3) },
    { id: 'a4', name: 'sizes-and-quantities.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 18400, createdAt: day(3) },
  ],
};
const files: Record<string, string> = { a1: '/demo/bamboo-board-1.jpg', a2: '/demo/bamboo-board-2.jpg' };

export const demo = { leads, quotations, suppliers, users, attachments, files };
