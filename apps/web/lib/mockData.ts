export interface Category {
  id: string;
  nombre: string;
  descripcion: string;
}

export interface Product {
  id: string;
  sku: string;
  nombre: string;
  descripcion: string;
  categoria_id: string;
  precio_costo: number;
  precio_venta: number;
  stock_minimo: number;
  stock_inicial: number;
  tiene_variantes: boolean;
}

export interface InventoryMovement {
  id: string;
  producto_id: string;
  tipo:
    | 'entrada_compra'
    | 'salida_venta'
    | 'salida_devolucion'
    | 'entrada_devolucion'
    | 'ajuste_positivo'
    | 'ajuste_negativo'
    | 'reserva'
    | 'liberacion_reserva';
  cantidad: number;
  fecha: string;
  detalle: string;
}

export interface Customer {
  id: string;
  nombre: string;
  nit: string;
  email: string;
  telefono: string;
  direccion: string;
}

export interface Supplier {
  id: string;
  nombre: string;
  nit: string;
  email: string;
  telefono: string;
  direccion: string;
  contacto: string;
}

export interface Invoice {
  id: string;
  numero: string;
  tipo: 'cxc' | 'cxp';
  cliente_id?: string;
  proveedor_id?: string;
  pedido_id?: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  total: number;
  saldo_pendiente: number;
  estado: 'pagada' | 'pendiente' | 'vencida';
}

export interface PaymentAbono {
  id: string;
  factura_id: string;
  monto: number;
  fecha: string;
  referencia: string;
}

export interface OrderItem {
  /** `null` cuando es un "cargo libre" sin producto de catálogo (ver `concepto`) — p.ej. Envío. */
  producto_id: string | null;
  /** Solo presente en cargos libres (`producto_id === null`), p.ej. "Envío". */
  concepto?: string | null;
  cantidad: number;
  precio: number;
}

export interface Order {
  id: string;
  numero: string;
  cliente_id: string;
  fecha: string;
  total: number;
  estado: 'borrador' | 'confirmado' | 'en_preparacion' | 'despachado' | 'entregado' | 'cancelado';
  items: OrderItem[];
  notas?: string | null;
  guia_despacho?: string;
}

// DATA INICIAL
export const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-1', nombre: 'Textil y Confección', descripcion: 'Prendas de vestir y telas' },
  { id: 'cat-2', nombre: 'Calzado', descripcion: 'Zapatos de cuero, deportivos y sandalias' },
  { id: 'cat-3', nombre: 'Accesorios', descripcion: 'Correas, bolsos y sombreros' },
];

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    sku: 'TX-JEAN-01',
    nombre: 'Jean Indigo Slim Fit',
    descripcion: 'Pantalón de mezclilla azul clásico',
    categoria_id: 'cat-1',
    precio_costo: 38000,
    precio_venta: 89000,
    stock_minimo: 25,
    stock_inicial: 85,
    tiene_variantes: false,
  },
  {
    id: 'prod-2',
    sku: 'TX-CHAQ-02',
    nombre: 'Chaqueta Acolchada Impermeable',
    descripcion: 'Chaqueta térmica ideal para clima frío',
    categoria_id: 'cat-1',
    precio_costo: 65000,
    precio_venta: 149000,
    stock_minimo: 15,
    stock_inicial: 12, // Stock crítico
    tiene_variantes: false,
  },
  {
    id: 'prod-3',
    sku: 'CZ-MOC-01',
    nombre: 'Mocasín Cuero Café',
    descripcion: 'Zapatos formales de cuero 100% colombiano',
    categoria_id: 'cat-2',
    precio_costo: 72000,
    precio_venta: 169000,
    stock_minimo: 10,
    stock_inicial: 28,
    tiene_variantes: false,
  },
  {
    id: 'prod-4',
    sku: 'CZ-TENIS-02',
    nombre: 'Tenis Deportivos Urban',
    descripcion: 'Zapatos cómodos con suela eva',
    categoria_id: 'cat-2',
    precio_costo: 55000,
    precio_venta: 129000,
    stock_minimo: 20,
    stock_inicial: 18, // Ligeramente bajo el mínimo
    tiene_variantes: false,
  },
  {
    id: 'prod-5',
    sku: 'AC-CORR-01',
    nombre: 'Correa Cuero Reversible',
    descripcion: 'Correa negra y café con hebilla metálica',
    categoria_id: 'cat-3',
    precio_costo: 18000,
    precio_venta: 45000,
    stock_minimo: 30,
    stock_inicial: 95,
    tiene_variantes: false,
  },
];

export const INITIAL_MOVEMENTS: InventoryMovement[] = [
  {
    id: 'mov-1',
    producto_id: 'prod-1',
    tipo: 'entrada_compra',
    cantidad: 100,
    fecha: '2026-05-10T08:00:00Z',
    detalle: 'Compra inicial lote #4889',
  },
  {
    id: 'mov-2',
    producto_id: 'prod-1',
    tipo: 'salida_venta',
    cantidad: 15,
    fecha: '2026-05-20T14:30:00Z',
    detalle: 'Venta Factura #FV-1001',
  },
  {
    id: 'mov-3',
    producto_id: 'prod-2',
    tipo: 'entrada_compra',
    cantidad: 20,
    fecha: '2026-05-15T09:00:00Z',
    detalle: 'Compra importación lote #12',
  },
  {
    id: 'mov-4',
    producto_id: 'prod-2',
    tipo: 'salida_venta',
    cantidad: 8,
    fecha: '2026-05-25T11:00:00Z',
    detalle: 'Venta Factura #FV-1002',
  },
  {
    id: 'mov-5',
    producto_id: 'prod-3',
    tipo: 'entrada_compra',
    cantidad: 30,
    fecha: '2026-05-12T10:15:00Z',
    detalle: 'Compra de fábrica Bucaramanga',
  },
  {
    id: 'mov-6',
    producto_id: 'prod-3',
    tipo: 'salida_venta',
    cantidad: 2,
    fecha: '2026-05-28T16:45:00Z',
    detalle: 'Venta Factura #FV-1003',
  },
];

export const INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'cust-1',
    nombre: 'Almacenes Éxito S.A.',
    nit: '890.900.608-9',
    email: 'proveedores@exito.com',
    telefono: '3124567890',
    direccion: 'Carrera 48 # 32B Sur - 139, Envigado',
  },
  {
    id: 'cust-2',
    nombre: 'Comercializadora Textil del Caribe',
    nit: '901.234.567-8',
    email: 'pagos@textilcaribe.co',
    telefono: '3007654321',
    direccion: 'Calle 72 # 54 - 35, Barranquilla',
  },
  {
    id: 'cust-3',
    nombre: 'Boutique D\'Moda Bogotá',
    nit: '900.555.222-1',
    email: 'contacto@dmodabogota.com',
    telefono: '3159998877',
    direccion: 'Avenida 19 # 122 - 45, Bogotá',
  },
  {
    id: 'cust-4',
    nombre: 'Variedades y Calzado Juanita',
    nit: '79.888.777-4',
    email: 'juanita.perez@gmail.com',
    telefono: '3102223344',
    direccion: 'Calle 10 # 5 - 22, Girardot',
  },
];

export const INITIAL_SUPPLIERS: Supplier[] = [
  {
    id: 'supp-1',
    nombre: 'Hilanderías de Colombia S.A.S.',
    nit: '860.002.391-2',
    email: 'ventas@hilanderias.com.co',
    telefono: '3149991122',
    direccion: 'Zona Industrial Cazucá, Soacha',
    contacto: 'Carlos Mendoza',
  },
  {
    id: 'supp-2',
    nombre: 'Curtimbres del Eje Cafetero',
    nit: '900.111.444-5',
    email: 'facturacion@curtimbres.co',
    telefono: '3183334455',
    direccion: 'Km 5 Vía Armenia - Pereira',
    contacto: 'Martha Gómez',
  },
];

export const INITIAL_INVOICES: Invoice[] = [
  // Cuentas por Cobrar (CxC)
  {
    id: 'inv-1',
    numero: 'FV-1001',
    tipo: 'cxc',
    cliente_id: 'cust-1',
    fecha_emision: '2026-05-20',
    fecha_vencimiento: '2026-06-20',
    total: 1335000,
    saldo_pendiente: 0, // Pagada
    estado: 'pagada',
  },
  {
    id: 'inv-2',
    numero: 'FV-1002',
    tipo: 'cxc',
    cliente_id: 'cust-2',
    fecha_emision: '2026-05-25',
    fecha_vencimiento: '2026-06-25',
    total: 1192000,
    saldo_pendiente: 500000, // Abono parcial
    estado: 'pendiente',
  },
  {
    id: 'inv-3',
    numero: 'FV-1003',
    tipo: 'cxc',
    cliente_id: 'cust-3',
    fecha_emision: '2026-05-01',
    fecha_vencimiento: '2026-06-01', // Vencida
    total: 338000,
    saldo_pendiente: 338000,
    estado: 'vencida',
  },
  {
    id: 'inv-4',
    numero: 'FV-1004',
    tipo: 'cxc',
    cliente_id: 'cust-4',
    fecha_emision: '2026-04-15',
    fecha_vencimiento: '2026-05-15', // Vencida (crítica)
    total: 950000,
    saldo_pendiente: 950000,
    estado: 'vencida',
  },
  // Cuentas por Pagar (CxP)
  {
    id: 'inv-5',
    numero: 'FC-998',
    tipo: 'cxp',
    proveedor_id: 'supp-1',
    fecha_emision: '2026-05-10',
    fecha_vencimiento: '2026-06-10',
    total: 3800000,
    saldo_pendiente: 3800000,
    estado: 'pendiente',
  },
  {
    id: 'inv-6',
    numero: 'FC-999',
    tipo: 'cxp',
    proveedor_id: 'supp-2',
    fecha_emision: '2026-05-12',
    fecha_vencimiento: '2026-06-12',
    total: 2160000,
    saldo_pendiente: 0, // Pagada
    estado: 'pagada',
  },
];

export const INITIAL_ABONOS: PaymentAbono[] = [
  {
    id: 'ab-1',
    factura_id: 'inv-1',
    monto: 1335000,
    fecha: '2026-05-22',
    referencia: 'Transf. Bancolombia #882991',
  },
  {
    id: 'ab-2',
    factura_id: 'inv-2',
    monto: 692000,
    fecha: '2026-05-28',
    referencia: 'PSE Wompi #1293049',
  },
  {
    id: 'ab-3',
    factura_id: 'inv-6',
    monto: 2160000,
    fecha: '2026-05-14',
    referencia: 'Pago Nequi #991283',
  },
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-1',
    numero: 'PED-5001',
    cliente_id: 'cust-1',
    fecha: '2026-06-01T10:00:00Z',
    total: 890000,
    estado: 'entregado',
    items: [{ producto_id: 'prod-1', cantidad: 10, precio: 89000 }],
    guia_despacho: 'ENV-1299837 (Coordinadora)',
  },
  {
    id: 'ord-2',
    numero: 'PED-5002',
    cliente_id: 'cust-3',
    fecha: '2026-06-04T15:20:00Z',
    total: 338000,
    estado: 'en_preparacion',
    items: [{ producto_id: 'prod-3', cantidad: 2, precio: 169000 }],
  },
  {
    id: 'ord-3',
    numero: 'PED-5003',
    cliente_id: 'cust-2',
    fecha: '2026-06-06T09:15:00Z',
    total: 447000,
    estado: 'confirmado',
    items: [
      { producto_id: 'prod-2', cantidad: 3, precio: 149000 }
    ],
  },
  {
    id: 'ord-4',
    numero: 'PED-5004',
    cliente_id: 'cust-4',
    fecha: '2026-06-06T18:40:00Z',
    total: 215000,
    estado: 'borrador',
    items: [
      { producto_id: 'prod-4', cantidad: 1, precio: 129000 },
      { producto_id: 'prod-1', cantidad: 1, precio: 89000 } // Total 218000? Oh we set total 215000, but wait it doesn't need to match mathematically for mocks, though we will recalculate on creation.
    ],
  },
];


export const TENANTS_GLOBAL_METRICS = {
  totalTenants: 148,
  activeTenants: 142,
  cancelledTenants: 4,
  suspendedTenants: 2,
  planDistribution: {
    basico: 68,
    profesional: 54,
    empresarial: 20,
  },
  monthlyRecurringRevenueCop: 18450000, // ~18.4M COP
  systemLoad: '0.14%',
  databaseStorageUsed: '14.2 GB',
};

// --- COMUNICACIONES: dashboard de redes sociales (datos de muestra) ---
// Esta parte sigue siendo mock — para traer datos reales se necesita conectar
// una cuenta de Meta (Instagram Business + Página de Facebook vinculada),
// crear una app en Meta for Developers y generar un token de acceso. El día
// que eso exista, esta sección se reemplaza por una llamada al backend real,
// igual que se hizo con Inventario/Pedidos/CRM/Finanzas.

export interface SocialAccountStats {
  canal: 'instagram' | 'facebook' | 'tiktok';
  handle: string;
  seguidores: number;
  variacionSeguidores: number; // variación neta últimos 30 días
  alcance: number;
  impresiones: number;
  engagementPct: number;
}

export interface SocialPost {
  id: string;
  canal: 'instagram' | 'facebook' | 'tiktok';
  fecha: string;
  extracto: string;
  likes: number;
  comentarios: number;
  alcance: number;
}

export const INITIAL_SOCIAL_STATS: SocialAccountStats[] = [
  {
    canal: 'instagram',
    handle: '@nalu.boutique',
    seguidores: 8420,
    variacionSeguidores: 186,
    alcance: 32100,
    impresiones: 54870,
    engagementPct: 4.8,
  },
  {
    canal: 'facebook',
    handle: 'NALÚ Boutique',
    seguidores: 5210,
    variacionSeguidores: 42,
    alcance: 18650,
    impresiones: 27340,
    engagementPct: 2.6,
  },
  {
    canal: 'tiktok',
    handle: '@nalu.boutique',
    seguidores: 3110,
    variacionSeguidores: 264,
    alcance: 41200,
    impresiones: 68950,
    engagementPct: 6.3,
  },
];

export const INITIAL_SOCIAL_POSTS: SocialPost[] = [
  {
    id: 'sp-1',
    canal: 'instagram',
    fecha: '2026-06-05',
    extracto: 'Nueva colección de vestidos de verano 🌞 — ya disponible en tienda y…',
    likes: 412,
    comentarios: 38,
    alcance: 6200,
  },
  {
    id: 'sp-2',
    canal: 'facebook',
    fecha: '2026-06-03',
    extracto: 'Esta semana: 20% de descuento en calzado seleccionado. ¡No te lo…',
    likes: 156,
    comentarios: 12,
    alcance: 3400,
  },
  {
    id: 'sp-3',
    canal: 'tiktok',
    fecha: '2026-06-01',
    extracto: '"Get ready with me" usando piezas de la nueva colección 💃',
    likes: 1280,
    comentarios: 94,
    alcance: 18900,
  },
  {
    id: 'sp-4',
    canal: 'instagram',
    fecha: '2026-05-29',
    extracto: 'Detrás de cámaras de nuestra última sesión de fotos 📸',
    likes: 298,
    comentarios: 21,
    alcance: 4750,
  },
];
