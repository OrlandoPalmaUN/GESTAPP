'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { IgDashboard } from '../components/redes/IgDashboard';
import { AiChat } from '../components/ai/AiChat';
import { AiNotasHelper } from '../components/ai/AiNotasHelper';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Boxes,
  ClipboardList,
  DollarSign,
  Users,
  Settings,
  ShieldCheck,
  AlertTriangle,
  Plus,
  Search,
  FileSpreadsheet,
  TrendingUp,
  Building,

  MessageCircle,
  Instagram,
  Facebook,
  Trash2,
  Pencil,
  Tag,
  PackagePlus,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  StickyNote,
  GripVertical,
} from 'lucide-react';

import type { Abono, CategoriaGasto, CategoriaIngreso, Categoria, Cliente, CuentaBancaria, EstadoPedidoProveedor, EventoCalendario, Factura, GastoOperativo, IngresoBancario, MovimientoInventario, NotaCrm, NotaInterna, Pedido, PedidoProveedor, Producto, Proveedor, ResumenFinanciero } from '@antigravity/shared';

// Definido localmente para no forzar un import de valor de @antigravity/shared
// (el tsconfig apunta al source TS que usa extensiones .js — solo funciona con import type).
const CATEGORIAS_INGRESO_LOCAL: CategoriaIngreso[] = ['capital', 'prestamo', 'devolucion', 'venta_activo', 'otro'];

// Helper para ajustar el brillo de un color hex
// amount positivo = más claro (hacia blanco), negativo = más oscuro
function adjustColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const num = parseInt(clean, 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xFF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xFF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Icono TikTok (no está en lucide-react)
const TikTokIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/>
  </svg>
);

// Local copy — mirrors TRANSICIONES_VALIDAS_PROVEEDOR from shared to avoid
// importing a runtime value from a package that uses TypeScript ESM .js imports
// (which Next.js's webpack can't resolve without extensionAlias).
const TRANSICIONES_VALIDAS_PROVEEDOR: Record<EstadoPedidoProveedor, EstadoPedidoProveedor[]> = {
  borrador: ['enviado', 'cancelado'],
  enviado: ['recibido_parcial', 'recibido', 'cancelado'],
  recibido_parcial: ['recibido', 'cancelado'],
  recibido: [],
  cancelado: [],
};

// Local copy of CATEGORIAS_GASTO (mirrors shared) — avoids value import from @antigravity/shared.
const CATEGORIAS_GASTO_LOCAL: CategoriaGasto[] = ['arriendo', 'servicios', 'nomina', 'comisiones', 'marketing', 'otros'];
const LABEL_CATEGORIA_GASTO: Record<CategoriaGasto, string> = {
  arriendo: 'Arriendo', servicios: 'Servicios', nomina: 'Nómina',
  comisiones: 'Comisiones', marketing: 'Marketing', otros: 'Otros',
};

import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  TENANTS_GLOBAL_METRICS,
  Product,
  Category,
  InventoryMovement,
  Customer,
  Supplier,
  Invoice,
  Order,
  PaymentAbono,
} from '../lib/mockData';

// --- ADAPTADORES: la API/shared usa camelCase (Producto, Categoria,
// MovimientoInventario), pero el módulo de Inventario de este componente fue
// construido sobre tipos snake_case (Product, Category, InventoryMovement) —
// estos puentes evitan reescribir toda la UI existente.
function categoriaAMockCategory(c: Categoria): Category {
  return { id: c.id, nombre: c.nombre, descripcion: '' };
}

function productoAMockProduct(p: Producto): Product {
  return {
    id: p.id,
    sku: p.sku ?? '',
    nombre: p.nombre,
    descripcion: p.descripcion ?? '',
    categoria_id: p.categoriaId ?? '',
    precio_costo: p.precioCosto ?? 0,
    precio_venta: p.precioVenta ?? 0,
    stock_minimo: p.stockMinimo,
    // El servidor calcula el disponible vía `calcularStockDisponible` —
    // lo guardamos aparte (stockDisponibleById) y usamos este campo solo
    // como valor inicial/semilla para no romper el shape de Product.
    stock_inicial: p.stockDisponible,
  };
}

function clienteAMockCustomer(c: Cliente): Customer {
  return {
    id: c.id,
    nombre: c.nombre,
    nit: c.nit ?? '',
    email: c.email ?? '',
    telefono: c.telefono ?? '',
    direccion: c.direccion ?? '',
  };
}

function pedidoAMockOrder(p: Pedido): Order {
  return {
    id: p.id,
    numero: p.numero,
    cliente_id: p.clienteId ?? '',
    fecha: p.createdAt,
    total: p.total,
    estado: p.estado,
    notas: p.notas,
    items: p.items.map((item) => ({
      producto_id: item.productoId,
      concepto: item.concepto,
      cantidad: item.cantidad,
      precio: item.precioUnitario,
    })),
  };
}

function proveedorAMockSupplier(p: Proveedor): Supplier {
  return {
    id: p.id,
    nombre: p.nombre,
    nit: p.nit ?? '',
    email: p.email ?? '',
    telefono: p.telefono ?? '',
    direccion: p.direccion ?? '',
    contacto: p.contacto ?? '',
  };
}

/** Factura (CxC/CxP) — saldo y estado vienen YA calculados por el servidor (ver `calcularSaldoPendiente`/`calcularEstadoFactura` en shared). */
function facturaAMockInvoice(f: Factura): Invoice {
  return {
    id: f.id,
    numero: f.numero,
    tipo: f.tipo,
    cliente_id: f.clienteId ?? undefined,
    proveedor_id: f.proveedorId ?? undefined,
    pedido_id: f.pedidoId ?? undefined,
    fecha_emision: f.fechaEmision,
    fecha_vencimiento: f.fechaVencimiento,
    total: f.total,
    saldo_pendiente: f.saldoPendiente,
    estado: f.estado,
  };
}

function abonoAMockPaymentAbono(a: Abono): PaymentAbono {
  return {
    id: a.id,
    factura_id: a.facturaId,
    monto: a.monto,
    fecha: a.fecha,
    referencia: a.referencia ?? '',
  };
}

/** Bitácora CRM (notas) — formato del backend a la forma que ya entendía la UI mock. */
function notaCrmAMockNote(n: NotaCrm): { fecha: string; nota: string } {
  return { fecha: n.createdAt.slice(0, 10), nota: n.nota };
}

function movimientoAMockMovement(m: MovimientoInventario): InventoryMovement {
  return {
    id: m.id,
    producto_id: m.productoId,
    tipo: m.tipo,
    cantidad: m.cantidad,
    fecha: m.createdAt,
    detalle: m.notas ?? '',
  };
}

export default function AppHome() {
  // --- ESTADOS GENERALES DE LA APP ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventario' | 'pedidos' | 'finanzas' | 'crm' | 'comunicaciones' | 'config'>('dashboard');
  const [superAdminMode, setSuperAdminMode] = useState<boolean>(false);
  
  // --- ESTADOS DEL DATASET MUTABLE (Base de datos en memoria) ---
  // Inventario: conectado al backend real (ver fetchInventario más abajo) —
  // arrancan vacíos y se llenan desde la API según el tenant del usuario logueado.
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [stockDisponibleById, setStockDisponibleById] = useState<Record<string, number>>({});
  const [inventarioCargando, setInventarioCargando] = useState(false);
  const [inventarioError, setInventarioError] = useState<string | null>(null);
  // Clientes y Pedidos: igual que Inventario, conectados al backend real —
  // arrancan vacíos y se hidratan vía fetchPedidos (más abajo).
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pedidosCargando, setPedidosCargando] = useState(false);
  const [pedidosError, setPedidosError] = useState<string | null>(null);
  // Proveedores: igual que Clientes — conectados al backend real (tabla `proveedores`).
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [proveedoresCargando, setProveedoresCargando] = useState(false);
  const [proveedoresError, setProveedoresError] = useState<string | null>(null);
  // Facturas (CxC/CxP) y abonos: conectados al backend real — el saldo y el
  // estado de cada factura los calcula SIEMPRE el servidor (igual que el stock
  // en Inventario), nunca los derivamos en el cliente.
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [abonos, setAbonos] = useState<PaymentAbono[]>([]);
  const [finanzasCargando, setFinanzasCargando] = useState(false);
  const [finanzasError, setFinanzasError] = useState<string | null>(null);
  // Cuentas bancarias — reales, vienen de la BD del tenant (antes hardcodeadas
  // como INITIAL_BANK_ACCOUNTS). CRUD completo vía /finanzas/cuentas.
  const [bankAccounts, setBankAccounts] = useState<CuentaBancaria[]>([]);
  const [bankAccountsCargando, setBankAccountsCargando] = useState(false);
  const [bankAccountsError, setBankAccountsError] = useState<string | null>(null);
  const [showBankAccountModal, setShowBankAccountModal] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<CuentaBancaria | null>(null);
  const [bankAccountForm, setBankAccountForm] = useState<{ banco: string; numero: string; tipo: 'ahorros' | 'corriente'; saldo: string }>({
    banco: '',
    numero: '',
    tipo: 'ahorros',
    saldo: '0',
  });

  // --- Transferencias bancarias ---
  const [showTransferenciaModal, setShowTransferenciaModal] = useState(false);
  const [transferenciaForm, setTransferenciaForm] = useState<{ cuentaOrigenId: string; cuentaDestinoId: string; monto: string; descripcion: string }>({
    cuentaOrigenId: '', cuentaDestinoId: '', monto: '', descripcion: '',
  });
  const [guardandoTransferencia, setGuardandoTransferencia] = useState(false);
  const [transferenciaError, setTransferenciaError] = useState<string | null>(null);

  // --- Gastos operativos ---
  const [gastos, setGastos] = useState<GastoOperativo[]>([]);
  const [gastosCargando, setGastosCargando] = useState(false);
  const [gastosError, setGastosError] = useState<string | null>(null);
  const [showGastoModal, setShowGastoModal] = useState(false);
  const [gastoForm, setGastoForm] = useState<{ descripcion: string; categoria: CategoriaGasto; monto: string; fecha: string; medioPago: string; cuentaBancariaId: string; notas: string }>({
    descripcion: '', categoria: 'otros', monto: '', fecha: '', medioPago: '', cuentaBancariaId: '', notas: '',
  });
  const [guardandoGasto, setGuardandoGasto] = useState(false);
  const [gastoFormError, setGastoFormError] = useState<string | null>(null);

  // --- Ingresos bancarios manuales ---
  const [ingresos, setIngresos] = useState<IngresoBancario[]>([]);
  const [ingresosCargando, setIngresosCargando] = useState(false);
  const [ingresosError, setIngresosError] = useState<string | null>(null);
  const [showIngresoModal, setShowIngresoModal] = useState(false);
  const [ingresoForm, setIngresoForm] = useState<{ descripcion: string; categoria: CategoriaIngreso; monto: string; fecha: string; medioPago: string; cuentaBancariaId: string; notas: string }>({
    descripcion: '', categoria: 'otro', monto: '', fecha: '', medioPago: '', cuentaBancariaId: '', notas: '',
  });
  const [guardandoIngreso, setGuardandoIngreso] = useState(false);
  const [ingresoFormError, setIngresoFormError] = useState<string | null>(null);

  // --- Resumen financiero ---
  const [resumenFinanciero, setResumenFinanciero] = useState<ResumenFinanciero | null>(null);
  const [resumenCargando, setResumenCargando] = useState(false);

  // --- Modal recepción parcial de OC ---
  const [showRecepcionModal, setShowRecepcionModal] = useState(false);
  const [recepcionTarget, setRecepcionTarget] = useState<{ compra: PedidoProveedor; estado: EstadoPedidoProveedor } | null>(null);
  const [recepcionCantidades, setRecepcionCantidades] = useState<Record<string, string>>({});
  const [guardandoRecepcion, setGuardandoRecepcion] = useState(false);

  // --- CxP abono: modal de pago para facturas de proveedor ---
  const [showCxpAbonoModal, setShowCxpAbonoModal] = useState(false);
  const [selectedCxpInvoice, setSelectedCxpInvoice] = useState<{ id: string; numero: string; total: number; saldo: number } | null>(null);
  const [cxpAbonoForm, setCxpAbonoForm] = useState<{ monto: string; medioPago: string; referencia: string; cuentaBancariaId: string }>({
    monto: '', medioPago: 'efectivo', referencia: '', cuentaBancariaId: '',
  });
  const [guardandoCxpAbono, setGuardandoCxpAbono] = useState(false);
  const [cxpAbonoError, setCxpAbonoError] = useState<string | null>(null);

  // --- Papelera UI ---
  const [showPapelera, setShowPapelera] = useState(false);
  const [papeleraItems, setPapeleraItems] = useState<import('../lib/api').ItemPapelera[]>([]);
  const [papeleraCargando, setPapeleraCargando] = useState(false);
  const [papeleraError, setPapeleraError] = useState<string | null>(null);

  // Comunicaciones — calendario/planner: conectado al backend real (tabla
  // `eventos_calendario`). El dashboard de redes sociales sigue siendo mock
  // hasta conectar una cuenta real de Meta (requiere crear una app en Meta
  // for Developers y generar tokens — fuera de alcance por ahora).
  const [calendarEvents, setCalendarEvents] = useState<EventoCalendario[]>([]);
  const [comunicacionesCargando, setComunicacionesCargando] = useState(false);
  const [comunicacionesError, setComunicacionesError] = useState<string | null>(null);
  const [comunicacionesSubTab, setComunicacionesSubTab] = useState<'calendario' | 'redes' | 'notas'>('calendario');

  // --- Notas internas ---
  const [notasInternas, setNotasInternas] = useState<NotaInterna[]>([]);
  const [notasCargando, setNotasCargando] = useState(false);
  const [notasError, setNotasError] = useState<string | null>(null);
  const [showCreateNota, setShowCreateNota] = useState(false);
  const [notaForm, setNotaForm] = useState<{ titulo: string; tipoContenido: 'texto' | 'lista'; contenido: string; tieneCheckbox: boolean; checklistItems: { id: string; texto: string; checked: boolean; orden: number }[] }>({ titulo: '', tipoContenido: 'texto', contenido: '', tieneCheckbox: false, checklistItems: [] });
  const [guardandoNota, setGuardandoNota] = useState(false);
  const [editingNota, setEditingNota] = useState<NotaInterna | null>(null);
  const [notaEditForm, setNotaEditForm] = useState<{ titulo: string; tipoContenido: 'texto' | 'lista'; contenido: string; tieneCheckbox: boolean; checklistItems: { id: string; texto: string; checked: boolean; orden: number }[] }>({ titulo: '', tipoContenido: 'texto', contenido: '', tieneCheckbox: false, checklistItems: [] });
  const checklistDragRef = React.useRef<string | null>(null);
  const [dragOverNotaId, setDragOverNotaId] = useState<string | null>(null);
  const [calendarMonthCursor, setCalendarMonthCursor] = useState<Date>(() => new Date());
  // Vista de "próximos 7 días" del dashboard — offset en días desde hoy (las flechas mueven la ventana de a 7).
  const [dashboardWeekOffset, setDashboardWeekOffset] = useState(0);
  const [dashboardSlide, setDashboardSlide] = useState(0);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventFormTipo, setEventFormTipo] = useState<'nota' | 'recordatorio' | 'post'>('nota');
  const [eventFormTitulo, setEventFormTitulo] = useState('');
  const [eventFormDescripcion, setEventFormDescripcion] = useState('');
  const [eventFormFecha, setEventFormFecha] = useState('');
  const [eventFormCanal, setEventFormCanal] = useState<'instagram' | 'facebook' | 'tiktok'>('instagram');
  const [eventFormError, setEventFormError] = useState<string | null>(null);

  // --- Popup de evento de calendario ---
  const [eventoPopup, setEventoPopup] = useState<EventoCalendario | null>(null);
  const [eventoPopupDesc, setEventoPopupDesc] = useState('');
  const [eventoPopupGuardando, setEventoPopupGuardando] = useState(false);

  // --- Popup de nota (dashboard) ---
  const [notaPopup, setNotaPopup] = useState<NotaInterna | null>(null);

  // --- Vista de pedidos ---
  const [pedidosVista, setPedidosVista] = useState<'lista' | 'kanban'>('lista');
  const [pedidoExpandido, setPedidoExpandido] = useState<string | null>(null);
  const [pedidosOrden, setPedidosOrden] = useState<'fecha_desc' | 'fecha_asc' | 'total_desc' | 'total_asc' | 'estado' | 'cliente'>('fecha_desc');

  // --- Pedidos a Proveedores (órdenes de compra) ---
  const [compras, setCompras] = useState<PedidoProveedor[]>([]);
  const [comprasCargando, setComprasCargando] = useState(false);
  const [comprasError, setComprasError] = useState<string | null>(null);
  const [showCreateCompra, setShowCreateCompra] = useState(false);
  const [compraForm, setCompraForm] = useState<{
    proveedorId: string;
    fechaEsperada: string;
    notas: string;
    items: { productoId: string; concepto: string; esLibre: boolean; cantidad: string; precioUnitario: string }[];
  }>({ proveedorId: '', fechaEsperada: '', notas: '', items: [{ productoId: '', concepto: '', esLibre: false, cantidad: '1', precioUnitario: '0' }] });
  const [guardandoCompra, setGuardandoCompra] = useState(false);
  const [compraFormError, setCompraFormError] = useState<string | null>(null);
  const [selectedCompra, setSelectedCompra] = useState<PedidoProveedor | null>(null);
  const [editingCompra, setEditingCompra] = useState<PedidoProveedor | null>(null);
  const [editCompraForm, setEditCompraForm] = useState<{
    proveedorId: string;
    fechaEsperada: string;
    notas: string;
    items: { productoId: string; concepto: string; esLibre: boolean; cantidad: string; precioUnitario: string }[];
  }>({ proveedorId: '', fechaEsperada: '', notas: '', items: [] });
  const [guardandoEditCompra, setGuardandoEditCompra] = useState(false);
  const [editCompraError, setEditCompraError] = useState<string | null>(null);
  const [transicionandoCompra, setTransicionandoCompra] = useState(false);

  // --- SUB-TABS INTERNAS ---
  const [financeSubTab, setFinanceSubTab] = useState<'resumen' | 'cxc' | 'cxp' | 'compras' | 'gastos' | 'ingresos'>('resumen');

  // --- BUSCADORES Y FILTROS ---
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'critical' | 'instock'>('all');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [crmTypeFilter, setCrmTypeFilter] = useState<'all' | 'clientes' | 'proveedores'>('clientes');

  // --- ESTADOS DE DIÁLOGOS Y WIZARDS ---
  // 1. Crear producto
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    nombre: '',
    descripcion: '',
    categoria_id: '',
    precio_costo: '',
    precio_venta: '',
    stock_minimo: '10',
    stock_inicial: '20',
  });
  // Crear categoría "al vuelo" desde el propio selector — evita el viaje a otra
  // pantalla solo para dar de alta una categoría que no existía todavía.
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  // --- EDICIÓN/ELIMINACIÓN UNIVERSAL: cada módulo tiene su propio modal de
  // edición (mismo look & feel que el de creación, ya prellenado) y un botón
  // de borrado suave. Lo borrado es recuperable — ver toast de "Deshacer"
  // (usa /papelera/restaurar) justo debajo.
  const [undoToast, setUndoToast] = useState<{ mensaje: string; entidad: string; id: string } | null>(null);
  const mostrarUndoToast = useCallback((mensaje: string, entidad: string, id: string) => {
    setUndoToast({ mensaje, entidad, id });
    window.setTimeout(() => {
      setUndoToast((actual) => (actual?.id === id && actual?.entidad === entidad ? null : actual));
    }, 8000);
  }, []);
  const handleDeshacer = async () => {
    if (!undoToast) return;
    const { entidad, id } = undoToast;
    setUndoToast(null);
    try {
      await api.restaurarDePapelera(entidad, id);
      await Promise.all([fetchInventario(), fetchPedidos(), fetchProveedores(), fetchFinanzas(), fetchCuentasBancarias(), fetchComunicaciones()]);
    } catch {
      // Si la restauración falla (p. ej. ya pasó de 30 días) no hay mucho más que hacer aquí.
    }
  };

  // Edición de Producto
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProductForm, setEditProductForm] = useState({
    sku: '', nombre: '', descripcion: '', categoria_id: '', precio_costo: '', precio_venta: '', stock_minimo: '',
  });

  // --- Registrar entrada de stock (reabastecimiento manual) ---
  const [stockEntryProduct, setStockEntryProduct] = useState<Product | null>(null);
  const [stockEntryForm, setStockEntryForm] = useState({ cantidad: '', precio_costo: '', notas: '' });
  const [registrandoEntrada, setRegistrandoEntrada] = useState(false);
  const [stockEntryError, setStockEntryError] = useState<string | null>(null);

  // Edición de Categoría (rename in-place)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');

  // Administrador de categorías — panel dedicado (crear/renombrar/eliminar
  // en un solo lugar, en vez de obligar a abrir "Nuevo Producto" para crear).
  const [showCategoryAdmin, setShowCategoryAdmin] = useState(false);
  const [adminCategoryName, setAdminCategoryName] = useState('');
  const [creandoCategoriaAdmin, setCreandoCategoriaAdmin] = useState(false);
  const [categoryAdminError, setCategoryAdminError] = useState<string | null>(null);
  const handleCreateCategoryAdmin = async () => {
    const nombre = adminCategoryName.trim();
    if (!nombre) {
      setCategoryAdminError('Escribe un nombre para la categoría.');
      return;
    }
    setCreandoCategoriaAdmin(true);
    setCategoryAdminError(null);
    try {
      await api.crearCategoria({ nombre });
      await fetchInventario();
      setAdminCategoryName('');
    } catch (error) {
      setCategoryAdminError(error instanceof ApiError ? error.message : 'No se pudo crear la categoría.');
    } finally {
      setCreandoCategoriaAdmin(false);
    }
  };

  // Edición de Cliente
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editCustomerForm, setEditCustomerForm] = useState({ nombre: '', nit: '', email: '', telefono: '', direccion: '' });

  // Creación de Cliente
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ nombre: '', nit: '', email: '', telefono: '', direccion: '', ciudad: '' });
  const [creandoCliente, setCreandoCliente] = useState(false);
  const [createCustomerError, setCreateCustomerError] = useState<string | null>(null);

  // Edición de Proveedor
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editSupplierForm, setEditSupplierForm] = useState({ nombre: '', nit: '', email: '', telefono: '', direccion: '', contacto: '' });

  // Creación de Proveedor
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [newSupplierForm, setNewSupplierForm] = useState({ nombre: '', nit: '', email: '', telefono: '', direccion: '', contacto: '' });
  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [createSupplierError, setCreateSupplierError] = useState<string | null>(null);

  // Edición de Pedido (solo cliente/notas — el resto va por sus propios flujos)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editOrderForm, setEditOrderForm] = useState({ cliente_id: '', notas: '' });

  // Edición de Factura (solo vencimiento/notas — el saldo/estado siempre los calcula el servidor)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editInvoiceForm, setEditInvoiceForm] = useState({ fecha_vencimiento: '', notas: '' });

  // Edición de Abono (solo medio de pago/referencia/fecha — NO el monto)
  const [editingAbono, setEditingAbono] = useState<PaymentAbono | null>(null);
  const [editAbonoForm, setEditAbonoForm] = useState({ medio_pago: '', referencia: '', fecha: '' });

  // 2. Importador de Excel
  const [showImportExcel, setShowImportExcel] = useState(false);
  const [importStep, setImportStep] = useState(1); // 1: Upload, 2: Mapping, 3: Validation, 4: Success
  const [excelFilename, setExcelFilename] = useState('');
  const [excelMapping, setExcelMapping] = useState({
    sku: 'REF_PRODUCTO',
    nombre: 'DESCRIPCION_LARGA',
    precio_venta: 'PRECIO_CORRIENTE',
    stock_inicial: 'CANTIDAD_FONDOS',
    stock_minimo: 'ALERTAS_UMBRAL',
  });
  const [importProgress, setImportProgress] = useState(0);
  const [importLogs, setImportLogs] = useState<string[]>([]);

  // 3. Crear pedido
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  // Inline: crear cliente desde el formulario de pedido
  const [showInlineNewClient, setShowInlineNewClient] = useState(false);
  const [inlineClientForm, setInlineClientForm] = useState({ nombre: '', email: '', telefono: '' });
  const [inlineCreandoCliente, setInlineCreandoCliente] = useState(false);
  const [inlineClientError, setInlineClientError] = useState<string | null>(null);

  // --- Gestor de pedido (popup) ---
  const [orderManager, setOrderManager] = useState<Order | null>(null);
  const [orderManagerNotas, setOrderManagerNotas] = useState('');
  const [guardandoNotasPedido, setGuardandoNotasPedido] = useState(false);
  const [abonoForm, setAbonoForm] = useState({ monto: '', medioPago: 'efectivo', referencia: '', cuentaBancariaId: '' });
  const [guardandoAbono, setGuardandoAbono] = useState(false);
  const [abonoError, setAbonoError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  // `precio_excepcional`: cuando es `null` se usa el precio de catálogo
  // (PRECIO_CORRIENTE); si el usuario lo edita, viaja como override puntual
  // de ESTE pedido (p.ej. un descuento negociado) — el margen se recalcula
  // en vivo comparándolo contra el costo del producto.
  const [orderItems, setOrderItems] = useState<{ producto_id: string; cantidad: number; precio_excepcional: number | null }[]>([
    { producto_id: 'prod-1', cantidad: 1, precio_excepcional: null },
  ]);
  const [orderValidationError, setOrderValidationError] = useState<string | null>(null);
  // Cargo dinámico de "Envío": un ítem que NO está en el catálogo — se cobra
  // "a costo" (costo = precio, margen cero) pero el cliente igual debe
  // pagarlo. Se modela aparte de `orderItems` porque no referencia un
  // producto — viaja como `{ concepto, precioUnitario }` (ver `api.crearPedido`).
  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [shippingPrice, setShippingPrice] = useState('');

  // 4. Registrar abono
  const [showAllCxC, setShowAllCxC] = useState(false);
  const [showCreateAbono, setShowCreateAbono] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [abonoMonto, setAbonoMonto] = useState('');
  const [abonoReferencia, setAbonoReferencia] = useState('');

  // 5. CRM - Ver detalle cliente y agregar interacción
  const [selectedCrmEntityId, setSelectedCrmEntityId] = useState<string>('');
  const [newCrmInteraction, setNewCrmInteraction] = useState('');
  // Bitácora CRM: notas de la entidad seleccionada — se cargan del backend
  // (tabla `notas_crm`, vía /crm/notas) cada vez que cambia la selección.
  const [crmNotas, setCrmNotas] = useState<{ fecha: string; nota: string }[]>([]);
  const [crmNotasCargando, setCrmNotasCargando] = useState(false);
  const [crmNotasError, setCrmNotasError] = useState<string | null>(null);

  // --- INVENTARIO: conectado al backend real ---
  // El usuario logueado define el tenant (resuelto por sesión en el
  // middleware tenant-resolver — ver apps/api). El superadmin no tiene
  // tenantId y por lo tanto no opera sobre datos de negocio (Inventario).
  const { usuario, tenant, cargando, logout, actualizarPerfil } = useAuth();
  const router = useRouter();

  // Auth guard: redirect to /login if not authenticated
  useEffect(() => {
    if (!cargando && !usuario) {
      router.replace('/login');
    }
  }, [cargando, usuario, router]);

  // Personalización de UI: el color secundario de marca (`brand-blue`) es
  // editable por cada usuario y vive en `usuario.colorSecundario` (BD). Lo
  // aplicamos como variable CSS (--brand-blue, ver globals.css/tailwind.config)
  // así no hay que tocar ninguna clase de Tailwind existente.
  const [colorSecundarioInput, setColorSecundarioInput] = useState('#5092A9');
  const [guardandoColor, setGuardandoColor] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);

  useEffect(() => {
    const color = usuario?.colorSecundario ?? '#5092A9';
    setColorSecundarioInput(color);
    document.documentElement.style.setProperty('--brand-blue', color);
  }, [usuario?.colorSecundario]);

  const handleGuardarColorSecundario = async (color: string | null) => {
    setGuardandoColor(true);
    setColorError(null);
    try {
      await actualizarPerfil({ colorSecundario: color });
    } catch (error) {
      setColorError(error instanceof ApiError ? error.message : 'No se pudo guardar el color.');
    } finally {
      setGuardandoColor(false);
    }
  };

  const fetchInventario = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setInventarioCargando(true);
    setInventarioError(null);
    try {
      const [categoriasRes, productosRes, movimientosRes] = await Promise.all([
        api.listarCategorias(),
        api.listarProductos(),
        api.listarMovimientosInventario(),
      ]);

      setCategories(categoriasRes.categorias.map(categoriaAMockCategory));
      setMovements(movimientosRes.movimientos.map(movimientoAMockMovement));

      const stockPorId: Record<string, number> = {};
      productosRes.productos.forEach((p) => {
        stockPorId[p.id] = p.stockDisponible;
      });
      setStockDisponibleById(stockPorId);
      setProducts(productosRes.productos.map(productoAMockProduct));
    } catch (error) {
      setInventarioError(error instanceof ApiError ? error.message : 'No se pudo cargar el inventario.');
    } finally {
      setInventarioCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => {
    void fetchInventario();
  }, [fetchInventario]);

  // --- CLIENTES Y PEDIDOS: conectados al backend real ---
  // Igual que Inventario: dependen del tenant del usuario logueado y se
  // recargan tras cada mutación (crear pedido, transicionar estado) para que
  // la UI siempre refleje el estado autoritativo del servidor — NUNCA mutamos
  // `orders`/`movements` localmente, así nunca pueden divergir del backend.
  const fetchPedidos = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setPedidosCargando(true);
    setPedidosError(null);
    try {
      const [clientesRes, pedidosRes] = await Promise.all([api.listarClientes(), api.listarPedidos()]);
      setCustomers(clientesRes.clientes.map(clienteAMockCustomer));
      setOrders(pedidosRes.pedidos.map(pedidoAMockOrder));
    } catch (error) {
      setPedidosError(error instanceof ApiError ? error.message : 'No se pudieron cargar los pedidos.');
    } finally {
      setPedidosCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => {
    void fetchPedidos();
  }, [fetchPedidos]);

  // Una vez cargan los clientes reales, fijamos una selección por defecto
  // (el formulario de "Crear Pedido" y el panel de CRM necesitan un id inicial).
  useEffect(() => {
    if (customers.length === 0) return;
    setSelectedCustomerId((prev) => (prev && customers.some((c) => c.id === prev) ? prev : customers[0]!.id));
    setSelectedCrmEntityId((prev) => (prev && customers.some((c) => c.id === prev) ? prev : customers[0]!.id));
  }, [customers]);

  // --- CRM: Proveedores y bitácora de interacciones, conectados al backend real ---
  const fetchProveedores = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setProveedoresCargando(true);
    setProveedoresError(null);
    try {
      const { proveedores } = await api.listarProveedores();
      setSuppliers(proveedores.map(proveedorAMockSupplier));
    } catch (error) {
      setProveedoresError(error instanceof ApiError ? error.message : 'No se pudieron cargar los proveedores.');
    } finally {
      setProveedoresCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => {
    void fetchProveedores();
  }, [fetchProveedores]);

  // La bitácora depende de QUÉ entidad está seleccionada y de qué tipo es
  // (cliente o proveedor) — se recarga cada vez que cambia la selección.
  const crmEntidadTipo: 'cliente' | 'proveedor' = crmTypeFilter === 'proveedores' ? 'proveedor' : 'cliente';

  const fetchCrmNotas = useCallback(async () => {
    if (!usuario?.tenantId || !selectedCrmEntityId) {
      setCrmNotas([]);
      return;
    }
    setCrmNotasCargando(true);
    setCrmNotasError(null);
    try {
      const { notas } = await api.listarNotasCrm(crmEntidadTipo, selectedCrmEntityId);
      setCrmNotas(notas.map(notaCrmAMockNote));
    } catch (error) {
      setCrmNotasError(error instanceof ApiError ? error.message : 'No se pudo cargar la bitácora de interacciones.');
    } finally {
      setCrmNotasCargando(false);
    }
  }, [usuario?.tenantId, selectedCrmEntityId, crmEntidadTipo]);

  useEffect(() => {
    void fetchCrmNotas();
  }, [fetchCrmNotas]);

  // --- FINANZAS: facturas (CxC/CxP) y abonos, conectados al backend real ---
  // El saldo y el estado de cada factura los calcula SIEMPRE el servidor
  // (igual que el stock en Inventario) — nunca los derivamos en el cliente.
  const fetchFinanzas = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setFinanzasCargando(true);
    setFinanzasError(null);
    try {
      const [cxcRes, cxpRes, abonosRes] = await Promise.all([
        api.listarFacturas('cxc'),
        api.listarFacturas('cxp'),
        api.listarAbonos(),
      ]);
      setInvoices([...cxcRes.facturas, ...cxpRes.facturas].map(facturaAMockInvoice));
      setAbonos(abonosRes.abonos.map(abonoAMockPaymentAbono));
    } catch (error) {
      setFinanzasError(error instanceof ApiError ? error.message : 'No se pudo cargar la información financiera.');
    } finally {
      setFinanzasCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => {
    void fetchFinanzas();
  }, [fetchFinanzas]);

  // Cuentas bancarias — reales, vienen de la BD del tenant (tabla
  // `cuentas_bancarias`, antes hardcodeadas como INITIAL_BANK_ACCOUNTS).
  const fetchCuentasBancarias = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setBankAccountsCargando(true);
    setBankAccountsError(null);
    try {
      const { cuentas } = await api.listarCuentasBancarias();
      setBankAccounts(cuentas);
    } catch (error) {
      setBankAccountsError(error instanceof ApiError ? error.message : 'No se pudieron cargar las cuentas bancarias.');
    } finally {
      setBankAccountsCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => {
    void fetchCuentasBancarias();
  }, [fetchCuentasBancarias]);

  const resetBankAccountForm = () => {
    setEditingBankAccount(null);
    setBankAccountForm({ banco: '', numero: '', tipo: 'ahorros', saldo: '0' });
  };

  const openCreateBankAccountModal = () => {
    resetBankAccountForm();
    setShowBankAccountModal(true);
  };

  const openEditBankAccountModal = (cuenta: CuentaBancaria) => {
    setEditingBankAccount(cuenta);
    setBankAccountForm({ banco: cuenta.banco, numero: cuenta.numero, tipo: cuenta.tipo, saldo: String(cuenta.saldo) });
    setShowBankAccountModal(true);
  };

  const handleSaveBankAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const banco = bankAccountForm.banco.trim();
    const numero = bankAccountForm.numero.trim();
    if (!banco || !numero) return;
    const saldo = Number(bankAccountForm.saldo);
    try {
      if (editingBankAccount) {
        await api.actualizarCuentaBancaria(editingBankAccount.id, { banco, numero, tipo: bankAccountForm.tipo, saldo });
      } else {
        await api.crearCuentaBancaria({ banco, numero, tipo: bankAccountForm.tipo, saldo });
      }
      setShowBankAccountModal(false);
      resetBankAccountForm();
      await fetchCuentasBancarias();
    } catch (error) {
      setBankAccountsError(error instanceof ApiError ? error.message : 'No se pudo guardar la cuenta bancaria.');
    }
  };

  const handleDeleteBankAccount = async (cuenta: CuentaBancaria) => {
    if (!window.confirm(`¿Eliminar la cuenta "${cuenta.banco} · ${cuenta.numero}"? Podrás deshacerlo desde la papelera.`)) return;
    try {
      await api.eliminarCuentaBancaria(cuenta.id);
      await fetchCuentasBancarias();
    } catch (error) {
      setBankAccountsError(error instanceof ApiError ? error.message : 'No se pudo eliminar la cuenta bancaria.');
    }
  };

  // --- Gastos operativos ---
  const fetchGastos = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setGastosCargando(true);
    setGastosError(null);
    try {
      const { gastos: data } = await api.listarGastos();
      setGastos(data);
    } catch (error) {
      setGastosError(error instanceof ApiError ? error.message : 'No se pudieron cargar los gastos.');
    } finally {
      setGastosCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => { void fetchGastos(); }, [fetchGastos]);

  const handleCrearGasto = async (e: React.FormEvent) => {
    e.preventDefault();
    const monto = parseFloat(gastoForm.monto);
    if (!gastoForm.descripcion.trim() || !monto || monto <= 0) {
      setGastoFormError('Descripción y monto son obligatorios.');
      return;
    }
    setGuardandoGasto(true);
    setGastoFormError(null);
    try {
      await api.crearGasto({
        descripcion: gastoForm.descripcion.trim(),
        categoria: gastoForm.categoria,
        monto,
        fecha: gastoForm.fecha || undefined,
        medioPago: gastoForm.medioPago || undefined,
        cuentaBancariaId: gastoForm.cuentaBancariaId || undefined,
        notas: gastoForm.notas || undefined,
      });
      setShowGastoModal(false);
      setGastoForm({ descripcion: '', categoria: 'otros', monto: '', fecha: '', medioPago: '', cuentaBancariaId: '', notas: '' });
      await Promise.all([fetchGastos(), fetchCuentasBancarias(), fetchResumen()]);
    } catch (error) {
      setGastoFormError(error instanceof ApiError ? error.message : 'No se pudo registrar el gasto.');
    } finally {
      setGuardandoGasto(false);
    }
  };

  const handleEliminarGasto = async (gasto: GastoOperativo) => {
    if (!window.confirm(`¿Eliminar el gasto "${gasto.descripcion}"?`)) return;
    try {
      await api.eliminarGasto(gasto.id);
      await Promise.all([fetchGastos(), fetchResumen()]);
    } catch (error) {
      setGastosError(error instanceof ApiError ? error.message : 'No se pudo eliminar el gasto.');
    }
  };

  // --- Ingresos bancarios manuales ---
  const fetchIngresos = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setIngresosCargando(true);
    setIngresosError(null);
    try {
      const { ingresos: data } = await api.listarIngresos();
      setIngresos(data);
    } catch (error) {
      setIngresosError(error instanceof ApiError ? error.message : 'No se pudieron cargar los ingresos.');
    } finally {
      setIngresosCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => { void fetchIngresos(); }, [fetchIngresos]);

  const handleCrearIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    const monto = parseFloat(ingresoForm.monto);
    if (!ingresoForm.descripcion.trim() || !monto || monto <= 0) {
      setIngresoFormError('Descripción y monto son obligatorios.');
      return;
    }
    if (!ingresoForm.cuentaBancariaId) {
      setIngresoFormError('Debes seleccionar una cuenta bancaria.');
      return;
    }
    setGuardandoIngreso(true);
    setIngresoFormError(null);
    try {
      await api.crearIngreso({
        descripcion: ingresoForm.descripcion.trim(),
        categoria: ingresoForm.categoria,
        monto,
        fecha: ingresoForm.fecha || undefined,
        medioPago: ingresoForm.medioPago || undefined,
        cuentaBancariaId: ingresoForm.cuentaBancariaId,
        notas: ingresoForm.notas || undefined,
      });
      setShowIngresoModal(false);
      setIngresoForm({ descripcion: '', categoria: 'otro', monto: '', fecha: '', medioPago: '', cuentaBancariaId: '', notas: '' });
      await Promise.all([fetchIngresos(), fetchCuentasBancarias(), fetchResumen()]);
    } catch (error) {
      setIngresoFormError(error instanceof ApiError ? error.message : 'No se pudo registrar el ingreso.');
    } finally {
      setGuardandoIngreso(false);
    }
  };

  const handleEliminarIngreso = async (ingreso: IngresoBancario) => {
    if (!window.confirm(`¿Eliminar el ingreso "${ingreso.descripcion}"?`)) return;
    try {
      await api.eliminarIngreso(ingreso.id);
      await Promise.all([fetchIngresos(), fetchCuentasBancarias(), fetchResumen()]);
    } catch (error) {
      setIngresosError(error instanceof ApiError ? error.message : 'No se pudo eliminar el ingreso.');
    }
  };

  // --- Resumen financiero ---
  const fetchResumen = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setResumenCargando(true);
    try {
      const { resumen } = await api.resumenFinanciero();
      setResumenFinanciero(resumen);
    } catch {
      // resumen es informativo; si falla, no bloqueamos nada
    } finally {
      setResumenCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => { void fetchResumen(); }, [fetchResumen]);

  // --- Recepción parcial de OC ---
  const openRecepcionModal = (compra: PedidoProveedor, estado: EstadoPedidoProveedor) => {
    const cantidades: Record<string, string> = {};
    for (const item of compra.items) {
      // Preseleccionar la cantidad pendiente (cantidad total - ya recibida)
      const pendiente = item.cantidad - (item.cantidadRecibida ?? 0);
      cantidades[item.id] = estado === 'recibido' ? String(pendiente) : '';
    }
    setRecepcionCantidades(cantidades);
    setRecepcionTarget({ compra, estado });
    setShowRecepcionModal(true);
  };

  const handleConfirmarRecepcion = async () => {
    if (!recepcionTarget) return;
    setGuardandoRecepcion(true);
    try {
      const cantidades = recepcionTarget.compra.items
        .map((item) => ({
          itemId: item.id,
          cantidadRecibida: (item.cantidadRecibida ?? 0) + (parseFloat(recepcionCantidades[item.id] ?? '0') || 0),
        }))
        .filter((c) => c.cantidadRecibida > 0);
      const updated = await api.transicionarCompra(recepcionTarget.compra.id, recepcionTarget.estado, { cantidades });
      setCompras(prev => prev.map(c => c.id === recepcionTarget.compra.id ? updated.pedido : c));
      if (selectedCompra?.id === recepcionTarget.compra.id) setSelectedCompra(updated.pedido);
      setShowRecepcionModal(false);
      setRecepcionTarget(null);
      await Promise.all([fetchCuentasBancarias(), fetchFinanzas(), fetchResumen()]);
    } catch (error) {
      alert(error instanceof ApiError ? error.message : 'Error al registrar recepción.');
    } finally {
      setGuardandoRecepcion(false);
    }
  };

  // --- Transferencias bancarias ---
  const handleCrearTransferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    const monto = parseFloat(transferenciaForm.monto);
    if (!transferenciaForm.cuentaOrigenId || !transferenciaForm.cuentaDestinoId || !monto || monto <= 0) {
      setTransferenciaError('Selecciona ambas cuentas y el monto.');
      return;
    }
    if (transferenciaForm.cuentaOrigenId === transferenciaForm.cuentaDestinoId) {
      setTransferenciaError('La cuenta de origen y destino deben ser distintas.');
      return;
    }
    setGuardandoTransferencia(true);
    setTransferenciaError(null);
    try {
      const { cuentas } = await api.crearTransferencia({
        cuentaOrigenId: transferenciaForm.cuentaOrigenId,
        cuentaDestinoId: transferenciaForm.cuentaDestinoId,
        monto,
        descripcion: transferenciaForm.descripcion || undefined,
      });
      // Actualizar saldos de las dos cuentas afectadas sin full refetch.
      setBankAccounts(prev => prev.map(c => {
        const updated = cuentas.find(u => u.id === c.id);
        return updated ?? c;
      }));
      setShowTransferenciaModal(false);
      setTransferenciaForm({ cuentaOrigenId: '', cuentaDestinoId: '', monto: '', descripcion: '' });
    } catch (error) {
      setTransferenciaError(error instanceof ApiError ? error.message : 'No se pudo realizar la transferencia.');
    } finally {
      setGuardandoTransferencia(false);
    }
  };

  // --- CxP abono ---
  const openCxpAbono = (inv: { id: string; numero: string; total: number; saldo: number }) => {
    setSelectedCxpInvoice(inv);
    setCxpAbonoForm({ monto: String(inv.saldo), medioPago: 'efectivo', referencia: '', cuentaBancariaId: bankAccounts[0]?.id ?? '' });
    setCxpAbonoError(null);
    setShowCxpAbonoModal(true);
  };

  const handleCxpAbono = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCxpInvoice) return;
    const monto = parseFloat(cxpAbonoForm.monto);
    if (!monto || monto <= 0) { setCxpAbonoError('El monto debe ser mayor que cero.'); return; }
    setGuardandoCxpAbono(true);
    setCxpAbonoError(null);
    try {
      await api.crearAbono({
        facturaId: selectedCxpInvoice.id,
        tipo: 'cxp',
        monto,
        medioPago: cxpAbonoForm.medioPago || undefined,
        referencia: cxpAbonoForm.referencia || undefined,
        cuentaBancariaId: cxpAbonoForm.cuentaBancariaId || undefined,
      });
      setShowCxpAbonoModal(false);
      setSelectedCxpInvoice(null);
      await Promise.all([fetchFinanzas(), fetchCuentasBancarias(), fetchResumen()]);
    } catch (error) {
      setCxpAbonoError(error instanceof ApiError ? error.message : 'No se pudo registrar el pago.');
    } finally {
      setGuardandoCxpAbono(false);
    }
  };

  // --- Papelera ---
  const fetchPapelera = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setPapeleraCargando(true);
    setPapeleraError(null);
    try {
      const { items } = await api.listarPapelera();
      setPapeleraItems(items);
    } catch (error) {
      setPapeleraError(error instanceof ApiError ? error.message : 'No se pudo cargar la papelera.');
    } finally {
      setPapeleraCargando(false);
    }
  }, [usuario?.tenantId]);

  const handleRestaurarDePapelera = async (entidad: string, id: string) => {
    if (!window.confirm('¿Restaurar este elemento?')) return;
    try {
      await api.restaurarDePapelera(entidad, id);
      await fetchPapelera();
      await Promise.all([fetchInventario(), fetchPedidos(), fetchProveedores(), fetchFinanzas(), fetchCuentasBancarias(), fetchComunicaciones()]);
    } catch (error) {
      setPapeleraError(error instanceof ApiError ? error.message : 'No se pudo restaurar.');
    }
  };

  // --- COMUNICACIONES: calendario/planner, conectado al backend real ---
  // (notas, recordatorios y posts planeados — tabla `eventos_calendario`).
  // El dashboard de redes sociales sigue usando datos de muestra.
  const fetchComunicaciones = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setComunicacionesCargando(true);
    setComunicacionesError(null);
    try {
      const { eventos } = await api.listarEventosCalendario();
      setCalendarEvents(eventos);
    } catch (error) {
      setComunicacionesError(error instanceof ApiError ? error.message : 'No se pudo cargar el calendario.');
    } finally {
      setComunicacionesCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => {
    void fetchComunicaciones();
  }, [fetchComunicaciones]);

  const resetEventForm = () => {
    setEventFormTipo('nota');
    setEventFormTitulo('');
    setEventFormDescripcion('');
    setEventFormFecha('');
    setEventFormCanal('instagram');
    setEventFormError(null);
  };

  const handleCreateCalendarEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventFormTitulo.trim() || !eventFormFecha) {
      setEventFormError('El título y la fecha son obligatorios.');
      return;
    }
    setEventFormError(null);
    try {
      await api.crearEventoCalendario({
        tipo: eventFormTipo,
        titulo: eventFormTitulo.trim(),
        descripcion: eventFormDescripcion.trim() || undefined,
        fecha: eventFormFecha,
        canal: eventFormTipo === 'post' ? eventFormCanal : null,
      });
      setShowCreateEvent(false);
      resetEventForm();
      await fetchComunicaciones();
    } catch (error) {
      setEventFormError(error instanceof ApiError ? error.message : 'No se pudo guardar el evento.');
    }
  };

  // Transiciones de estado para eventos del calendario
  const TRANSICIONES_EVENTO_LOCAL: Record<string, string | null> = {
    idea: 'grabado', grabado: 'editado', editado: 'subido', subido: null,
    pendiente: 'hecho', hecho: null,
  };

  const handleAvanzarEventEstado = async (evento: EventoCalendario) => {
    setComunicacionesError(null);
    const siguiente = TRANSICIONES_EVENTO_LOCAL[evento.estado] ?? null;
    if (!siguiente) return;
    try {
      await api.actualizarEventoCalendario(evento.id, { estado: siguiente as EventoCalendario['estado'] });
      await fetchComunicaciones();
    } catch (error) {
      setComunicacionesError(error instanceof ApiError ? error.message : 'No se pudo actualizar el evento.');
    }
  };

  // Backward: volver al estado anterior
  const ESTADO_ANTERIOR_LOCAL: Record<string, string | null> = {
    grabado: 'idea', editado: 'grabado', subido: 'editado',
    hecho: 'pendiente',
    idea: null, pendiente: null,
  };

  const handleRetrocederEventEstado = async (evento: EventoCalendario) => {
    const anterior = ESTADO_ANTERIOR_LOCAL[evento.estado] ?? null;
    if (!anterior) return;
    try {
      await api.actualizarEventoCalendario(evento.id, { estado: anterior as EventoCalendario['estado'] });
      await fetchComunicaciones();
    } catch (error) {
      setComunicacionesError(error instanceof ApiError ? error.message : 'No se pudo actualizar el evento.');
    }
  };

  // Keep to avoid unused-var lint error (still referenced in some older paths)
  void handleAvanzarEventEstado;

  // Handler: guardar descripción en popup de evento
  const handleGuardarEventoDesc = async () => {
    if (!eventoPopup) return;
    setEventoPopupGuardando(true);
    try {
      await api.actualizarEventoCalendario(eventoPopup.id, { descripcion: eventoPopupDesc });
      setCalendarEvents(prev => prev.map(e => e.id === eventoPopup.id ? { ...e, descripcion: eventoPopupDesc } : e));
    } catch (error) {
      setComunicacionesError(error instanceof ApiError ? error.message : 'No se pudo guardar la descripción.');
    } finally {
      setEventoPopupGuardando(false);
    }
  };

  // Handler: cambiar estado desde popup de evento
  const handlePopupCambiarEstado = async (evento: EventoCalendario, siguiente: string) => {
    try {
      await api.actualizarEventoCalendario(evento.id, { estado: siguiente as EventoCalendario['estado'] });
      const actualizado = { ...evento, estado: siguiente as EventoCalendario['estado'] };
      setCalendarEvents(prev => prev.map(e => e.id === evento.id ? actualizado : e));
      setEventoPopup(actualizado);
    } catch (error) {
      setComunicacionesError(error instanceof ApiError ? error.message : 'No se pudo actualizar el estado.');
    }
  };

  const handleDeleteCalendarEvent = async (id: string) => {
    setComunicacionesError(null);
    const evento = calendarEvents.find((e) => e.id === id);
    try {
      await api.eliminarEventoCalendario(id);
      await fetchComunicaciones();
      mostrarUndoToast(`Evento "${evento?.titulo ?? ''}" eliminado.`, 'evento_calendario', id);
    } catch (error) {
      setComunicacionesError(error instanceof ApiError ? error.message : 'No se pudo eliminar el evento.');
    }
  };

  // --- Notas internas ---
  const fetchCompras = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setComprasCargando(true);
    setComprasError(null);
    try {
      const { pedidos } = await api.listarCompras();
      setCompras(pedidos);
    } catch (error) {
      setComprasError(error instanceof ApiError ? error.message : 'No se pudieron cargar las órdenes de compra.');
    } finally {
      setComprasCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => { void fetchCompras(); }, [fetchCompras]);

  const handleCrearCompra = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompraFormError(null);
    if (compraForm.items.length === 0) { setCompraFormError('Agrega al menos un ítem.'); return; }
    setGuardandoCompra(true);
    try {
      const items = compraForm.items.map(item => {
        if (item.esLibre) {
          return { concepto: item.concepto, cantidad: parseFloat(item.cantidad) || 1, precioUnitario: parseFloat(item.precioUnitario) || 0 };
        }
        return { productoId: item.productoId, cantidad: parseFloat(item.cantidad) || 1, precioUnitario: parseFloat(item.precioUnitario) || 0 };
      });
      await api.crearCompra({
        proveedorId: compraForm.proveedorId || null,
        fechaEsperada: compraForm.fechaEsperada || undefined,
        notas: compraForm.notas || undefined,
        items,
      });
      setShowCreateCompra(false);
      setCompraForm({ proveedorId: '', fechaEsperada: '', notas: '', items: [{ productoId: '', concepto: '', esLibre: false, cantidad: '1', precioUnitario: '0' }] });
      await fetchCompras();
    } catch (error) {
      setCompraFormError(error instanceof ApiError ? error.message : 'No se pudo crear la orden de compra.');
    } finally {
      setGuardandoCompra(false);
    }
  };

  const handleTransicionarCompra = async (compra: PedidoProveedor, estado: EstadoPedidoProveedor) => {
    // Para recepciones, abrir modal de cantidades por ítem
    if ((estado === 'recibido' || estado === 'recibido_parcial') && compra.items.some(i => i.productoId)) {
      openRecepcionModal(compra, estado);
      return;
    }
    setTransicionandoCompra(true);
    try {
      const updated = await api.transicionarCompra(compra.id, estado);
      setCompras(prev => prev.map(c => c.id === compra.id ? updated.pedido : c));
      if (selectedCompra?.id === compra.id) setSelectedCompra(updated.pedido);
    } catch (error) {
      alert(error instanceof ApiError ? error.message : 'Error al cambiar estado.');
    } finally {
      setTransicionandoCompra(false);
    }
  };

  const openEditCompra = (compra: PedidoProveedor) => {
    setEditCompraError(null);
    setEditCompraForm({
      proveedorId: compra.proveedorId ?? '',
      fechaEsperada: compra.fechaEsperada ?? '',
      notas: compra.notas ?? '',
      items: compra.items.map(item => ({
        productoId: item.productoId ?? '',
        concepto: item.concepto ?? '',
        esLibre: !item.productoId,
        cantidad: String(item.cantidad),
        precioUnitario: String(item.precioUnitario),
      })),
    });
    setEditingCompra(compra);
  };

  const handleGuardarEditCompra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompra) return;
    setEditCompraError(null);
    if (editCompraForm.items.length === 0) { setEditCompraError('La orden debe tener al menos un ítem.'); return; }
    setGuardandoEditCompra(true);
    try {
      const items = editCompraForm.items.map(item => {
        if (item.esLibre) {
          return { concepto: item.concepto, cantidad: parseFloat(item.cantidad) || 1, precioUnitario: parseFloat(item.precioUnitario) || 0 };
        }
        return { productoId: item.productoId, cantidad: parseFloat(item.cantidad) || 1, precioUnitario: parseFloat(item.precioUnitario) || 0 };
      });
      const { pedido: updated } = await api.actualizarCompra(editingCompra.id, {
        proveedorId: editCompraForm.proveedorId || null,
        fechaEsperada: editCompraForm.fechaEsperada || null,
        notas: editCompraForm.notas || null,
        items,
      });
      setCompras(prev => prev.map(c => c.id === updated.id ? updated : c));
      if (selectedCompra?.id === updated.id) setSelectedCompra(updated);
      setEditingCompra(null);
    } catch (error) {
      setEditCompraError(error instanceof ApiError ? error.message : 'No se pudo guardar la orden.');
    } finally {
      setGuardandoEditCompra(false);
    }
  };

  const handleEliminarCompra = async (compra: PedidoProveedor) => {
    if (!window.confirm(`¿Eliminar la orden "${compra.numero}"?`)) return;
    try {
      await api.eliminarCompra(compra.id);
      await fetchCompras();
      if (selectedCompra?.id === compra.id) setSelectedCompra(null);
    } catch (error) {
      alert(error instanceof ApiError ? error.message : 'No se pudo eliminar la orden.');
    }
  };

  const fetchNotasInternas = useCallback(async () => {
    if (!usuario?.tenantId) return;
    setNotasCargando(true);
    setNotasError(null);
    try {
      const { notas } = await api.listarNotasInternas();
      setNotasInternas(notas);
    } catch (error) {
      setNotasError(error instanceof ApiError ? error.message : 'No se pudieron cargar las notas.');
    } finally {
      setNotasCargando(false);
    }
  }, [usuario?.tenantId]);

  useEffect(() => { void fetchNotasInternas(); }, [fetchNotasInternas]);

  // Auto-avance del slider del dashboard cada 10 segundos
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    const timer = setInterval(() => setDashboardSlide((s) => (s + 1) % 3), 10000);
    return () => clearInterval(timer);
  }, [activeTab]);

  // Serializa los items de checklist a JSON para guardar en `contenido`
  const serializarChecklist = (items: { id: string; texto: string; checked: boolean; orden: number }[]) =>
    JSON.stringify(items.map((item, i) => ({ ...item, orden: i })));

  // Parsea JSON de checklist desde `contenido`, con fallback a array vacío
  const parsearChecklist = (contenido: string | null): { id: string; texto: string; checked: boolean; orden: number }[] => {
    try { return contenido ? (JSON.parse(contenido) as { id: string; texto: string; checked: boolean; orden: number }[]) : []; }
    catch { return []; }
  };

  // Reordena checklist: unchecked primero (por orden), checked al final (por orden)
  const sortChecklist = (items: { id: string; texto: string; checked: boolean; orden: number }[]) => {
    const unchecked = items.filter(i => !i.checked).sort((a, b) => a.orden - b.orden);
    const checked = items.filter(i => i.checked).sort((a, b) => a.orden - b.orden);
    return [...unchecked, ...checked];
  };

  const handleCrearNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notaForm.titulo.trim()) return;
    setGuardandoNota(true);
    try {
      const esLista = notaForm.tipoContenido === 'lista';
      await api.crearNotaInterna({
        titulo: notaForm.titulo.trim(),
        tipoContenido: notaForm.tipoContenido,
        contenido: esLista
          ? serializarChecklist(notaForm.checklistItems)
          : (notaForm.contenido.trim() || undefined),
        tieneCheckbox: notaForm.tieneCheckbox,
      });
      setNotaForm({ titulo: '', tipoContenido: 'texto', contenido: '', tieneCheckbox: false, checklistItems: [] });
      setShowCreateNota(false);
      await fetchNotasInternas();
    } catch (error) {
      setNotasError(error instanceof ApiError ? error.message : 'No se pudo crear la nota.');
    } finally {
      setGuardandoNota(false);
    }
  };

  const handleToggleNotaCompletada = async (nota: NotaInterna) => {
    try {
      await api.actualizarNotaInterna(nota.id, { completada: !nota.completada });
      setNotasInternas((prev) => prev.map((n) => n.id === nota.id ? { ...n, completada: !n.completada } : n));
    } catch (error) {
      setNotasError(error instanceof ApiError ? error.message : 'No se pudo actualizar la nota.');
    }
  };

  const handleGuardarEdicionNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNota || !notaEditForm.titulo.trim()) return;
    setGuardandoNota(true);
    try {
      const esLista = notaEditForm.tipoContenido === 'lista';
      await api.actualizarNotaInterna(editingNota.id, {
        titulo: notaEditForm.titulo.trim(),
        tipoContenido: notaEditForm.tipoContenido,
        contenido: esLista
          ? serializarChecklist(notaEditForm.checklistItems)
          : (notaEditForm.contenido.trim() || null),
        tieneCheckbox: notaEditForm.tieneCheckbox,
      });
      setEditingNota(null);
      await fetchNotasInternas();
    } catch (error) {
      setNotasError(error instanceof ApiError ? error.message : 'No se pudo guardar la nota.');
    } finally {
      setGuardandoNota(false);
    }
  };

  const handleEliminarNota = async (nota: NotaInterna) => {
    if (!window.confirm(`¿Eliminar la nota "${nota.titulo}"?`)) return;
    try {
      await api.eliminarNotaInterna(nota.id);
      await fetchNotasInternas();
    } catch (error) {
      setNotasError(error instanceof ApiError ? error.message : 'No se pudo eliminar la nota.');
    }
  };

  // Drag-and-drop reordering — al soltar actualizamos `orden` en el servidor.
  const dragNotaIdRef = React.useRef<string | null>(null);

  const handleNotaDragStart = (id: string) => { dragNotaIdRef.current = id; };
  const handleNotaDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); setDragOverNotaId(id); };
  const handleNotaDrop = async (targetId: string) => {
    setDragOverNotaId(null);
    const sourceId = dragNotaIdRef.current;
    if (!sourceId || sourceId === targetId) return;
    dragNotaIdRef.current = null;

    // Reorder locally first for instant feedback.
    const sorted = notasSorted(notasInternas);
    const fromIdx = sorted.findIndex((n) => n.id === sourceId);
    const toIdx = sorted.findIndex((n) => n.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(fromIdx, 1);
    if (!moved) return;
    reordered.splice(toIdx, 0, moved);
    const withNewOrden = reordered.map((n, i) => ({ ...n, orden: i }));
    setNotasInternas(withNewOrden);

    // Persist new orden for changed items.
    await Promise.allSettled(
      withNewOrden
        .filter((n, i) => n.orden !== notasInternas[i]?.orden)
        .map((n) => api.actualizarNotaInterna(n.id, { orden: n.orden }))
    );
  };

  function notasSorted(notas: NotaInterna[]): NotaInterna[] {
    return [...notas].sort((a, b) => {
      // 1: checkbox sin completar  2: sin checkbox  3: checkbox completado
      const grupo = (n: NotaInterna) => n.tieneCheckbox ? (n.completada ? 3 : 1) : 2;
      const diff = grupo(a) - grupo(b);
      if (diff !== 0) return diff;
      return a.orden - b.orden || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  // ===================================================================
  // EDICIÓN/ELIMINACIÓN UNIVERSAL — un modal por entidad (mismo patrón
  // visual que el de creación, ya prellenado) + borrado suave con
  // "deshacer" (toast → /papelera/restaurar). Cada handler sigue el mismo
  // ciclo: abrir con datos prellenados → guardar (PATCH) → recargar listado.
  // ===================================================================

  // --- Producto ---
  const openEditProduct = (p: Product) => {
    setEditingProduct(p);
    setEditProductForm({
      sku: p.sku,
      nombre: p.nombre,
      descripcion: p.descripcion,
      categoria_id: p.categoria_id,
      precio_costo: String(p.precio_costo),
      precio_venta: String(p.precio_venta),
      stock_minimo: String(p.stock_minimo),
    });
  };
  const handleSaveEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    try {
      await api.actualizarProducto(editingProduct.id, {
        sku: editProductForm.sku || undefined,
        nombre: editProductForm.nombre,
        descripcion: editProductForm.descripcion,
        categoriaId: editProductForm.categoria_id || null,
        precioCosto: parseFloat(editProductForm.precio_costo) || 0,
        precioVenta: parseFloat(editProductForm.precio_venta) || 0,
        stockMinimo: parseInt(editProductForm.stock_minimo) || 0,
      });
      setEditingProduct(null);
      await fetchInventario();
    } catch (error) {
      setInventarioError(error instanceof ApiError ? error.message : 'No se pudo actualizar el producto.');
    }
  };
  const handleDeleteProduct = async (p: Product) => {
    if (!window.confirm(`¿Eliminar el producto "${p.nombre}"? Podrás deshacerlo desde el aviso que aparecerá.`)) return;
    try {
      await api.eliminarProducto(p.id);
      await fetchInventario();
      mostrarUndoToast(`Producto "${p.nombre}" eliminado.`, 'producto', p.id);
    } catch (error) {
      setInventarioError(error instanceof ApiError ? error.message : 'No se pudo eliminar el producto.');
    }
  };

  const openStockEntry = (p: Product) => {
    setStockEntryProduct(p);
    setStockEntryForm({ cantidad: '', precio_costo: p.precio_costo ? String(p.precio_costo) : '', notas: '' });
    setStockEntryError(null);
  };
  const handleRegisterStockEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockEntryProduct) return;
    const cantidad = parseFloat(stockEntryForm.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      setStockEntryError('La cantidad debe ser mayor que cero.');
      return;
    }
    setRegistrandoEntrada(true);
    setStockEntryError(null);
    try {
      await api.crearMovimientoInventario({
        productoId: stockEntryProduct.id,
        tipo: 'entrada_compra',
        cantidad,
        precioUnitario: stockEntryForm.precio_costo ? parseFloat(stockEntryForm.precio_costo) || 0 : null,
        notas: stockEntryForm.notas || `Entrada de stock — ${stockEntryProduct.nombre}`,
      });
      setStockEntryProduct(null);
      await fetchInventario();
    } catch (error) {
      setStockEntryError(error instanceof ApiError ? error.message : 'No se pudo registrar la entrada de stock.');
    } finally {
      setRegistrandoEntrada(false);
    }
  };

  // --- Categoría (rename in-place + eliminar) ---
  const openEditCategory = (c: Category) => {
    setEditingCategoryId(c.id);
    setEditCategoryName(c.nombre);
  };
  const handleSaveEditCategory = async (id: string) => {
    const nombre = editCategoryName.trim();
    if (!nombre) return;
    try {
      await api.actualizarCategoria(id, { nombre });
      setEditingCategoryId(null);
      await fetchInventario();
    } catch (error) {
      setInventarioError(error instanceof ApiError ? error.message : 'No se pudo renombrar la categoría.');
      setEditingCategoryId(null);
    }
  };
  const handleDeleteCategory = async (c: Category) => {
    if (!window.confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return;
    try {
      await api.eliminarCategoria(c.id);
      await fetchInventario();
      mostrarUndoToast(`Categoría "${c.nombre}" eliminada.`, 'categoria', c.id);
    } catch (error) {
      setInventarioError(error instanceof ApiError ? error.message : 'No se pudo eliminar la categoría.');
    }
  };

  // --- Cliente ---
  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setEditCustomerForm({ nombre: c.nombre, nit: c.nit, email: c.email, telefono: c.telefono, direccion: c.direccion });
  };
  const handleSaveEditCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    try {
      await api.actualizarCliente(editingCustomer.id, {
        nombre: editCustomerForm.nombre,
        nit: editCustomerForm.nit || null,
        email: editCustomerForm.email || null,
        telefono: editCustomerForm.telefono || null,
        direccion: editCustomerForm.direccion || null,
      });
      setEditingCustomer(null);
      await fetchPedidos();
    } catch (error) {
      setProveedoresError(error instanceof ApiError ? error.message : 'No se pudo actualizar el cliente.');
    }
  };
  const handleDeleteCustomer = async (c: Customer) => {
    if (!window.confirm(`¿Eliminar el cliente "${c.nombre}"? Podrás deshacerlo desde el aviso que aparecerá.`)) return;
    try {
      await api.eliminarCliente(c.id);
      if (selectedCrmEntityId === c.id) setSelectedCrmEntityId('');
      await fetchPedidos();
      mostrarUndoToast(`Cliente "${c.nombre}" eliminado.`, 'cliente', c.id);
    } catch (error) {
      setProveedoresError(error instanceof ApiError ? error.message : 'No se pudo eliminar el cliente.');
    }
  };

  // --- Proveedor ---
  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setEditSupplierForm({ nombre: s.nombre, nit: s.nit, email: s.email, telefono: s.telefono, direccion: s.direccion, contacto: s.contacto });
  };
  const handleSaveEditSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;
    try {
      await api.actualizarProveedor(editingSupplier.id, {
        nombre: editSupplierForm.nombre,
        nit: editSupplierForm.nit || null,
        email: editSupplierForm.email || null,
        telefono: editSupplierForm.telefono || null,
        direccion: editSupplierForm.direccion || null,
        contacto: editSupplierForm.contacto || null,
      });
      setEditingSupplier(null);
      await fetchProveedores();
    } catch (error) {
      setProveedoresError(error instanceof ApiError ? error.message : 'No se pudo actualizar el proveedor.');
    }
  };
  const handleDeleteSupplier = async (s: Supplier) => {
    if (!window.confirm(`¿Eliminar el proveedor "${s.nombre}"? Podrás deshacerlo desde el aviso que aparecerá.`)) return;
    try {
      await api.eliminarProveedor(s.id);
      if (selectedCrmEntityId === s.id) setSelectedCrmEntityId('');
      await fetchProveedores();
      mostrarUndoToast(`Proveedor "${s.nombre}" eliminado.`, 'proveedor', s.id);
    } catch (error) {
      setProveedoresError(error instanceof ApiError ? error.message : 'No se pudo eliminar el proveedor.');
    }
  };

  // --- Crear Cliente ---
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerForm.nombre.trim()) {
      setCreateCustomerError('El nombre del cliente es obligatorio.');
      return;
    }
    setCreandoCliente(true);
    setCreateCustomerError(null);
    try {
      await api.crearCliente({
        nombre: newCustomerForm.nombre.trim(),
        nit: newCustomerForm.nit.trim() || undefined,
        email: newCustomerForm.email.trim() || undefined,
        telefono: newCustomerForm.telefono.trim() || undefined,
        direccion: newCustomerForm.direccion.trim() || undefined,
        ciudad: newCustomerForm.ciudad.trim() || undefined,
      });
      setShowCreateCustomer(false);
      setNewCustomerForm({ nombre: '', nit: '', email: '', telefono: '', direccion: '', ciudad: '' });
      await fetchPedidos();
    } catch (error) {
      setCreateCustomerError(error instanceof ApiError ? error.message : 'No se pudo crear el cliente.');
    } finally {
      setCreandoCliente(false);
    }
  };

  // --- Crear Proveedor ---
  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierForm.nombre.trim()) {
      setCreateSupplierError('El nombre / razón social del proveedor es obligatorio.');
      return;
    }
    setCreandoProveedor(true);
    setCreateSupplierError(null);
    try {
      await api.crearProveedor({
        nombre: newSupplierForm.nombre.trim(),
        nit: newSupplierForm.nit.trim() || undefined,
        email: newSupplierForm.email.trim() || undefined,
        telefono: newSupplierForm.telefono.trim() || undefined,
        direccion: newSupplierForm.direccion.trim() || undefined,
        contacto: newSupplierForm.contacto.trim() || undefined,
      });
      setShowCreateSupplier(false);
      setNewSupplierForm({ nombre: '', nit: '', email: '', telefono: '', direccion: '', contacto: '' });
      await fetchProveedores();
    } catch (error) {
      setCreateSupplierError(error instanceof ApiError ? error.message : 'No se pudo crear el proveedor.');
    } finally {
      setCreandoProveedor(false);
    }
  };

  // --- Pedido (solo cliente/notas — ítems/total/estado van por sus propios flujos) ---
  const openEditOrder = (o: Order) => {
    setEditingOrder(o);
    setEditOrderForm({ cliente_id: o.cliente_id, notas: '' });
  };
  const handleSaveEditOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    try {
      await api.actualizarPedido(editingOrder.id, {
        clienteId: editOrderForm.cliente_id || null,
        notas: editOrderForm.notas || null,
      });
      setEditingOrder(null);
      await fetchPedidos();
    } catch (error) {
      setPedidosError(error instanceof ApiError ? error.message : 'No se pudo actualizar el pedido.');
    }
  };
  const handleDeleteOrder = async (o: Order) => {
    if (!window.confirm(`¿Eliminar el pedido "${o.numero}"? Esta acción se puede deshacer desde el aviso que aparecerá.`)) return;
    try {
      await api.eliminarPedido(o.id);
      await fetchPedidos();
      mostrarUndoToast(`Pedido "${o.numero}" eliminado.`, 'pedido', o.id);
    } catch (error) {
      setPedidosError(error instanceof ApiError ? error.message : 'No se pudo eliminar el pedido.');
    }
  };

  // --- Factura (solo vencimiento/notas — saldo/estado siempre los calcula el servidor) ---
  const openEditInvoice = (inv: Invoice) => {
    setEditingInvoice(inv);
    setEditInvoiceForm({ fecha_vencimiento: inv.fecha_vencimiento, notas: '' });
  };
  const handleSaveEditInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice) return;
    try {
      await api.actualizarFactura(editingInvoice.id, editingInvoice.tipo, {
        fechaVencimiento: editInvoiceForm.fecha_vencimiento || undefined,
        notas: editInvoiceForm.notas || null,
      });
      setEditingInvoice(null);
      await fetchFinanzas();
    } catch (error) {
      setFinanzasError(error instanceof ApiError ? error.message : 'No se pudo actualizar la factura.');
    }
  };
  const handleDeleteInvoice = async (inv: Invoice) => {
    if (!window.confirm(`¿Eliminar la factura "${inv.numero}"? Solo es posible si no tiene abonos registrados. Podrás deshacerlo desde el aviso que aparecerá.`)) return;
    try {
      await api.eliminarFactura(inv.id, inv.tipo);
      await fetchFinanzas();
      mostrarUndoToast(`Factura "${inv.numero}" eliminada.`, inv.tipo === 'cxc' ? 'factura_venta' : 'factura_compra', inv.id);
    } catch (error) {
      setFinanzasError(error instanceof ApiError ? error.message : 'No se pudo eliminar la factura.');
    }
  };

  // --- Abono (solo medio de pago/referencia/fecha — NUNCA el monto, que recalcularía el saldo) ---
  const openEditAbono = (ab: PaymentAbono) => {
    setEditingAbono(ab);
    setEditAbonoForm({ medio_pago: '', referencia: ab.referencia, fecha: ab.fecha });
  };
  const handleSaveEditAbono = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAbono) return;
    try {
      await api.actualizarAbono(editingAbono.id, {
        medioPago: editAbonoForm.medio_pago || null,
        referencia: editAbonoForm.referencia || null,
        fecha: editAbonoForm.fecha || undefined,
      });
      setEditingAbono(null);
      await Promise.all([fetchFinanzas(), fetchResumen()]);
    } catch (error) {
      setFinanzasError(error instanceof ApiError ? error.message : 'No se pudo actualizar el abono.');
    }
  };
  const handleDeleteAbono = async (ab: PaymentAbono) => {
    if (!window.confirm('¿Eliminar este abono? El saldo de la factura se recalculará. Podrás deshacerlo desde el aviso que aparecerá.')) return;
    try {
      await api.eliminarAbono(ab.id);
      await Promise.all([fetchFinanzas(), fetchResumen()]);
      mostrarUndoToast('Abono eliminado.', 'abono', ab.id);
    } catch (error) {
      setFinanzasError(error instanceof ApiError ? error.message : 'No se pudo eliminar el abono.');
    }
  };

  // --- CÁLCULOS EN TIEMPO REAL ---
  // El disponible lo calcula el servidor (regla "el stock nunca se escribe
  // directo" — ver calcularStockDisponible en @antigravity/shared); aquí solo
  // lo exponemos indexado por id para que el resto de la UI lo siga usando tal
  // cual, igual que cuando venía del cálculo local sobre datos mock.
  const productStocks = useMemo(() => {
    const stocks: Record<string, number> = { ...stockDisponibleById };
    products.forEach((p) => {
      if (stocks[p.id] === undefined) stocks[p.id] = p.stock_inicial;
    });
    return stocks;
  }, [products, stockDisponibleById]);

  // Lista de productos con stock crítico (disponible <= mínimo)
  const criticalProducts = useMemo(() => {
    return products.filter((p) => {
      const currentStock = productStocks[p.id] ?? 0;
      return currentStock <= p.stock_minimo;
    });
  }, [products, productStocks]);

  // Métricas financieras del tenant actual
  const financialMetrics = useMemo(() => {
    let totalCxC = 0;
    let vencidoCxC = 0;
    let totalCxP = 0;

    invoices.forEach((inv) => {
      if (inv.tipo === 'cxc') {
        totalCxC += inv.saldo_pendiente;
        if (inv.estado === 'vencida') vencidoCxC += inv.saldo_pendiente;
      } else {
        totalCxP += inv.saldo_pendiente;
      }
    });

    return { totalCxC, vencidoCxC, totalCxP };
  }, [invoices]);

  // Métricas de ventas calculadas sobre `orders` (datos reales del backend).
  const ventasMetrics = useMemo(() => {
    const ahora = new Date();
    const hoyStr = ahora.toISOString().slice(0, 10); // YYYY-MM-DD
    const mesStr = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM

    const activos = orders.filter((o) => o.estado !== 'cancelado');
    const delDia = activos.filter((o) => o.fecha.startsWith(hoyStr));
    const delMes = activos.filter((o) => o.fecha.startsWith(mesStr));

    return {
      totalDia: delDia.reduce((s, o) => s + o.total, 0),
      countDia: delDia.length,
      totalMes: delMes.reduce((s, o) => s + o.total, 0),
      countMes: delMes.length,
    };
  }, [orders]);

  // Efectivo en bancos = suma de saldos de todas las cuentas registradas.
  const totalEnBancos = useMemo(() => bankAccounts.reduce((s, b) => s + b.saldo, 0), [bankAccounts]);

  // Facturas vencidas para el panel de alertas del dashboard.
  const facturasVencidas = useMemo(() => invoices.filter((i) => i.estado === 'vencida'), [invoices]);

  // Cuadrícula del calendario mensual — semanas completas (puede incluir días
  // del mes anterior/siguiente para rellenar la primera/última semana) y un
  // mapa fecha (YYYY-MM-DD) -> eventos de ese día, para pintar el planner.
  const calendarGrid = useMemo(() => {
    const year = calendarMonthCursor.getFullYear();
    const month = calendarMonthCursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay(); // 0 = domingo
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const toKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const days: { date: Date; key: string; enMes: boolean }[] = [];
    for (let i = 0; i < totalCells; i++) {
      const date = new Date(year, month, 1 - startOffset + i);
      days.push({ date, key: toKey(date), enMes: date.getMonth() === month });
    }

    const eventosPorDia = new Map<string, EventoCalendario[]>();
    for (const evento of calendarEvents) {
      const lista = eventosPorDia.get(evento.fecha) ?? [];
      lista.push(evento);
      eventosPorDia.set(evento.fecha, lista);
    }

    return { days, eventosPorDia, label: calendarMonthCursor.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }) };
  }, [calendarMonthCursor, calendarEvents]);

  // --- FUNCIONES DE NEGOCIO ---
  
  // 1. Crear nuevo producto — POST real contra /inventario/productos.
  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const cost = parseFloat(newProduct.precio_costo) || 0;
    const price = parseFloat(newProduct.precio_venta) || 0;
    const minStock = parseInt(newProduct.stock_minimo) || 0;
    const initStock = parseInt(newProduct.stock_inicial) || 0;

    try {
      await api.crearProducto({
        nombre: newProduct.nombre || 'Producto Nuevo',
        descripcion: newProduct.descripcion || undefined,
        categoriaId: newProduct.categoria_id || null,
        precioCosto: cost,
        precioVenta: price,
        stockMinimo: minStock,
        stockInicial: initStock,
      });

      setShowCreateProduct(false);
      setNewProduct({
        nombre: '',
        descripcion: '',
        categoria_id: '',
        precio_costo: '',
        precio_venta: '',
        stock_minimo: '10',
        stock_inicial: '20',
      });
      setShowNewCategoryInput(false);
      setNewCategoryName('');
      setNewCategoryError(null);

      await fetchInventario();
    } catch (error) {
      setInventarioError(error instanceof ApiError ? error.message : 'No se pudo crear el producto.');
    }
  };

  // 1b. Crear categoría desde el propio selector del modal de producto —
  // se crea, se refresca la lista y se deja seleccionada de una vez.
  const handleCreateCategoryInline = async () => {
    const nombre = newCategoryName.trim();
    if (!nombre) {
      setNewCategoryError('Escribe un nombre para la categoría.');
      return;
    }
    setCreandoCategoria(true);
    setNewCategoryError(null);
    try {
      const { categoria } = await api.crearCategoria({ nombre });
      await fetchInventario();
      setNewProduct((prev) => ({ ...prev, categoria_id: categoria.id }));
      setShowNewCategoryInput(false);
      setNewCategoryName('');
    } catch (error) {
      setNewCategoryError(error instanceof ApiError ? error.message : 'No se pudo crear la categoría.');
    } finally {
      setCreandoCategoria(false);
    }
  };

  // 2. Simulación de carga e importación desde Excel
  const triggerExcelUpload = () => {
    setExcelFilename('inventario_ferreteria_y_textil_2026.xlsx');
    setImportStep(2);
  };

  const executeImportSimulation = () => {
    setImportStep(3);
    setImportLogs([]);
    setImportProgress(0);

    const logMessages = [
      'Leyendo hojas del libro Excel...',
      'Analizando columna: SKU [Mapeado de REF_PRODUCTO]',
      'Analizando columna: Nombre [Mapeado de DESCRIPCION_LARGA]',
      'Validando tipos de datos y nulos...',
      'Validando SKU únicos en base de datos...',
      'Transfiriendo datos a lote temporal...',
      'Insertando productos en lote #1...',
      'Actualizando saldos iniciales y registros de inventario...',
      '¡Listo! Base de datos sincronizada.'
    ];

    let currentLog = 0;
    const interval = setInterval(() => {
      setImportProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          
          // Agregar un producto real de prueba a la lista importada para mostrar efectividad
          const importedProd: Product = {
            id: 'prod-imported-1',
            sku: 'TX-IMPORT-99',
            nombre: 'Botones y Broches Metálicos (Importado)',
            descripcion: 'Caja de broches de alta resistencia',
            categoria_id: 'cat-3',
            precio_costo: 8000,
            precio_venta: 22000,
            stock_minimo: 50,
            stock_inicial: 150,
          };
          setProducts(prevProducts => [importedProd, ...prevProducts]);
          
          setImportStep(4);
          return 100;
        }
        
        // Agregar logs asíncronos en base al progreso
        if (currentLog < logMessages.length && prev >= (currentLog * 12)) {
          const msg = logMessages[currentLog];
          if (msg) {
            setImportLogs(prevLogs => [...prevLogs, msg]);
          }
          currentLog++;
        }
        
        return prev + 10;
      });
    }, 300);
  };

  // 3. Crear nuevo pedido — el SERVIDOR valida stock, resuelve precios del
  // catálogo y genera el número consecutivo. Nunca fabricamos el pedido localmente.
  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setOrderValidationError(null);

    // OJO: a propósito NO validamos stock disponible acá — el usuario puede
    // crear pedidos que dejen el stock en negativo (p. ej. para registrar
    // ventas sobre pedido / preventas). El servidor ya no lo bloquea tampoco
    // (ver `apps/api/.../pedidos.ts`); `orderValidationError` queda solo para
    // mostrar errores reales que el servidor devuelva.

    void (async () => {
      try {
        const itemsAEnviar: Parameters<typeof api.crearPedido>[0]['items'] = orderItems.map((item) => ({
          productoId: item.producto_id,
          cantidad: item.cantidad,
          ...(item.precio_excepcional !== null ? { precioUnitario: item.precio_excepcional } : {}),
        }));
        if (shippingEnabled) {
          itemsAEnviar.push({ concepto: 'Envío', cantidad: 1, precioUnitario: parseFloat(shippingPrice) || 0 });
        }
        await api.crearPedido({
          clienteId: selectedCustomerId || null,
          items: itemsAEnviar,
        });
        setShowCreateOrder(false);
        setOrderItems([{ producto_id: products[0]?.id ?? 'prod-1', cantidad: 1, precio_excepcional: null }]);
        setShippingEnabled(false);
        setShippingPrice('');
        await Promise.all([fetchPedidos(), fetchFinanzas()]);
      } catch (err: unknown) {
        setOrderValidationError(err instanceof ApiError ? err.message : 'Ocurrió un error inesperado al crear el pedido.');
      }
    })();
  };

  // Crear cliente inline desde el formulario de pedido
  const handleInlineCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineClientForm.nombre.trim()) {
      setInlineClientError('El nombre es obligatorio.');
      return;
    }
    setInlineCreandoCliente(true);
    setInlineClientError(null);
    try {
      const { cliente } = await api.crearCliente({
        nombre: inlineClientForm.nombre.trim(),
        email: inlineClientForm.email.trim() || undefined,
        telefono: inlineClientForm.telefono.trim() || undefined,
      });
      await fetchPedidos(); // recarga customers
      setSelectedCustomerId(cliente.id); // auto-selecciona el nuevo cliente
      setShowInlineNewClient(false);
      setInlineClientForm({ nombre: '', email: '', telefono: '' });
    } catch (err) {
      setInlineClientError(err instanceof ApiError ? err.message : 'No se pudo crear el cliente.');
    } finally {
      setInlineCreandoCliente(false);
    }
  };

  /**
   * Nombre "amigable" de un pedido — pensado para identificarlo de un
   * vistazo sin tener que leer el consecutivo `PED-AAAA-NNNN`:
   *
   *   "Pedido <primer nombre del cliente> #<n-ésima compra de ese cliente> · <primer producto>"
   *
   * El "número de compra" es la posición de ESTE pedido dentro del historial
   * de pedidos de ese cliente (ordenado del más antiguo al más reciente) —
   * o sea, "esta es su compra #3". El nombre de producto es el del primer
   * ítem que sí referencia un producto de catálogo (los cargos libres como
   * Envío no cuentan para esto).
   */
  const getOrderDisplayName = (ord: Order): string => {
    const client = customers.find((c) => c.id === ord.cliente_id);
    const primerNombre = client?.nombre?.trim().split(/\s+/)[0] ?? 'Sin cliente';

    const pedidosDelCliente = orders
      .filter((o) => o.cliente_id === ord.cliente_id)
      .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
    const numeroDeCompra = pedidosDelCliente.findIndex((o) => o.id === ord.id) + 1;

    const primerItemConProducto = ord.items.find((i) => i.producto_id !== null);
    const nombreProducto = primerItemConProducto
      ? products.find((p) => p.id === primerItemConProducto.producto_id)?.nombre
      : undefined;

    let nombre = `Pedido ${primerNombre}${numeroDeCompra > 0 ? ` #${numeroDeCompra}` : ''}`;
    if (nombreProducto) nombre += ` · ${nombreProducto}`;
    if (ord.items.length > 1) nombre += ` (+${ord.items.length - 1})`;
    return nombre;
  };

  // Gestor de pedido: guardar notas
  const handleGuardarNotasPedido = async () => {
    if (!orderManager) return;
    setGuardandoNotasPedido(true);
    try {
      await api.actualizarPedido(orderManager.id, { notas: orderManagerNotas || null });
      await fetchPedidos();
    } catch (err) {
      setPedidosError(err instanceof ApiError ? err.message : 'No se pudo guardar las notas.');
    } finally {
      setGuardandoNotasPedido(false);
    }
  };

  // Gestor de pedido: crear abono (con refresh en tiempo real de la factura correspondiente)
  const handleCrearAbono = async (facturaId: string, monto: number, pagarCompleto = false) => {
    setGuardandoAbono(true);
    setAbonoError(null);
    try {
      await api.crearAbono({
        facturaId,
        tipo: 'cxc',
        monto,
        medioPago: pagarCompleto ? 'efectivo' : (abonoForm.medioPago || 'efectivo'),
        referencia: pagarCompleto ? undefined : (abonoForm.referencia || undefined),
        cuentaBancariaId: abonoForm.cuentaBancariaId || undefined,
      });
      setAbonoForm({ monto: '', medioPago: 'efectivo', referencia: '', cuentaBancariaId: '' });
      // Refresh finanzas — updated invoice with new saldo comes back immediately.
      await Promise.all([fetchFinanzas(), fetchResumen()]);
    } catch (err) {
      setAbonoError(err instanceof ApiError ? err.message : 'No se pudo registrar el abono.');
    } finally {
      setGuardandoAbono(false);
    }
  };

  // 4. Cambiar estado de pedido — el SERVIDOR valida la transición y genera
  // (transaccionalmente) los movimientos de inventario que correspondan.
  // Tras la transición, refrescamos tanto pedidos como inventario (el stock cambió).
  const handleTransitionOrder = (orderId: string, targetState: Order['estado']) => {
    void (async () => {
      try {
        await api.transicionarPedido(orderId, targetState);
        await Promise.all([fetchPedidos(), fetchInventario(), fetchFinanzas()]);
      } catch (err: unknown) {
        setPedidosError(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado del pedido.');
      }
    })();
  };

  // 5. Registrar abono a factura
  // El abono se registra contra el backend real — el servidor recalcula el
  // saldo (con lock transaccional) y rechaza overpagos; nunca mutamos
  // `invoices`/`abonos` localmente, solo refrescamos desde el servidor.
  const handleCreateAbono = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(abonoMonto) || 0;
    if (amount <= 0 || !selectedInvoiceId) return;

    const invoice = invoices.find(inv => inv.id === selectedInvoiceId);
    if (!invoice) return;

    setFinanzasError(null);
    try {
      await api.crearAbono({
        facturaId: selectedInvoiceId,
        tipo: invoice.tipo,
        monto: amount,
        referencia: abonoReferencia || undefined,
      });
      setShowCreateAbono(false);
      setAbonoMonto('');
      setAbonoReferencia('');
      await Promise.all([fetchFinanzas(), fetchResumen()]);
    } catch (error) {
      setFinanzasError(error instanceof ApiError ? error.message : 'No se pudo registrar el abono.');
    }
  };

  // 8. CRM - Agregar interacción
  const handleAddCrmInteraction = (e: React.FormEvent) => {
    e.preventDefault();
    const nota = newCrmInteraction.trim();
    if (!nota || !selectedCrmEntityId) return;

    void (async () => {
      try {
        await api.crearNotaCrm({ entidadTipo: crmEntidadTipo, entidadId: selectedCrmEntityId, nota });
        setNewCrmInteraction('');
        await fetchCrmNotas();
      } catch (err: unknown) {
        setCrmNotasError(err instanceof ApiError ? err.message : 'No se pudo registrar la interacción.');
      }
    })();
  };

  // 9. WhatsApp - Enviar mensaje de prueba
  return (
    <main className="w-screen h-screen bg-white flex flex-col font-sans overflow-hidden">
        
        {/* NAVBAR SUPERIOR */}
        <header className="border-b-2 border-black p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between bg-white z-10 gap-3">
          <div className="flex items-center gap-3">
            <span className="font-mono font-black text-xl tracking-tighter bg-black text-white px-2.5 py-1 select-none">
              {"// GESTAPP"}
            </span>
            <div className="border-l border-black h-6 hidden sm:block"></div>
            <div className="flex items-center gap-1.5 bg-brand-sage/60 px-2 py-1 border border-black font-mono text-xs">
              <Building size={14} className="text-black" />
              <span>EMPRESA: </span>
              <span className="font-bold text-black select-all">
                {tenant ? `${tenant.name} (${tenant.slug})` : usuario?.rol === 'superadmin' ? 'Sin empresa — Super Admin' : 'Sin empresa'}
              </span>
            </div>

            {/* SUPER ADMIN: solo visible (y togglable) para usuarios con ese rol real — no es un disfraz para cualquiera. */}
            {usuario?.rol === 'superadmin' && (
              <button
                onClick={() => setSuperAdminMode(!superAdminMode)}
                className={`font-mono text-xs border-2 border-black font-bold px-2 py-0.5 shadow-sm active:translate-y-0.5 active:shadow-none transition-all flex items-center gap-1 ${
                  superAdminMode ? 'bg-black text-white' : 'bg-brand-yellow text-black'
                }`}
              >
                <ShieldCheck size={12} />
                <span>{superAdminMode ? 'SUPER ADMIN: ON' : 'SUPER ADMIN'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="text-right hidden md:block">
              <div className="font-bold text-black flex items-center gap-1.5 justify-end">
                <span className="w-2 h-2 bg-green-600 rounded-full inline-block animate-pulse"></span>
                <span>{tenant ? `PLAN ${tenant.plan.toUpperCase()}` : usuario?.rol === 'superadmin' ? 'CONSOLA SUPER ADMIN' : 'SIN PLAN'}</span>
              </div>
              <span className="text-neutral-500 font-medium">{usuario?.email ?? ''}</span>
            </div>

            <button
              onClick={() => void logout()}
              className="border-2 border-black bg-white hover:bg-neutral-100 font-bold px-3 py-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
            >
              Cerrar Sesión
            </button>
          </div>
        </header>

        {/* CONTENEDOR DE CONTENIDO (Sidebar + Workspace + Technical Pane) */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
          
          {/* COLUMNA 1: SIDEBAR */}
          <aside className="w-full lg:w-64 border-b-2 lg:border-b-0 lg:border-r-2 border-black bg-white flex flex-row lg:flex-col justify-start shrink-0 z-10 overflow-x-auto lg:overflow-x-visible">
            <nav className="flex lg:flex-col w-full p-2 lg:p-4 gap-1.5 shrink-0">
              
              <button
                onClick={() => { setActiveTab('dashboard'); setSuperAdminMode(false); }}
                className={`w-full text-left font-mono font-bold text-sm px-3 py-2.5 flex items-center gap-3 border-2 border-transparent hover:border-black active:bg-neutral-50 ${
                  activeTab === 'dashboard' && !superAdminMode ? 'bg-brand-blue text-white border-black' : 'text-black'
                }`}
              >
                <LayoutDashboard size={18} />
                <span>Dashboard</span>
              </button>

              <button
                onClick={() => { setActiveTab('inventario'); setSuperAdminMode(false); }}
                className={`w-full text-left font-mono font-bold text-sm px-3 py-2.5 flex items-center gap-3 border-2 border-transparent hover:border-black active:bg-neutral-50 ${
                  activeTab === 'inventario' && !superAdminMode ? 'bg-brand-blue text-white border-black' : 'text-black'
                }`}
              >
                <Boxes size={18} />
                <span>Inventario</span>
                {criticalProducts.length > 0 && (
                  <span className="bg-brand-red text-white text-[10px] px-1.5 py-0.5 rounded font-sans ml-auto">
                    {criticalProducts.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => { setActiveTab('pedidos'); setSuperAdminMode(false); }}
                className={`w-full text-left font-mono font-bold text-sm px-3 py-2.5 flex items-center gap-3 border-2 border-transparent hover:border-black active:bg-neutral-50 ${
                  activeTab === 'pedidos' && !superAdminMode ? 'bg-brand-blue text-white border-black' : 'text-black'
                }`}
              >
                <ClipboardList size={18} />
                <span>Pedidos y Envíos</span>
                <span className="bg-brand-blue text-white text-[10px] px-1.5 py-0.5 rounded font-sans ml-auto">
                  {orders.filter(o => ['confirmado', 'en_preparacion', 'despachado'].includes(o.estado)).length}
                </span>
              </button>

              <button
                onClick={() => { setActiveTab('finanzas'); setSuperAdminMode(false); }}
                className={`w-full text-left font-mono font-bold text-sm px-3 py-2.5 flex items-center gap-3 border-2 border-transparent hover:border-black active:bg-neutral-50 ${
                  activeTab === 'finanzas' && !superAdminMode ? 'bg-brand-blue text-white border-black' : 'text-black'
                }`}
              >
                <DollarSign size={18} />
                <span>Finanzas y Concil.</span>
              </button>

              <button
                onClick={() => { setActiveTab('crm'); setSuperAdminMode(false); }}
                className={`w-full text-left font-mono font-bold text-sm px-3 py-2.5 flex items-center gap-3 border-2 border-transparent hover:border-black active:bg-neutral-50 ${
                  activeTab === 'crm' && !superAdminMode ? 'bg-brand-blue text-white border-black' : 'text-black'
                }`}
              >
                <Users size={18} />
                <span>Clientes (CRM)</span>
              </button>

              <button
                onClick={() => { setActiveTab('comunicaciones'); setSuperAdminMode(false); }}
                className={`w-full text-left font-mono font-bold text-sm px-3 py-2.5 flex items-center gap-3 border-2 border-transparent hover:border-black active:bg-neutral-50 ${
                  activeTab === 'comunicaciones' && !superAdminMode ? 'bg-brand-blue text-white border-black' : 'text-black'
                }`}
              >
                <MessageCircle size={18} />
                <span>Comunicaciones</span>
              </button>

              <button
                onClick={() => { setActiveTab('config'); setSuperAdminMode(false); }}
                className={`w-full text-left font-mono font-bold text-sm px-3 py-2.5 flex items-center gap-3 border-2 border-transparent hover:border-black active:bg-neutral-50 ${
                  activeTab === 'config' && !superAdminMode ? 'bg-brand-blue text-white border-black' : 'text-black'
                }`}
              >
                <Settings size={18} />
                <span>Suscripción</span>
              </button>
            </nav>

            <div className="p-4 border-t border-black hidden lg:block">
              <button
                onClick={() => { void fetchPapelera(); setShowPapelera(true); }}
                className="w-full text-left font-mono text-xs font-bold px-3 py-2 flex items-center gap-2 border-2 border-dashed border-neutral-300 hover:border-black text-neutral-500 hover:text-black transition-colors"
              >
                <Trash2 size={14} />
                <span>Papelera</span>
              </button>
            </div>

            <div className="mt-auto p-4 border-t border-black hidden lg:flex flex-col gap-2 font-mono text-[10px]">
              <div className="flex justify-between">
                <span className="text-neutral-500 font-bold">MONEDA:</span>
                <span className="text-black font-extrabold">COP ($)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-bold">PAÍS:</span>
                <span className="text-black font-extrabold">COLOMBIA</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500 font-bold">WIDGETS:</span>
                <span className="text-green-600 font-extrabold">ONLINE</span>
              </div>
            </div>
          </aside>

          {/* COLUMNA 2: ESPACIO DE TRABAJO CENTRAL */}
          <section className="flex-1 p-4 md:p-6 overflow-y-auto bg-neutral-50/50 flex flex-col gap-6">

            {/* --- MODO SUPER ADMIN --- */}
            {superAdminMode ? (
              <div className="flex flex-col gap-6">
                <div className="neo-card bg-brand-yellow/30 border-brand-yellow">
                  <h2 className="font-mono text-lg font-bold flex items-center gap-2 text-black mb-1">
                    <ShieldCheck size={20} className="text-brand-yellow" />
                    CONSOLA SUPER ADMIN (Métricas SaaS Globales)
                  </h2>
                  <p className="text-sm text-neutral-700 leading-relaxed">
                    Panel operativo global de Antigravity. Como administrador de la plataforma, puedes monitorear todos los tenants activos, evaluar límites de base de datos y controlar la facturación consolidada.
                  </p>
                </div>

                {/* Métricas consolidadas */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="neo-card flex flex-col bg-white">
                    <span className="font-mono text-[10px] text-neutral-500 font-bold">TENANTS TOTALES</span>
                    <span className="text-2xl font-black text-black tracking-tight">{TENANTS_GLOBAL_METRICS.totalTenants}</span>
                    <span className="text-[10px] text-green-600 mt-1 font-bold">✓ {TENANTS_GLOBAL_METRICS.activeTenants} activos en red</span>
                  </div>

                  <div className="neo-card flex flex-col bg-white">
                    <span className="font-mono text-[10px] text-neutral-500 font-bold">RECURRING REVENUE (MRR)</span>
                    <span className="text-2xl font-black text-black tracking-tight">
                      ${TENANTS_GLOBAL_METRICS.monthlyRecurringRevenueCop.toLocaleString('es-CO')} COP
                    </span>
                    <span className="text-[10px] text-neutral-500 mt-1 font-bold">Wompi Recurrente mensual</span>
                  </div>

                  <div className="neo-card flex flex-col bg-white">
                    <span className="font-mono text-[10px] text-neutral-500 font-bold">USO ALMACENAMIENTO BD</span>
                    <span className="text-2xl font-black text-black tracking-tight">{TENANTS_GLOBAL_METRICS.databaseStorageUsed}</span>
                    <span className="text-[10px] text-neutral-500 mt-1 font-bold">Postgres centralizado</span>
                  </div>

                  <div className="neo-card flex flex-col bg-white">
                    <span className="font-mono text-[10px] text-neutral-500 font-bold">CARGA DEL SISTEMA (AWS)</span>
                    <span className="text-2xl font-black text-green-600 tracking-tight">{TENANTS_GLOBAL_METRICS.systemLoad}</span>
                    <span className="text-[10px] text-green-600 mt-1 font-bold">Salud del cluster: Excelente</span>
                  </div>
                </div>

                {/* Distribución de Planes */}
                <div className="neo-card bg-white">
                  <h3 className="font-mono text-sm font-bold border-b-2 border-black pb-2 mb-4">DISTRIBUCIÓN DE PLANES DE CLIENTES</h3>
                  <div className="flex flex-col gap-3 font-mono">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>PLAN BÁSICO (COP $79.000/mes)</span>
                        <span className="font-bold">{TENANTS_GLOBAL_METRICS.planDistribution.basico} empresas ({Math.round(TENANTS_GLOBAL_METRICS.planDistribution.basico / TENANTS_GLOBAL_METRICS.totalTenants * 100)}%)</span>
                      </div>
                      <div className="w-full bg-neutral-100 border border-black h-4">
                        <div className="bg-brand-blue border-r border-black h-full" style={{ width: `${TENANTS_GLOBAL_METRICS.planDistribution.basico / TENANTS_GLOBAL_METRICS.totalTenants * 100}%` }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>PLAN PROFESIONAL (COP $189.000/mes)</span>
                        <span className="font-bold">{TENANTS_GLOBAL_METRICS.planDistribution.profesional} empresas ({Math.round(TENANTS_GLOBAL_METRICS.planDistribution.profesional / TENANTS_GLOBAL_METRICS.totalTenants * 100)}%)</span>
                      </div>
                      <div className="w-full bg-neutral-100 border border-black h-4">
                        <div className="bg-brand-red border-r border-black h-full" style={{ width: `${TENANTS_GLOBAL_METRICS.planDistribution.profesional / TENANTS_GLOBAL_METRICS.totalTenants * 100}%` }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>PLAN EMPRESARIAL (COP $390.000/mes)</span>
                        <span className="font-bold">{TENANTS_GLOBAL_METRICS.planDistribution.empresarial} empresas ({Math.round(TENANTS_GLOBAL_METRICS.planDistribution.empresarial / TENANTS_GLOBAL_METRICS.totalTenants * 100)}%)</span>
                      </div>
                      <div className="w-full bg-neutral-100 border border-black h-4">
                        <div className="bg-black h-full" style={{ width: `${TENANTS_GLOBAL_METRICS.planDistribution.empresarial / TENANTS_GLOBAL_METRICS.totalTenants * 100}%` }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // --- MÓDULOS DE NEGOCIO ---
              <>
                {/* --- DASHBOARD TAB --- */}
                {activeTab === 'dashboard' && (
                  <div className="flex flex-col gap-6">
                    {/* Alerta de Stock Crítico */}
                    {criticalProducts.length > 0 && (
                      <div className="border-2 border-black bg-brand-red text-white p-4 flex items-center justify-between shadow-red animate-pulse">
                        <div className="flex items-center gap-3">
                          <AlertTriangle size={24} />
                          <div>
                            <h4 className="font-bold text-sm">ALERTA: STOCK CRÍTICO DETECTADO</h4>
                            <p className="text-xs opacity-90">
                              Hay {criticalProducts.length} productos con niveles de inventario por debajo del mínimo establecido.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setActiveTab('inventario')}
                          className="border border-white hover:bg-white/20 px-3 py-1 font-mono text-xs font-bold"
                        >
                          Ver Productos
                        </button>
                      </div>
                    )}

                    {/* Fila de Tarjetas Resumen */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                      
                      <div className="neo-card bg-white relative overflow-hidden">
                        <span className="font-mono text-[10px] text-neutral-500 font-bold">VENTAS DEL DÍA</span>
                        <span className="text-2xl font-black text-black tracking-tight">${ventasMetrics.totalDia.toLocaleString('es-CO')} COP</span>
                        <div className="flex items-center gap-1 text-[10px] text-green-600 font-bold mt-1">
                          <TrendingUp size={12} />
                          <span>{ventasMetrics.countDia} {ventasMetrics.countDia === 1 ? 'pedido' : 'pedidos'} hoy</span>
                        </div>
                      </div>

                      <div className="neo-card bg-white">
                        <span className="font-mono text-[10px] text-neutral-500 font-bold">VENTAS DEL MES</span>
                        <span className="text-2xl font-black text-black tracking-tight">${ventasMetrics.totalMes.toLocaleString('es-CO')} COP</span>
                        <div className="flex items-center gap-1 text-[10px] text-green-600 font-bold mt-1">
                          <TrendingUp size={12} />
                          <span>{ventasMetrics.countMes} {ventasMetrics.countMes === 1 ? 'pedido' : 'pedidos'} este mes</span>
                        </div>
                      </div>

                      <div className="neo-card bg-white">
                        <span className="font-mono text-[10px] text-neutral-500 font-bold">CUENTAS POR COBRAR (CxC)</span>
                        <span className="text-2xl font-black text-brand-red tracking-tight">
                          ${financialMetrics.totalCxC.toLocaleString('es-CO')} COP
                        </span>
                        <div className="text-[10px] text-brand-red font-bold mt-1">
                          <span>${financialMetrics.vencidoCxC.toLocaleString('es-CO')} vencido</span>
                        </div>
                      </div>

                      <div className="neo-card bg-white">
                        <span className="font-mono text-[10px] text-neutral-500 font-bold">EFECTIVO EN BANCOS</span>
                        <span className="text-2xl font-black text-brand-blue tracking-tight">
                          ${totalEnBancos.toLocaleString('es-CO')} COP
                        </span>
                        <div className="text-[10px] text-neutral-500 font-bold mt-1">
                          <span>{bankAccounts.length} {bankAccounts.length === 1 ? 'cuenta vinculada' : 'cuentas vinculadas'}</span>
                        </div>
                      </div>

                    </div>

                    {/* ─── ACCIONES RÁPIDAS ─── */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <button
                        onClick={() => setShowCreateOrder(true)}
                        className="border-2 border-black bg-black text-white font-mono font-bold text-sm py-3 px-4 flex items-center justify-center gap-2 hover:bg-neutral-800 active:translate-y-0.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.4)]"
                      >
                        <ClipboardList size={16} />
                        Hacer Pedido
                      </button>
                      <button
                        onClick={() => { setActiveTab('finanzas'); setFinanceSubTab('cxc'); setShowCreateAbono(true); }}
                        className="border-2 border-black bg-brand-blue text-white font-mono font-bold text-sm py-3 px-4 flex items-center justify-center gap-2 hover:opacity-90 active:translate-y-0.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]"
                      >
                        <DollarSign size={16} />
                        Agregar Abono
                      </button>
                      <button
                        onClick={() => setShowGastoModal(true)}
                        style={{ backgroundColor: adjustColor(colorSecundarioInput, -40) }}
                        className="border-2 border-black text-white font-mono font-bold text-sm py-3 px-4 flex items-center justify-center gap-2 hover:opacity-90 active:translate-y-0.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]"
                      >
                        <FileSpreadsheet size={16} />
                        Registrar Gasto
                      </button>
                      <button
                        onClick={() => setShowTransferenciaModal(true)}
                        style={{ backgroundColor: adjustColor(colorSecundarioInput, 60) }}
                        className="border-2 border-black text-black font-mono font-bold text-sm py-3 px-4 flex items-center justify-center gap-2 hover:opacity-90 active:translate-y-0.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]"
                      >
                        <TrendingUp size={16} />
                        Transferencia
                      </button>
                    </div>

                    {/* Sección Gráficos e Historial */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                      {/* Vista de los próximos 7 días — eventos del módulo de Comunicaciones */}
                      <div className="neo-card bg-white lg:col-span-2 flex flex-col gap-4">
                        <div className="flex justify-between items-center border-b border-black pb-3">
                          <div className="flex items-center gap-2">
                            <CalendarDays size={18} className="text-brand-blue shrink-0" />
                            <div>
                              <h3 className="font-mono text-sm font-bold">PRÓXIMOS 7 DÍAS</h3>
                              <p className="text-[11px] text-neutral-500">Notas, recordatorios y posts planeados — módulo de Comunicaciones</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDashboardWeekOffset((o) => o - 7)}
                              className="neo-btn p-1.5 hover:bg-neutral-100"
                              title="7 días atrás"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            {dashboardWeekOffset !== 0 && (
                              <button
                                type="button"
                                onClick={() => setDashboardWeekOffset(0)}
                                className="font-mono text-[10px] font-bold border-[1.5px] border-black px-2 py-1 hover:bg-neutral-100"
                                title="Volver a hoy"
                              >
                                HOY
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDashboardWeekOffset((o) => o + 7)}
                              className="neo-btn p-1.5 hover:bg-neutral-100"
                              title="7 días adelante"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const dias = Array.from({ length: 7 }, (_, i) => {
                            const d = new Date();
                            d.setHours(0, 0, 0, 0);
                            d.setDate(d.getDate() + dashboardWeekOffset + i);
                            return d;
                          });
                          const hoy = new Date();
                          hoy.setHours(0, 0, 0, 0);

                          return (
                            <div className="flex flex-col gap-2">
                              {dias.map((dia) => {
                                const eventosDelDia = calendarEvents.filter((ev) => {
                                  const f = new Date(ev.fecha);
                                  return f.getFullYear() === dia.getFullYear() && f.getMonth() === dia.getMonth() && f.getDate() === dia.getDate();
                                });
                                const esHoy = dia.getTime() === hoy.getTime();

                                return (
                                  <div key={dia.toISOString()} className={`border border-black flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 ${esHoy ? 'bg-brand-yellow/15' : 'bg-neutral-50'}`}>
                                    <div className="font-mono text-[11px] font-bold text-black sm:w-32 shrink-0 flex items-center gap-1.5">
                                      {esHoy && <span className="bg-brand-yellow/40 border border-black px-1 text-[9px]">HOY</span>}
                                      <span className="capitalize">{dia.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                                    </div>
                                    <div className="flex-1 flex flex-wrap gap-1.5">
                                      {eventosDelDia.length === 0 ? (
                                        <span className="text-[10px] text-neutral-400 italic font-mono">Sin eventos</span>
                                      ) : (
                                        eventosDelDia.map((ev) => (
                                          <span
                                            key={ev.id}
                                            className={`inline-flex items-center gap-1 border-[1.5px] border-black text-[9px] font-mono font-bold px-1.5 py-0.5 ${
                                              ev.tipo === 'nota' ? 'bg-brand-yellow/30' :
                                              ev.tipo === 'recordatorio' ? 'bg-brand-blue/20' :
                                              'bg-brand-red/15'
                                            } ${(ev.estado === 'hecho' || ev.estado === 'subido') ? 'opacity-50 line-through' : ''}`}
                                          >
                                            {ev.tipo === 'post' && ev.canal === 'instagram' && <Instagram size={10} />}
                                            {ev.tipo === 'post' && ev.canal === 'facebook' && <Facebook size={10} />}
                                            {ev.tipo === 'post' && ev.canal === 'tiktok' && <TikTokIcon size={10} />}
                                            <span>{ev.titulo}</span>
                                            <span className={`text-[8px] font-mono opacity-70 ${
                                              ev.estado === 'subido' ? 'text-green-700' :
                                              ev.estado === 'editado' ? 'text-amber-700' :
                                              ev.estado === 'grabado' ? 'text-orange-600' : ''
                                            }`}>{ev.estado !== 'pendiente' && ev.estado !== 'idea' ? `· ${ev.estado}` : ''}</span>
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        <button
                          onClick={() => setActiveTab('comunicaciones')}
                          className="neo-btn self-start text-[11px] px-3 py-1.5 hover:bg-neutral-100"
                        >
                          Ver módulo de Comunicaciones →
                        </button>
                      </div>

                      {/* Panel derecho: Slider automático — Alertas / Pedidos por entregar / CxC */}
                      {(() => {
                        const slideLabels = ['ALERTAS', 'POR ENTREGAR', 'CUENTAS × COBRAR'];
                        const pedidosPorEntregar = orders.filter((o) =>
                          ['confirmado', 'en_preparacion', 'despachado'].includes(o.estado)
                        );
                        const cxcPendientes = invoices
                          .filter((i) => i.tipo === 'cxc' && i.saldo_pendiente > 0)
                          .sort((a, b) => b.saldo_pendiente - a.saldo_pendiente);
                        const estadoColorPedido: Record<string, string> = {
                          confirmado: 'bg-blue-100 text-blue-800',
                          en_preparacion: 'bg-yellow-100 text-yellow-800',
                          despachado: 'bg-brand-blue/20 text-brand-blue',
                        };

                        return (
                          <div className="neo-card bg-white flex flex-col gap-0 overflow-hidden">
                            {/* Cabecera con indicadores */}
                            <div className="flex items-center justify-between border-b border-black px-4 py-2.5">
                              <h3 className="font-mono text-sm font-bold">{slideLabels[dashboardSlide]}</h3>
                              <div className="flex items-center gap-2">
                                {slideLabels.map((_, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => setDashboardSlide(i)}
                                    className={`w-2 h-2 rounded-full border border-black transition-all ${dashboardSlide === i ? 'bg-black scale-125' : 'bg-neutral-300 hover:bg-neutral-400'}`}
                                  />
                                ))}
                              </div>
                            </div>

                            {/* Barra de progreso 10s */}
                            <div className="h-0.5 bg-neutral-100 relative overflow-hidden">
                              <div
                                key={dashboardSlide}
                                className="absolute inset-y-0 left-0 bg-black"
                                style={{ animation: 'slideProgress 10s linear forwards' }}
                              />
                            </div>

                            {/* Slide 0: Alertas */}
                            <div className={`flex flex-col gap-2 px-4 py-3 transition-all duration-300 ${dashboardSlide === 0 ? 'block' : 'hidden'}`}>
                              {criticalProducts.length === 0 && facturasVencidas.length === 0 ? (
                                <p className="text-xs text-neutral-400 italic font-mono py-4 text-center">✓ Sin alertas activas — todo en orden.</p>
                              ) : (
                                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                                  {criticalProducts.map((p) => {
                                    const stock = productStocks[p.id] ?? 0;
                                    return (
                                      <div key={p.id} className="border border-black p-2 bg-brand-red/10 flex gap-2 text-xs">
                                        <AlertTriangle size={14} className="text-brand-red shrink-0 mt-0.5" />
                                        <div>
                                          <span className="font-bold text-black">Stock crítico: </span>
                                          {p.nombre} — {stock} uds (mín. {p.stock_minimo})
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {facturasVencidas.map((inv) => {
                                    const cliente = customers.find((c) => c.id === inv.cliente_id);
                                    const diasVencida = Math.floor((Date.now() - new Date(inv.fecha_vencimiento).getTime()) / 86400000);
                                    return (
                                      <div key={inv.id} className="border border-black p-2 bg-brand-yellow/10 flex gap-2 text-xs">
                                        <ClockAlert size={14} className="text-brand-yellow shrink-0 mt-0.5" />
                                        <div>
                                          <span className="font-bold text-black">Factura vencida: </span>
                                          {inv.numero}{cliente ? ` — ${cliente.nombre}` : ''} · ${inv.saldo_pendiente.toLocaleString('es-CO')} · {diasVencida}d mora
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="text-[9px] font-mono text-neutral-400 text-right mt-1">
                                {criticalProducts.length + facturasVencidas.length} alerta{criticalProducts.length + facturasVencidas.length !== 1 ? 's' : ''}
                              </div>
                            </div>

                            {/* Slide 1: Pedidos por entregar */}
                            <div className={`flex flex-col gap-2 px-4 py-3 transition-all duration-300 ${dashboardSlide === 1 ? 'block' : 'hidden'}`}>
                              {pedidosPorEntregar.length === 0 ? (
                                <p className="text-xs text-neutral-400 italic font-mono py-4 text-center">Sin pedidos pendientes de entrega.</p>
                              ) : (
                                <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
                                  {pedidosPorEntregar
                                    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
                                    .map((ord) => {
                                      const cliente = customers.find((c) => c.id === ord.cliente_id);
                                      return (
                                        <button
                                          key={ord.id}
                                          type="button"
                                          onClick={() => { setActiveTab('pedidos'); }}
                                          className="border border-black p-2 bg-neutral-50 hover:bg-neutral-100 flex items-center justify-between gap-2 text-xs text-left"
                                        >
                                          <div className="flex flex-col gap-0.5 min-w-0">
                                            <span className="font-bold text-black font-mono truncate">{ord.numero}</span>
                                            <span className="text-neutral-600 truncate">{cliente?.nombre ?? 'Sin cliente'}</span>
                                          </div>
                                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                                            <span className="font-bold text-black">${ord.total.toLocaleString('es-CO')}</span>
                                            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm border border-black ${estadoColorPedido[ord.estado] ?? ''}`}>
                                              {ord.estado.replace('_', ' ').toUpperCase()}
                                            </span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                </div>
                              )}
                              <div className="text-[9px] font-mono text-neutral-400 text-right mt-1">
                                {pedidosPorEntregar.length} pedido{pedidosPorEntregar.length !== 1 ? 's' : ''} activo{pedidosPorEntregar.length !== 1 ? 's' : ''}
                              </div>
                            </div>

                            {/* Slide 2: Cuentas por cobrar */}
                            <div className={`flex flex-col gap-2 px-4 py-3 transition-all duration-300 ${dashboardSlide === 2 ? 'block' : 'hidden'}`}>
                              {cxcPendientes.length === 0 ? (
                                <p className="text-xs text-neutral-400 italic font-mono py-4 text-center">Sin cuentas por cobrar pendientes.</p>
                              ) : (
                                <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
                                  {cxcPendientes.map((inv) => {
                                    const cliente = customers.find((c) => c.id === inv.cliente_id);
                                    const vencida = inv.estado === 'vencida';
                                    return (
                                      <button
                                        key={inv.id}
                                        type="button"
                                        onClick={() => { setActiveTab('finanzas'); setFinanceSubTab('cxc'); }}
                                        className={`border border-black p-2 flex items-center justify-between gap-2 text-xs text-left hover:bg-neutral-50 ${vencida ? 'bg-brand-red/8' : 'bg-neutral-50'}`}
                                      >
                                        <div className="flex flex-col gap-0.5 min-w-0">
                                          <span className="font-bold text-black font-mono truncate">{inv.numero}</span>
                                          <span className="text-neutral-600 truncate">{cliente?.nombre ?? 'Sin cliente'}</span>
                                        </div>
                                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                                          <span className={`font-bold ${vencida ? 'text-brand-red' : 'text-black'}`}>
                                            ${inv.saldo_pendiente.toLocaleString('es-CO')}
                                          </span>
                                          {vencida && <span className="text-[9px] font-mono text-brand-red font-bold">VENCIDA</span>}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="text-[9px] font-mono text-neutral-400 text-right mt-1">
                                Total: ${cxcPendientes.reduce((s, i) => s + i.saldo_pendiente, 0).toLocaleString('es-CO')} COP
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* --- INVENTARIO TAB --- */}
                {activeTab === 'inventario' && (
                  <div className="flex flex-col gap-4">

                    {inventarioCargando && (
                      <div className="bg-white border-2 border-black p-3 text-xs font-mono text-neutral-500">
                        Cargando inventario desde el servidor...
                      </div>
                    )}
                    {inventarioError && (
                      <div className="bg-red-50 border-2 border-red-600 text-red-700 p-3 text-xs font-mono flex items-center justify-between gap-3">
                        <span>{inventarioError}</span>
                        <button
                          type="button"
                          onClick={() => void fetchInventario()}
                          className="neo-button text-[11px] px-2 py-1"
                        >
                          Reintentar
                        </button>
                      </div>
                    )}

                    {/* Botones de acción y filtros */}
                    <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white border-2 border-black p-3">
                      
                      <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                        <div className="relative flex-1 sm:flex-initial">
                          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                          <input
                            type="text"
                            placeholder="Buscar por nombre..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="neo-input pl-9 text-xs w-full sm:w-60"
                          />
                        </div>

                        <select
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          className="neo-input text-xs font-mono py-2"
                        >
                          <option value="all">Todas las Categorías</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.nombre}</option>
                          ))}
                        </select>

                        <select
                          value={stockFilter}
                          onChange={(e) => setStockFilter(e.target.value as 'all' | 'critical' | 'instock')}
                          className="neo-input text-xs font-mono py-2"
                        >
                          <option value="all">Ver Todos los Stocks</option>
                          <option value="critical">Stock Crítico (≤ mínimo)</option>
                          <option value="instock">Con Stock Disponible</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                        <button
                          onClick={() => { setCategoryAdminError(null); setAdminCategoryName(''); setEditingCategoryId(null); setShowCategoryAdmin(true); }}
                          className="neo-btn bg-white hover:bg-neutral-50 text-xs py-2 w-full sm:w-auto flex items-center justify-center gap-1.5"
                        >
                          <Tag size={14} />
                          <span>Administrar Categorías</span>
                        </button>
                        <button
                          onClick={() => { setImportStep(1); setImportLogs([]); setImportProgress(0); setShowImportExcel(true); }}
                          className="neo-btn bg-white hover:bg-neutral-50 text-xs py-2 w-full sm:w-auto flex items-center justify-center gap-1.5"
                        >
                          <FileSpreadsheet size={14} />
                          <span>Importar Excel</span>
                        </button>
                        <button
                          onClick={() => setShowCreateProduct(true)}
                          className="neo-btn-primary text-xs py-2 w-full sm:w-auto flex items-center justify-center gap-1.5"
                        >
                          <Plus size={14} />
                          <span>Nuevo Producto</span>
                        </button>
                      </div>

                    </div>

                    {/* Tabla de Productos */}
                    <div className="neo-card bg-white p-0 overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold text-black">
                            <th className="p-3">PRODUCTO</th>
                            <th className="p-3 text-right">COSTO</th>
                            <th className="p-3 text-right">VENTA BASE</th>
                            <th className="p-3 text-center">ST. MÍNIMO</th>
                            <th className="p-3 text-center">DISPONIBLE</th>
                            <th className="p-3 text-center">ESTADO</th>
                            <th className="p-3 text-center">ACCIONES</th>
                          </tr>
                        </thead>
                        {(() => {
                          const visibles = products.filter((p) => {
                            const matchSearch = p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
                            const matchCat = categoryFilter === 'all' || p.categoria_id === categoryFilter;

                            const stockVal = productStocks[p.id] ?? 0;
                            let matchStock = true;
                            if (stockFilter === 'critical') {
                              matchStock = stockVal <= p.stock_minimo;
                            } else if (stockFilter === 'instock') {
                              matchStock = stockVal > 0;
                            }

                            return matchSearch && matchCat && matchStock;
                          });

                          // Agrupamos por categoría (orden alfabético; "Sin categoría" siempre al final)
                          // así la tabla refleja la organización del inventario en vez de una lista plana.
                          const SIN_CATEGORIA = '__sin_categoria__';
                          const grupos = new Map<string, { nombre: string; productos: typeof visibles }>();
                          for (const p of visibles) {
                            const cat = categories.find((c) => c.id === p.categoria_id);
                            const key = cat?.id ?? SIN_CATEGORIA;
                            if (!grupos.has(key)) grupos.set(key, { nombre: cat?.nombre ?? 'Sin categoría', productos: [] });
                            grupos.get(key)!.productos.push(p);
                          }
                          const gruposOrdenados = [...grupos.entries()].sort(([keyA, a], [keyB, b]) => {
                            if (keyA === SIN_CATEGORIA) return 1;
                            if (keyB === SIN_CATEGORIA) return -1;
                            return a.nombre.localeCompare(b.nombre);
                          });

                          if (gruposOrdenados.length === 0) {
                            return (
                              <tbody>
                                <tr>
                                  <td colSpan={7} className="p-6 text-center text-neutral-400 font-mono text-xs">
                                    No hay productos que coincidan con los filtros actuales.
                                  </td>
                                </tr>
                              </tbody>
                            );
                          }

                          return gruposOrdenados.map(([key, grupo]) => (
                            <tbody key={key}>
                              <tr className="bg-brand-sage/40 border-y border-black">
                                <td colSpan={7} className="px-3 py-1.5 font-mono font-bold text-[11px] uppercase tracking-wide text-black flex items-center gap-2">
                                  <Tag size={12} />
                                  <span>{grupo.nombre}</span>
                                  <span className="text-neutral-500 font-normal normal-case">({grupo.productos.length} {grupo.productos.length === 1 ? 'producto' : 'productos'})</span>
                                </td>
                              </tr>
                              {grupo.productos.map((p) => {
                                const stock = productStocks[p.id] ?? 0;
                                const isCrit = stock <= p.stock_minimo;

                                return (
                                  <tr key={p.id} className="border-b border-neutral-200 hover:bg-neutral-50/50">
                                    <td className="p-3 font-semibold text-black">
                                      <div>{p.nombre}</div>
                                      <div className="text-[10px] text-neutral-500 font-normal mt-0.5">{p.descripcion}</div>
                                    </td>
                                    <td className="p-3 text-right font-mono text-neutral-600">${p.precio_costo.toLocaleString('es-CO')}</td>
                                    <td className="p-3 text-right font-mono text-black font-semibold">${p.precio_venta.toLocaleString('es-CO')}</td>
                                    <td className="p-3 text-center font-mono text-neutral-600">{p.stock_minimo}</td>
                                    <td className="p-3 text-center font-mono font-extrabold text-black">{stock}</td>
                                    <td className="p-3 text-center">
                                      <span className={`inline-block border text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                                        isCrit
                                          ? 'bg-brand-red text-white border-black'
                                          : 'bg-green-100 text-green-800 border-green-400'
                                      }`}>
                                        {isCrit ? 'CRÍTICO' : 'NORMAL'}
                                      </span>
                                    </td>
                                    <td className="p-3 text-center">
                                      <div className="flex items-center justify-center gap-1.5">
                                        <button type="button" onClick={() => openStockEntry(p)} className="neo-btn p-1.5 hover:bg-emerald-50 hover:text-emerald-700" title="Registrar entrada de stock">
                                          <PackagePlus size={12} />
                                        </button>
                                        <button type="button" onClick={() => openEditProduct(p)} className="neo-btn p-1.5 hover:bg-neutral-100" title="Editar producto">
                                          <Pencil size={12} />
                                        </button>
                                        <button type="button" onClick={() => void handleDeleteProduct(p)} className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red" title="Eliminar producto">
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          ));
                        })()}
                      </table>
                    </div>

                    {/* Historial de Movimientos Recientes */}
                    <div className="neo-card bg-white">
                      <h3 className="font-mono text-sm font-bold border-b border-black pb-2 mb-3">HISTORIAL TRANSACCIONAL DE INVENTARIO (Últimos Movimientos)</h3>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {movements.map((mov) => {
                          const prod = products.find(p => p.id === mov.producto_id);
                          const isEntry = ['entrada_compra', 'entrada_devolucion', 'ajuste_positivo', 'liberacion_reserva'].includes(mov.tipo);
                          
                          return (
                            <div key={mov.id} className="border border-neutral-300 p-2 flex items-center justify-between text-xs hover:bg-neutral-50">
                              <div className="flex items-center gap-3">
                                <span className={`w-8 text-center font-mono font-bold py-0.5 border ${
                                  isEntry ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700'
                                }`}>
                                  {isEntry ? `+${mov.cantidad}` : `-${mov.cantidad}`}
                                </span>
                                <div>
                                  <div className="font-bold text-black">{prod?.nombre}</div>
                                  <div className="text-[10px] text-neutral-600 mt-0.5">{mov.detalle}</div>
                                </div>
                              </div>
                              <span className="font-mono text-[10px] text-neutral-500">
                                {new Date(mov.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                )}

                {/* --- PEDIDOS TAB --- */}
                {activeTab === 'pedidos' && (
                  <div className="flex flex-col gap-4">

                    {pedidosCargando && (
                      <div className="bg-white border-2 border-black p-3 text-xs font-mono text-neutral-500">
                        Cargando pedidos desde el servidor...
                      </div>
                    )}
                    {pedidosError && (
                      <div className="bg-red-50 border-2 border-red-600 text-red-700 p-3 text-xs font-mono flex items-center justify-between gap-3">
                        <span>{pedidosError}</span>
                        <button
                          type="button"
                          onClick={() => void fetchPedidos()}
                          className="neo-button text-[11px] px-2 py-1"
                        >
                          Reintentar
                        </button>
                      </div>
                    )}

                    {/* Pedidos sin enviar — prioridad: lo que aún no salió de la
                        bodega es lo más urgente de atender (ordenado del más
                        antiguo al más reciente, así el más viejo aparece primero). */}
                    {(() => {
                      const sinEnviar = orders
                        .filter((o) => o.estado !== 'despachado' && o.estado !== 'entregado' && o.estado !== 'cancelado')
                        .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

                      if (sinEnviar.length === 0) return null;

                      return (
                        <div className="neo-card bg-brand-yellow/15 border-brand-yellow flex flex-col gap-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <h3 className="font-mono text-xs font-bold flex items-center gap-2 text-black">
                              <AlertTriangle size={14} className="text-brand-yellow" />
                              PEDIDOS SIN ENVIAR — MÁXIMA PRIORIDAD ({sinEnviar.length})
                            </h3>
                            <span className="text-[10px] font-mono text-neutral-600">Ordenados del más antiguo al más reciente</span>
                          </div>
                          <div className="space-y-2">
                            {sinEnviar.map((ord) => {
                              const dias = Math.max(0, Math.floor((Date.now() - new Date(ord.fecha).getTime()) / (1000 * 60 * 60 * 24)));
                              return (
                                <div
                                  key={ord.id}
                                  className="bg-white border border-black p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="font-bold text-black">{getOrderDisplayName(ord)}</span>
                                    <span className="font-mono text-[10px] text-neutral-400">{ord.numero}</span>
                                    <span className={`inline-block border-[1.5px] border-black text-[9px] font-mono font-bold px-1.5 py-0.5 ${
                                      ord.estado === 'borrador' ? 'bg-neutral-100 text-neutral-700' :
                                      ord.estado === 'confirmado' ? 'bg-brand-blue/20 text-brand-blue' :
                                      'bg-brand-yellow/20 text-neutral-700'
                                    }`}>
                                      {ord.estado.toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className={`font-mono text-[10px] font-bold ${dias >= 3 ? 'text-brand-red' : 'text-neutral-500'}`}>
                                      {dias === 0 ? 'Hoy' : dias === 1 ? 'Hace 1 día' : `Hace ${dias} días`} esperando envío
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => { setOrderManager(ord); setOrderManagerNotas(ord.notas ?? ''); setAbonoForm({ monto: '', medioPago: 'efectivo', referencia: '', cuentaBancariaId: '' }); setAbonoError(null); }}
                                      className="neo-btn px-2 py-0.5 text-[9px] font-mono font-bold hover:bg-brand-blue hover:text-white"
                                    >Gestionar</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Filtros e inserción */}
                    <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white border-2 border-black p-3">

                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <select
                          value={orderStatusFilter}
                          onChange={(e) => setOrderStatusFilter(e.target.value)}
                          className="neo-input text-xs font-mono py-2 w-full sm:w-52"
                        >
                          <option value="all">Ver Todos los Estados</option>
                          <option value="borrador">Borrador</option>
                          <option value="confirmado">Confirmado (Stock Reservado)</option>
                          <option value="en_preparacion">En Preparación</option>
                          <option value="despachado">Despachado</option>
                          <option value="entregado">Entregado (Terminal)</option>
                          <option value="cancelado">Cancelado (Reserva Liberada)</option>
                        </select>

                        {/* Ordenar */}
                        <select
                          value={pedidosOrden}
                          onChange={(e) => setPedidosOrden(e.target.value as typeof pedidosOrden)}
                          className="neo-input text-xs font-mono py-2 w-full sm:w-44"
                        >
                          <option value="fecha_desc">↓ Más reciente</option>
                          <option value="fecha_asc">↑ Más antiguo</option>
                          <option value="total_desc">↓ Mayor total</option>
                          <option value="total_asc">↑ Menor total</option>
                          <option value="estado">Por estado</option>
                          <option value="cliente">Cliente A→Z</option>
                        </select>

                        {/* Toggle Vista Lista / Kanban */}
                        <div className="flex border-2 border-black overflow-hidden shrink-0">
                          <button
                            type="button"
                            onClick={() => setPedidosVista('lista')}
                            className={`font-mono text-[10px] font-bold px-3 py-1.5 ${pedidosVista === 'lista' ? 'bg-black text-white' : 'bg-white text-black hover:bg-neutral-50'}`}
                          >Lista</button>
                          <button
                            type="button"
                            onClick={() => setPedidosVista('kanban')}
                            className={`font-mono text-[10px] font-bold px-3 py-1.5 border-l-2 border-black ${pedidosVista === 'kanban' ? 'bg-black text-white' : 'bg-white text-black hover:bg-neutral-50'}`}
                          >Kanban</button>
                        </div>
                      </div>

                      <button
                        onClick={() => setShowCreateOrder(true)}
                        className="neo-btn-primary text-xs py-2 w-full sm:w-auto flex items-center justify-center gap-1.5 shrink-0"
                      >
                        <Plus size={14} />
                        <span>Crear Pedido</span>
                      </button>

                    </div>

                    {/* Vista Lista de Pedidos */}
                    {pedidosVista === 'lista' && (() => {
                      const estadoClases: Record<string, string> = {
                        borrador: 'bg-neutral-100 border-neutral-300',
                        confirmado: 'bg-blue-50 border-blue-300',
                        en_preparacion: 'bg-yellow-50 border-yellow-300',
                        despachado: 'bg-blue-100 border-blue-400',
                        entregado: 'bg-green-50 border-green-300',
                        cancelado: 'bg-red-50 border-red-300',
                      };

                      const estadoOrdenFlujo: Record<string, number> = {
                        borrador: 0, confirmado: 1, en_preparacion: 2, despachado: 3, entregado: 4, cancelado: 5,
                      };
                      const pedidosFiltrados = orders
                        .filter(ord => orderStatusFilter === 'all' || ord.estado === orderStatusFilter)
                        .sort((a, b) => {
                          switch (pedidosOrden) {
                            case 'fecha_asc': return new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
                            case 'total_desc': return b.total - a.total;
                            case 'total_asc': return a.total - b.total;
                            case 'estado': return (estadoOrdenFlujo[a.estado] ?? 9) - (estadoOrdenFlujo[b.estado] ?? 9);
                            case 'cliente': {
                              const ca = customers.find(c => c.id === a.cliente_id)?.nombre ?? '';
                              const cb = customers.find(c => c.id === b.cliente_id)?.nombre ?? '';
                              return ca.localeCompare(cb, 'es');
                            }
                            default: return new Date(b.fecha).getTime() - new Date(a.fecha).getTime(); // fecha_desc
                          }
                        });

                      // Agrupar por fecha solo cuando el orden es cronológico
                      const agruparPorFecha = pedidosOrden === 'fecha_desc' || pedidosOrden === 'fecha_asc';
                      const porFecha = new Map<string, typeof pedidosFiltrados>();
                      if (agruparPorFecha) {
                        for (const ord of pedidosFiltrados) {
                          const key = ord.fecha.slice(0, 10);
                          const lista = porFecha.get(key) ?? [];
                          lista.push(ord);
                          porFecha.set(key, lista);
                        }
                      }
                      const fechasOrdenadas = agruparPorFecha
                        ? [...porFecha.keys()].sort((a, b) => pedidosOrden === 'fecha_asc' ? a.localeCompare(b) : b.localeCompare(a))
                        : [];
                      // Cuando no agrupamos por fecha usamos un único bucket virtual
                      const gruposFinal = agruparPorFecha ? porFecha : new Map([['__all__', pedidosFiltrados]]);
                      const llavesFinal = agruparPorFecha ? fechasOrdenadas : ['__all__'];

                      if (pedidosFiltrados.length === 0) return (
                        <div className="neo-card bg-white text-center py-12 text-xs text-neutral-400 font-mono italic">
                          No hay pedidos con los filtros actuales.
                        </div>
                      );

                      const todosLosEstados: Order['estado'][] = ['borrador', 'confirmado', 'en_preparacion', 'despachado', 'entregado', 'cancelado'];

                      return (
                        <div className="flex flex-col gap-1">
                          {llavesFinal.map(llave => (
                            <div key={llave}>
                              {/* Separador de fecha (solo en modo cronológico) */}
                              {agruparPorFecha && (
                                <div className="font-mono text-[10px] font-bold text-neutral-400 uppercase tracking-widest px-2 py-1.5 border-b border-neutral-200 bg-neutral-50">
                                  {new Date(llave + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                                </div>
                              )}
                              {(gruposFinal.get(llave) ?? []).map((ord) => {
                                const client = customers.find(c => c.id === ord.cliente_id);
                                const isExpanded = pedidoExpandido === ord.id;

                                return (
                                  <div key={ord.id} className={`border ${estadoClases[ord.estado] ?? 'bg-white border-neutral-300'} mb-1`}>
                                    {/* Row compacto */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-bold text-black truncate">{getOrderDisplayName(ord)}</span>
                                        <span className="font-mono text-[9px] text-neutral-400 shrink-0">{ord.numero}</span>
                                        <span className={`inline-block border border-black text-[9px] font-mono font-bold px-1.5 py-0.5 shrink-0 ${
                                          ord.estado === 'borrador' ? 'bg-neutral-200 text-neutral-700' :
                                          ord.estado === 'confirmado' ? 'bg-blue-200 text-blue-800' :
                                          ord.estado === 'en_preparacion' ? 'bg-yellow-200 text-yellow-800' :
                                          ord.estado === 'despachado' ? 'bg-blue-500 text-white' :
                                          ord.estado === 'entregado' ? 'bg-green-200 text-green-800' :
                                          'bg-red-200 text-red-800'
                                        }`}>{ord.estado.toUpperCase()}</span>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="font-mono font-bold text-black">${ord.total.toLocaleString('es-CO')}</span>
                                        {(() => {
                                          const cxc = invoices.find(i => i.tipo === 'cxc' && i.pedido_id === ord.id);
                                          return cxc && cxc.saldo_pendiente > 0 ? (
                                            <span className="font-mono text-[9px] font-bold text-brand-red border border-brand-red bg-red-50 px-1 py-0.5">Debe ${cxc.saldo_pendiente.toLocaleString('es-CO')}</span>
                                          ) : cxc && cxc.saldo_pendiente === 0 ? (
                                            <span className="font-mono text-[9px] font-bold text-green-700 border border-green-300 bg-green-50 px-1 py-0.5">Pagado ✓</span>
                                          ) : null;
                                        })()}
                                        <button
                                          type="button"
                                          onClick={() => setPedidoExpandido(isExpanded ? null : ord.id)}
                                          className="font-mono text-[9px] font-bold border border-black bg-white px-2 py-0.5 hover:bg-neutral-100"
                                        >{isExpanded ? 'Ocultar' : 'Ver detalle'}</button>
                                        <button
                                          type="button"
                                          onClick={() => { setOrderManager(ord); setOrderManagerNotas(ord.notas ?? ''); setAbonoForm({ monto: '', medioPago: 'efectivo', referencia: '', cuentaBancariaId: '' }); setAbonoError(null); }}
                                          className="neo-btn px-2 py-0.5 text-[9px] font-mono font-bold hover:bg-brand-blue hover:text-white"
                                        >Gestionar</button>
                                        <button type="button" onClick={() => openEditOrder(ord)} className="neo-btn p-1 hover:bg-neutral-100"><Pencil size={11} /></button>
                                        <button type="button" onClick={() => void handleDeleteOrder(ord)} className="neo-btn p-1 hover:bg-red-50 hover:text-brand-red"><Trash2 size={11} /></button>
                                      </div>
                                    </div>

                                    {/* Panel expandible de detalle */}
                                    {isExpanded && (
                                      <div className="border-t border-black/20 bg-white/70 px-3 py-3 flex flex-col gap-3">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                          <div>
                                            <div className="font-bold text-neutral-500 uppercase font-mono text-[9px] mb-1">CLIENTE</div>
                                            <div className="font-semibold text-black">{client?.nombre ?? '—'}</div>
                                            {client?.nit && <div className="text-neutral-600 mt-0.5 font-mono">{client.nit}</div>}
                                          </div>
                                          <div>
                                            <div className="font-bold text-neutral-500 uppercase font-mono text-[9px] mb-1">PRODUCTOS</div>
                                            <div className="space-y-1">
                                              {ord.items.map((item, idx) => {
                                                const p = item.producto_id ? products.find(prod => prod.id === item.producto_id) : null;
                                                const etiqueta = item.producto_id ? p?.nombre : (item.concepto ?? 'Cargo');
                                                return (
                                                  <div key={idx} className="flex justify-between">
                                                    <span>{etiqueta} x{item.cantidad}</span>
                                                    <span className="font-mono text-neutral-500">${(item.precio * item.cantidad).toLocaleString('es-CO')}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="font-bold text-neutral-500 uppercase font-mono text-[9px] mb-1">ENVÍO / DESPACHO</div>
                                            <div className="font-mono text-neutral-700 text-xs">
                                              {ord.guia_despacho ? (
                                                <div className="flex flex-col gap-1">
                                                  <div className="font-bold text-green-700">Guía de Seguimiento:</div>
                                                  <div className="bg-neutral-100 p-1 border border-black inline-block text-[10px]">{ord.guia_despacho}</div>
                                                </div>
                                              ) : (
                                                <span className="italic text-neutral-400">Guía pendiente de despacho</span>
                                              )}
                                            </div>
                                          </div>
                                        </div>

                                        {/* Cambiar estado */}
                                        <div className="border-t border-dashed border-neutral-300 pt-3">
                                          <div className="text-[9px] font-mono font-bold text-neutral-400 uppercase mb-2">Cambiar estado</div>
                                          <div className="flex flex-wrap gap-1.5">
                                            {todosLosEstados.filter(e => e !== ord.estado).map((next) => (
                                              <button
                                                key={next}
                                                type="button"
                                                onClick={() => handleTransitionOrder(ord.id, next)}
                                                className={`font-mono text-[9px] font-bold px-2.5 py-1 border border-black active:translate-y-px transition-all ${
                                                  next === 'cancelado' ? 'bg-white text-brand-red hover:bg-red-50 border-red-300' :
                                                  next === 'entregado' ? 'bg-green-100 text-green-800 hover:bg-green-200 border-green-400' :
                                                  next === 'despachado' ? 'bg-brand-yellow/70 text-black hover:bg-brand-yellow' :
                                                  next === 'confirmado' ? 'bg-brand-blue/20 text-brand-blue hover:bg-brand-blue/30' :
                                                  'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                                                }`}
                                              >
                                                {next.replace('_', ' ').toUpperCase()}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Vista Kanban de Pedidos */}
                    {pedidosVista === 'kanban' && (() => {
                      const estadosKanban: Order['estado'][] = ['borrador', 'confirmado', 'en_preparacion', 'despachado', 'entregado', 'cancelado'];
                      const semanaAtras = new Date();
                      semanaAtras.setDate(semanaAtras.getDate() - 7);

                      const pedidosSemana = orders.filter(ord => new Date(ord.fecha) >= semanaAtras);
                      const estadoColores: Record<string, string> = {
                        borrador: 'bg-neutral-100 border-neutral-400',
                        confirmado: 'bg-blue-50 border-blue-400',
                        en_preparacion: 'bg-yellow-50 border-yellow-400',
                        despachado: 'bg-blue-100 border-blue-500',
                        entregado: 'bg-green-50 border-green-400',
                        cancelado: 'bg-red-50 border-red-400',
                      };

                      return (
                        <div className="flex overflow-x-auto gap-3 pb-4">
                          {estadosKanban.map(estado => {
                            const columna = pedidosSemana.filter(ord =>
                              ord.estado === estado &&
                              (orderStatusFilter === 'all' || ord.estado === orderStatusFilter)
                            );
                            return (
                              <div key={estado} className={`w-56 shrink-0 border-2 ${estadoColores[estado] ?? 'bg-white border-black'} flex flex-col`}>
                                <div className="px-3 py-2 border-b-2 border-black bg-white/80">
                                  <div className="font-mono text-[10px] font-bold uppercase">{estado.replace('_', ' ')}</div>
                                  <div className="font-mono text-xs text-neutral-500">{columna.length} pedido{columna.length !== 1 ? 's' : ''}</div>
                                </div>
                                <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto max-h-96">
                                  {columna.length === 0 && (
                                    <p className="text-[10px] text-neutral-400 font-mono italic text-center py-4">Vacío</p>
                                  )}
                                  {columna.map(ord => {
                                    const client = customers.find(c => c.id === ord.cliente_id);
                                    const estadoLabel: Record<string, string> = {
                                      borrador: 'Borrador', confirmado: 'Confirmado',
                                      en_preparacion: 'En prep.', despachado: 'Despachado',
                                      entregado: 'Entregado', cancelado: 'Cancelado',
                                    };
                                    return (
                                      <div key={ord.id} className="bg-white border border-black p-2 flex flex-col gap-1.5 text-[10px]">
                                        <div className="font-bold text-black leading-tight">{client?.nombre ?? 'Sin cliente'}</div>
                                        <div className="font-mono text-neutral-400">{ord.numero}</div>
                                        <div className="font-mono font-bold">${ord.total.toLocaleString('es-CO')}</div>
                                        <select
                                          defaultValue=""
                                          onChange={(e) => { if (e.target.value) { handleTransitionOrder(ord.id, e.target.value as Order['estado']); e.target.value = ''; } }}
                                          className="mt-1 w-full border border-black bg-white font-mono text-[9px] py-0.5 px-1 cursor-pointer hover:bg-neutral-50"
                                        >
                                          <option value="" disabled>Mover a…</option>
                                          {(Object.keys(estadoLabel) as Order['estado'][]).filter(e => e !== ord.estado).map(e => (
                                            <option key={e} value={e}>{estadoLabel[e]}</option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                  </div>
                )}

                {/* --- FINANZAS TAB --- */}
                {activeTab === 'finanzas' && (
                  <div className="flex flex-col gap-4">
                    
                    {/* Tabs de Finanzas */}
                    <div className="flex flex-wrap border-b-2 border-black bg-white">
                      {(['resumen', 'cxc', 'cxp', 'compras', 'gastos', 'ingresos'] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setFinanceSubTab(tab)}
                          className={`font-mono text-xs font-bold px-4 py-3 border-r-2 border-black transition-all ${
                            financeSubTab === tab
                              ? 'bg-brand-blue text-white'
                              : 'text-black hover:bg-neutral-50'
                          }`}
                        >
                          {tab === 'resumen' && 'Resumen Financiero'}
                          {tab === 'cxc' && 'CxC · Por Cobrar'}
                          {tab === 'cxp' && 'CxP · Por Pagar'}
                          {tab === 'compras' && 'Compras / OC'}
                          {tab === 'gastos' && 'Gastos Op.'}
                          {tab === 'ingresos' && 'Ingresos'}
                        </button>
                      ))}
                    </div>

                    {finanzasCargando && (
                      <div className="bg-white border-2 border-black p-3 text-xs font-mono text-neutral-500">
                        Cargando información financiera desde el servidor...
                      </div>
                    )}
                    {finanzasError && (
                      <div className="bg-red-50 border-2 border-red-600 text-red-700 p-3 text-xs font-mono flex items-center justify-between gap-3">
                        <span>{finanzasError}</span>
                        <button
                          type="button"
                          onClick={() => void fetchFinanzas()}
                          className="neo-button text-[11px] px-2 py-1"
                        >
                          Reintentar
                        </button>
                      </div>
                    )}

                    {/* Contenido de Tabs Financieros */}
                    {financeSubTab === 'resumen' && (
                      <div className="flex flex-col gap-6">
                        {resumenCargando && <p className="text-xs text-neutral-500 font-mono p-2">Calculando resumen financiero…</p>}

                        {resumenFinanciero && (
                          <>
                            {/* Fila principal: flujo neto + saldo en cuentas */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className={`neo-card ${resumenFinanciero.flujoNeto >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">FLUJO NETO DEL PERÍODO</span>
                                <span className={`text-2xl font-black block mt-1 ${resumenFinanciero.flujoNeto >= 0 ? 'text-green-700' : 'text-brand-red'}`}>
                                  {resumenFinanciero.flujoNeto >= 0 ? '+' : ''}{resumenFinanciero.flujoNeto.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">
                                  {resumenFinanciero.periodo.desde} → {resumenFinanciero.periodo.hasta}
                                </span>
                              </div>
                              <div className="neo-card bg-white">
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">SALDO TOTAL EN CUENTAS</span>
                                <span className="text-2xl font-black text-black block mt-1">
                                  {resumenFinanciero.saldoCuentas.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">Suma de todas las cuentas bancarias activas</span>
                              </div>
                            </div>

                            {/* Ingresos vs Egresos */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="neo-card bg-white">
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">COBROS CxC</span>
                                <span className="text-lg font-black text-green-700 block mt-1">
                                  +{resumenFinanciero.ingresosCxC.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">Abonos de clientes</span>
                              </div>
                              <div className="neo-card bg-white">
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">INGRESOS MANUAL.</span>
                                <span className="text-lg font-black text-green-700 block mt-1">
                                  +{resumenFinanciero.ingresosManuales.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">Capital, préstamos, etc.</span>
                              </div>
                              <div className="neo-card bg-white">
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">PAGOS CxP</span>
                                <span className="text-lg font-black text-brand-red block mt-1">
                                  -{resumenFinanciero.egresosCxP.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">Abonos a proveedores</span>
                              </div>
                              <div className="neo-card bg-white">
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">GASTOS OP.</span>
                                <span className="text-lg font-black text-brand-red block mt-1">
                                  -{resumenFinanciero.egresosGastos.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">Arriendo, nómina, etc.</span>
                              </div>
                            </div>

                            {/* Cartera pendiente */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="neo-card bg-white">
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">CARTERA POR COBRAR (CxC)</span>
                                <span className="text-xl font-black text-black block mt-1">
                                  {resumenFinanciero.cxcPendiente.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">Saldo pendiente de clientes</span>
                              </div>
                              <div className="neo-card bg-white">
                                <span className="font-mono text-[10px] text-neutral-500 font-bold">DEUDA CON PROVEEDORES (CxP)</span>
                                <span className="text-xl font-black text-brand-red block mt-1">
                                  {resumenFinanciero.cxpPendiente.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                                </span>
                                <span className="text-[10px] text-neutral-500 font-mono">Saldo pendiente de facturas de compra</span>
                              </div>
                            </div>
                          </>
                        )}

                        {/* Cuentas Bancarias */}
                        <div className="neo-card bg-white">
                          <div className="flex justify-between items-center border-b border-black pb-2 mb-3">
                            <h3 className="font-mono text-xs font-bold">CUENTAS BANCARIAS</h3>
                            <button
                              type="button"
                              onClick={openCreateBankAccountModal}
                              className="neo-button text-[11px] px-3 py-1.5 flex items-center gap-1.5"
                            >
                              <Plus size={12} /> Nueva cuenta
                            </button>
                          </div>
                          {bankAccountsError && (
                            <div className="bg-red-50 border border-red-400 text-red-700 p-2 text-xs font-mono mb-3">
                              {bankAccountsError}
                              <button type="button" onClick={() => void fetchCuentasBancarias()} className="ml-2 underline">Reintentar</button>
                            </div>
                          )}
                          {bankAccountsCargando && <p className="text-xs text-neutral-500 font-mono py-2">Cargando cuentas…</p>}
                          {!bankAccountsCargando && bankAccounts.length === 0 && (
                            <p className="text-xs text-neutral-400 italic text-center py-4">Sin cuentas bancarias registradas. Crea la primera con &quot;Nueva cuenta&quot;.</p>
                          )}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {bankAccounts.map((ac) => (
                              <div key={ac.id} className="border-2 border-black p-3 flex justify-between items-center gap-3">
                                <div className="min-w-0">
                                  <div className="font-bold text-black truncate">{ac.banco}</div>
                                  <div className="text-[10px] text-neutral-500 font-mono mt-0.5">{ac.numero} · {ac.tipo.toUpperCase()}</div>
                                  <div className="font-mono font-black text-sm text-black mt-1">${ac.saldo.toLocaleString('es-CO')} COP</div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => { setTransferenciaForm(f => ({ ...f, cuentaOrigenId: ac.id })); setShowTransferenciaModal(true); }}
                                    className="neo-btn px-2 py-1 text-[10px] font-mono font-bold hover:bg-brand-sage/40"
                                    title="Transferir desde esta cuenta"
                                  >⇌ Transferir</button>
                                  <button type="button" onClick={() => openEditBankAccountModal(ac)} className="neo-btn p-1.5 hover:bg-neutral-100" title="Editar"><Pencil size={13} /></button>
                                  <button type="button" onClick={() => void handleDeleteBankAccount(ac)} className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red" title="Eliminar"><Trash2 size={13} /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Listado de Abonos Recientes */}
                        <div className="neo-card bg-white">
                          <h3 className="font-mono text-xs font-bold border-b border-black pb-2 mb-3">ÚLTIMOS ABONOS Y PAGOS LIQUIDADOS</h3>
                          <div className="space-y-2">
                            {abonos.map((ab) => {
                              const inv = invoices.find(i => i.id === ab.factura_id);
                              const client = inv?.tipo === 'cxc' ? customers.find(c => c.id === inv.cliente_id) : null;
                              const supp = inv?.tipo === 'cxp' ? suppliers.find(s => s.id === inv.proveedor_id) : null;

                              return (
                                <div key={ab.id} className="border border-neutral-200 p-2 flex items-center justify-between text-xs gap-3">
                                  <div className="min-w-0">
                                    <span className="font-mono text-green-700 font-bold mr-3">+${ab.monto.toLocaleString('es-CO')} COP</span>
                                    <span className="text-black font-semibold">
                                      Factura {inv?.numero} ({client?.nombre ?? supp?.nombre})
                                    </span>
                                    <div className="text-[10px] text-neutral-500 font-mono mt-0.5">Ref: {ab.referencia}</div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-mono text-[10px] text-neutral-500">{ab.fecha}</span>
                                    <button type="button" onClick={() => openEditAbono(ab)} className="neo-btn p-1 hover:bg-neutral-100" title="Editar abono"><Pencil size={11} /></button>
                                    <button type="button" onClick={() => void handleDeleteAbono(ab)} className="neo-btn p-1 hover:bg-red-50 hover:text-brand-red" title="Eliminar abono"><Trash2 size={11} /></button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CXC TAB */}
                    {financeSubTab === 'cxc' && (
                      <div className="flex flex-col gap-4">
                        <div className="flex justify-between items-center bg-white border-2 border-black p-3">
                          <span className="font-mono text-xs text-neutral-700">Cartera y facturas de venta pendientes</span>
                          <button
                            onClick={() => {
                              const pendingInvs = invoices.filter(i => i.tipo === 'cxc' && i.saldo_pendiente > 0);
                              const firstPending = pendingInvs[0];
                              if (firstPending) {
                                setSelectedInvoiceId(firstPending.id);
                                setAbonoMonto(firstPending.saldo_pendiente.toString());
                                setShowCreateAbono(true);
                              }
                            }}
                            className="neo-btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                          >
                            <Plus size={14} />
                            <span>Registrar Recaudo / Abono</span>
                          </button>
                        </div>

                        <div className="neo-card bg-white p-0">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold text-black">
                                <th className="p-3">FACTURA</th>
                                <th className="p-3">CLIENTE</th>
                                <th className="p-3 text-right">VALOR INICIAL</th>
                                <th className="p-3 text-right">SALDO DEUDA</th>
                                <th className="p-3 text-center">VENCIMIENTO</th>
                                <th className="p-3 text-center">ESTADO</th>
                                <th className="p-3 text-center">ACCIONES</th>
                              </tr>
                            </thead>
                            <tbody>
                              {invoices
                                .filter(i => i.tipo === 'cxc' && (showAllCxC || i.saldo_pendiente > 0))
                                .map((inv) => {
                                  const client = customers.find(c => c.id === inv.cliente_id);
                                  return (
                                    <tr key={inv.id} className="border-b border-neutral-200 hover:bg-neutral-50">
                                      <td className="p-3 font-mono font-bold text-black">{inv.numero}</td>
                                      <td className="p-3 font-semibold text-black">{client?.nombre}</td>
                                      <td className="p-3 text-right font-mono text-neutral-600">${inv.total.toLocaleString('es-CO')}</td>
                                      <td className={`p-3 text-right font-mono font-bold ${inv.saldo_pendiente > 0 ? 'text-brand-red' : 'text-green-700'}`}>
                                        ${inv.saldo_pendiente.toLocaleString('es-CO')}
                                      </td>
                                      <td className="p-3 text-center font-mono text-neutral-600">{inv.fecha_vencimiento}</td>
                                      <td className="p-3 text-center">
                                        <span className={`inline-block border text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                                          inv.estado === 'pagada' ? 'bg-green-100 text-green-800 border-green-400' :
                                          inv.estado === 'vencida' ? 'bg-brand-red text-white border-black' :
                                          'bg-brand-yellow/20 text-neutral-700 border-neutral-400'
                                        }`}>
                                          {inv.estado.toUpperCase()}
                                        </span>
                                      </td>
                                      <td className="p-3 text-center">
                                        <div className="flex items-center justify-center gap-1.5">
                                          <button type="button" onClick={() => openEditInvoice(inv)} className="neo-btn p-1.5 hover:bg-neutral-100" title="Editar factura"><Pencil size={12} /></button>
                                          <button type="button" onClick={() => void handleDeleteInvoice(inv)} className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red" title="Eliminar factura"><Trash2 size={12} /></button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              {invoices.filter(i => i.tipo === 'cxc' && (showAllCxC || i.saldo_pendiente > 0)).length === 0 && (
                                <tr>
                                  <td colSpan={7} className="p-6 text-center font-mono text-xs text-neutral-400">
                                    {showAllCxC ? 'No hay facturas de venta registradas.' : 'No hay facturas con saldo pendiente. '}
                                    {!showAllCxC && (
                                      <button type="button" onClick={() => setShowAllCxC(true)} className="underline text-brand-blue ml-1">Ver todas</button>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {!showAllCxC && invoices.some(i => i.tipo === 'cxc' && i.saldo_pendiente === 0) && (
                          <div className="text-center py-2">
                            <button
                              type="button"
                              onClick={() => setShowAllCxC(true)}
                              className="text-xs font-mono text-neutral-500 hover:text-black underline"
                            >
                              Ver todas (incluye pagadas)
                            </button>
                          </div>
                        )}
                        {showAllCxC && (
                          <div className="text-center py-2">
                            <button
                              type="button"
                              onClick={() => setShowAllCxC(false)}
                              className="text-xs font-mono text-neutral-500 hover:text-black underline"
                            >
                              Mostrar solo pendientes
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CXP TAB */}
                    {financeSubTab === 'cxp' && (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between bg-white border-2 border-black p-3">
                          <span className="font-mono text-xs font-bold">CUENTAS POR PAGAR · {invoices.filter(i => i.tipo === 'cxp' && i.saldo_pendiente > 0).length} pendientes</span>
                          <div className="flex gap-2">
                            <span className="font-mono text-xs text-neutral-500">Total saldo: <strong className="text-black">${invoices.filter(i => i.tipo === 'cxp').reduce((a, b) => a + b.saldo_pendiente, 0).toLocaleString('es-CO')}</strong></span>
                          </div>
                        </div>
                        <div className="neo-card bg-white p-0">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold text-black">
                                <th className="p-3">CÓDIGO</th>
                                <th className="p-3">PROVEEDOR</th>
                                <th className="p-3 text-right">TOTAL</th>
                                <th className="p-3 text-right">SALDO</th>
                                <th className="p-3 text-center">VENCE</th>
                                <th className="p-3 text-center">ESTADO</th>
                                <th className="p-3 text-center">ACCIONES</th>
                              </tr>
                            </thead>
                            <tbody>
                              {invoices
                                .filter(i => i.tipo === 'cxp')
                                .map((inv) => {
                                  const supp = suppliers.find(s => s.id === inv.proveedor_id);
                                  return (
                                    <tr key={inv.id} className="border-b border-neutral-200 hover:bg-neutral-50">
                                      <td className="p-3 font-mono font-bold text-black">{inv.numero}</td>
                                      <td className="p-3 font-semibold text-black">{supp?.nombre ?? '—'}</td>
                                      <td className="p-3 text-right font-mono text-neutral-600">${inv.total.toLocaleString('es-CO')}</td>
                                      <td className={`p-3 text-right font-mono font-bold ${inv.saldo_pendiente > 0 ? 'text-brand-red' : 'text-green-700'}`}>
                                        ${inv.saldo_pendiente.toLocaleString('es-CO')}
                                      </td>
                                      <td className="p-3 text-center font-mono text-neutral-600">{inv.fecha_vencimiento}</td>
                                      <td className="p-3 text-center">
                                        <span className={`inline-block border text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                                          inv.estado === 'pagada' ? 'bg-green-100 text-green-800 border-green-400' :
                                          inv.estado === 'vencida' ? 'bg-brand-red text-white border-black' :
                                          'bg-brand-yellow/20 text-neutral-700 border-neutral-400'
                                        }`}>
                                          {inv.estado.toUpperCase()}
                                        </span>
                                      </td>
                                      <td className="p-3 text-center">
                                        <div className="flex items-center justify-center gap-1.5">
                                          {inv.saldo_pendiente > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => openCxpAbono({ id: inv.id, numero: inv.numero, total: inv.total, saldo: inv.saldo_pendiente })}
                                              className="border-2 border-black bg-brand-blue text-white font-mono text-[10px] font-bold px-2 py-1 hover:opacity-90"
                                              title="Registrar pago"
                                            >
                                              $ Pagar
                                            </button>
                                          )}
                                          <button type="button" onClick={() => openEditInvoice(inv)} className="neo-btn p-1.5 hover:bg-neutral-100" title="Editar factura"><Pencil size={12} /></button>
                                          <button type="button" onClick={() => void handleDeleteInvoice(inv)} className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red" title="Eliminar factura"><Trash2 size={12} /></button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              {invoices.filter(i => i.tipo === 'cxp').length === 0 && (
                                <tr><td colSpan={7} className="p-8 text-center text-xs text-neutral-500 font-mono">No hay cuentas por pagar registradas.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* COMPRAS / ÓRDENES DE COMPRA TAB */}
                    {financeSubTab === 'compras' && (
                      <div className="flex flex-col gap-4">
                        <div className="flex justify-between items-center bg-white border-2 border-black p-3">
                          <div>
                            <span className="font-mono text-xs font-bold">ÓRDENES DE COMPRA</span>
                            <span className="ml-2 text-xs text-neutral-500">({compras.length} en total)</span>
                          </div>
                          <button
                            onClick={() => setShowCreateCompra(true)}
                            className="neo-btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                          >
                            <Plus size={14} /> Nueva Orden de Compra
                          </button>
                        </div>

                        {comprasError && (
                          <div className="bg-red-50 border-2 border-red-600 text-red-700 p-3 text-xs font-mono">
                            {comprasError}
                            <button type="button" onClick={() => void fetchCompras()} className="ml-2 underline">Reintentar</button>
                          </div>
                        )}

                        {comprasCargando && (
                          <div className="bg-white border-2 border-black p-3 text-xs font-mono text-neutral-500">Cargando órdenes de compra...</div>
                        )}

                        <div className="neo-card bg-white p-0">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold text-black">
                                <th className="p-3">OC NÚM.</th>
                                <th className="p-3">PROVEEDOR</th>
                                <th className="p-3 text-right">TOTAL</th>
                                <th className="p-3 text-center">FECHA ESP.</th>
                                <th className="p-3 text-center">ESTADO</th>
                                <th className="p-3 text-center">CxP</th>
                                <th className="p-3 text-center">ACCIONES</th>
                              </tr>
                            </thead>
                            <tbody>
                              {compras.map((oc) => {
                                const prov = suppliers.find(s => s.id === oc.proveedorId);
                                const cxpFactura = oc.facturaCompraId ? invoices.find(i => i.id === oc.facturaCompraId) : null;
                                const transicionesValidas = TRANSICIONES_VALIDAS_PROVEEDOR[oc.estado];
                                return (
                                  <tr key={oc.id} className="border-b border-neutral-200 hover:bg-neutral-50">
                                    <td className="p-3 font-mono font-bold text-black">
                                      <button type="button" onClick={() => setSelectedCompra(oc)} className="hover:underline text-brand-blue">{oc.numero}</button>
                                    </td>
                                    <td className="p-3 font-semibold text-black">{prov?.nombre ?? <span className="text-neutral-400 italic">Sin proveedor</span>}</td>
                                    <td className="p-3 text-right font-mono text-neutral-700">${oc.total.toLocaleString('es-CO')}</td>
                                    <td className="p-3 text-center font-mono text-neutral-500">{oc.fechaEsperada ?? '—'}</td>
                                    <td className="p-3 text-center">
                                      <span className={`inline-block border text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                                        oc.estado === 'recibido' ? 'bg-green-100 text-green-800 border-green-400' :
                                        oc.estado === 'cancelado' ? 'bg-neutral-100 text-neutral-500 border-neutral-400' :
                                        oc.estado === 'enviado' ? 'bg-brand-blue/10 text-brand-blue border-brand-blue' :
                                        oc.estado === 'recibido_parcial' ? 'bg-brand-yellow/20 text-neutral-700 border-brand-yellow' :
                                        'bg-white text-neutral-700 border-neutral-400'
                                      }`}>
                                        {oc.estado.replace('_', ' ').toUpperCase()}
                                      </span>
                                    </td>
                                    <td className="p-3 text-center font-mono text-xs">
                                      {cxpFactura ? (
                                        <span className={`text-[10px] font-bold ${cxpFactura.saldo_pendiente > 0 ? 'text-brand-red' : 'text-green-700'}`}>
                                          {cxpFactura.numero}
                                        </span>
                                      ) : (
                                        <span className="text-neutral-400 text-[10px]">—</span>
                                      )}
                                    </td>
                                    <td className="p-3 text-center">
                                      <div className="flex items-center justify-center gap-1">
                                        {transicionesValidas.map(est => (
                                          <button
                                            key={est}
                                            type="button"
                                            disabled={transicionandoCompra}
                                            onClick={() => void handleTransicionarCompra(oc, est)}
                                            className="neo-btn px-1.5 py-1 text-[10px] font-mono hover:bg-brand-blue/10 disabled:opacity-50"
                                            title={`Pasar a ${est}`}
                                          >
                                            {est === 'enviado' ? '→ Enviado' :
                                             est === 'recibido_parcial' ? '→ Parcial' :
                                             est === 'recibido' ? '→ Recibido' :
                                             est === 'cancelado' ? '✕' : est}
                                          </button>
                                        ))}
                                        <button type="button" onClick={() => void handleEliminarCompra(oc)} className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red" title="Eliminar OC"><Trash2 size={11} /></button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                              {compras.length === 0 && !comprasCargando && (
                                <tr>
                                  <td colSpan={7} className="p-6 text-center font-mono text-xs text-neutral-400">
                                    No hay órdenes de compra registradas.
                                    <button type="button" onClick={() => setShowCreateCompra(true)} className="ml-1 underline text-brand-blue">Crear la primera</button>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* BANCOS TAB */}

                    {/* GASTOS OPERATIVOS TAB */}
                    {financeSubTab === 'gastos' && (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between bg-white border-2 border-black p-3">
                          <div>
                            <span className="font-mono text-xs font-bold">GASTOS OPERATIVOS</span>
                            <span className="ml-2 text-xs text-neutral-500">Total del período: <strong>${gastos.reduce((a, g) => a + g.monto, 0).toLocaleString('es-CO')}</strong></span>
                          </div>
                          <button
                            onClick={() => setShowGastoModal(true)}
                            className="neo-btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                          >
                            <Plus size={14} /> Registrar Gasto
                          </button>
                        </div>

                        {gastosCargando && <p className="text-xs text-neutral-500 font-mono p-4">Cargando gastos…</p>}
                        {gastosError && <p className="text-xs text-brand-red font-mono p-4">{gastosError}</p>}

                        <div className="neo-card bg-white p-0">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold text-black">
                                <th className="p-3">DESCRIPCIÓN</th>
                                <th className="p-3">CATEGORÍA</th>
                                <th className="p-3 text-right">MONTO</th>
                                <th className="p-3 text-center">FECHA</th>
                                <th className="p-3">MEDIO PAGO</th>
                                <th className="p-3">CUENTA</th>
                                <th className="p-3 text-center">ACCIONES</th>
                              </tr>
                            </thead>
                            <tbody>
                              {gastos.map((g) => {
                                const cuenta = bankAccounts.find(b => b.id === g.cuentaBancariaId);
                                return (
                                  <tr key={g.id} className="border-b border-neutral-200 hover:bg-neutral-50">
                                    <td className="p-3 font-semibold text-black">{g.descripcion}</td>
                                    <td className="p-3">
                                      <span className="inline-block border border-neutral-300 text-[10px] font-mono font-bold px-1.5 py-0.5 bg-neutral-50">
                                        {LABEL_CATEGORIA_GASTO[g.categoria]}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right font-mono font-bold text-brand-red">
                                      -${g.monto.toLocaleString('es-CO')}
                                    </td>
                                    <td className="p-3 text-center font-mono text-neutral-600">{g.fecha}</td>
                                    <td className="p-3 text-neutral-600">{g.medioPago ?? '—'}</td>
                                    <td className="p-3 text-neutral-600">{cuenta ? `${cuenta.banco} · ${cuenta.numero}` : '—'}</td>
                                    <td className="p-3 text-center">
                                      <button
                                        type="button"
                                        onClick={() => void handleEliminarGasto(g)}
                                        className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red"
                                        title="Eliminar gasto"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {gastos.length === 0 && !gastosCargando && (
                                <tr><td colSpan={7} className="p-8 text-center text-xs text-neutral-500 font-mono">No hay gastos operativos registrados.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* INGRESOS TAB */}
                    {financeSubTab === 'ingresos' && (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between bg-white border-2 border-black p-3">
                          <div>
                            <span className="font-mono text-xs font-bold">INGRESOS BANCARIOS MANUALES</span>
                            <span className="ml-2 text-xs text-neutral-500">Total: <strong>+${ingresos.reduce((a, i) => a + i.monto, 0).toLocaleString('es-CO')}</strong></span>
                          </div>
                          <button
                            onClick={() => {
                              setIngresoForm({ descripcion: '', categoria: 'otro', monto: '', fecha: '', medioPago: '', cuentaBancariaId: bankAccounts[0]?.id ?? '', notas: '' });
                              setIngresoFormError(null);
                              setShowIngresoModal(true);
                            }}
                            className="neo-btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                          >
                            <Plus size={14} /> Registrar Ingreso
                          </button>
                        </div>

                        {ingresosCargando && <p className="text-xs text-neutral-500 font-mono p-4">Cargando ingresos…</p>}
                        {ingresosError && <p className="text-xs text-brand-red font-mono p-4">{ingresosError}</p>}

                        <div className="neo-card bg-white p-0">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold text-black">
                                <th className="p-3">DESCRIPCIÓN</th>
                                <th className="p-3">CATEGORÍA</th>
                                <th className="p-3 text-right">MONTO</th>
                                <th className="p-3 text-center">FECHA</th>
                                <th className="p-3">MEDIO PAGO</th>
                                <th className="p-3">CUENTA DESTINO</th>
                                <th className="p-3 text-center">ACCIONES</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ingresos.map((ing) => {
                                const cuenta = bankAccounts.find(b => b.id === ing.cuentaBancariaId);
                                return (
                                  <tr key={ing.id} className="border-b border-neutral-200 hover:bg-neutral-50">
                                    <td className="p-3 font-semibold text-black">{ing.descripcion}</td>
                                    <td className="p-3">
                                      <span className="inline-block border border-neutral-300 text-[10px] font-mono font-bold px-1.5 py-0.5 bg-neutral-50">
                                        {ing.categoria.replace('_', ' ').toUpperCase()}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right font-mono font-bold text-green-700">
                                      +${ing.monto.toLocaleString('es-CO')}
                                    </td>
                                    <td className="p-3 text-center font-mono text-neutral-600">{ing.fecha}</td>
                                    <td className="p-3 text-neutral-600">{ing.medioPago ?? '—'}</td>
                                    <td className="p-3 text-neutral-600">{cuenta ? `${cuenta.banco} · ${cuenta.numero}` : '—'}</td>
                                    <td className="p-3 text-center">
                                      <button
                                        type="button"
                                        onClick={() => void handleEliminarIngreso(ing)}
                                        className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red"
                                        title="Eliminar ingreso"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {ingresos.length === 0 && !ingresosCargando && (
                                <tr><td colSpan={7} className="p-8 text-center text-xs text-neutral-500 font-mono">No hay ingresos registrados. Usa el botón de arriba para registrar capital, préstamos, devoluciones, etc.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  </div>
                )}

                {/* --- CRM TAB --- */}
                {activeTab === 'crm' && (
                  <div className="flex flex-col gap-4">

                    {proveedoresError && (
                      <div className="bg-red-50 border-2 border-red-600 text-red-700 p-3 text-xs font-mono flex items-center justify-between gap-3">
                        <span>{proveedoresError}</span>
                        <button
                          type="button"
                          onClick={() => void fetchProveedores()}
                          className="neo-button text-[11px] px-2 py-1"
                        >
                          Reintentar
                        </button>
                      </div>
                    )}

                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

                    {/* Listado Izquierdo de Clientes / Proveedores */}
                    <div className="xl:col-span-1 flex flex-col gap-4">

                      {proveedoresCargando && crmTypeFilter === 'proveedores' && (
                        <div className="bg-white border-2 border-black p-3 text-xs font-mono text-neutral-500">
                          Cargando proveedores desde el servidor...
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (crmTypeFilter === 'proveedores') {
                            setCreateSupplierError(null);
                            setShowCreateSupplier(true);
                          } else {
                            setCreateCustomerError(null);
                            setShowCreateCustomer(true);
                          }
                        }}
                        className="neo-btn-primary text-xs py-2 w-full flex items-center justify-center gap-1.5"
                      >
                        <Plus size={14} />
                        <span>{crmTypeFilter === 'proveedores' ? 'Crear Proveedor' : 'Crear Cliente'}</span>
                      </button>

                      <div className="flex border-b-2 border-black bg-white">
                        <button
                          onClick={() => setCrmTypeFilter('clientes')}
                          className={`font-mono text-xs font-bold px-4 py-2 border-r-2 border-black flex-1 ${
                            crmTypeFilter === 'clientes' ? 'bg-brand-blue text-white' : 'bg-white text-black hover:bg-neutral-50'
                          }`}
                        >
                          Clientes
                        </button>
                        <button
                          onClick={() => setCrmTypeFilter('proveedores')}
                          className={`font-mono text-xs font-bold px-4 py-2 flex-1 ${
                            crmTypeFilter === 'proveedores' ? 'bg-brand-blue text-white' : 'bg-white text-black hover:bg-neutral-50'
                          }`}
                        >
                          Proveedores
                        </button>
                      </div>

                      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                        {crmTypeFilter === 'clientes' 
                          ? customers.map((c) => (
                              <div
                                key={c.id}
                                onClick={() => setSelectedCrmEntityId(c.id)}
                                className={`neo-card p-3.5 bg-white cursor-pointer hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-sm transition-all ${
                                  selectedCrmEntityId === c.id ? 'border-brand-blue ring-1 ring-brand-blue' : ''
                                }`}
                              >
                                <div className="font-bold text-black text-xs">{c.nombre}</div>
                                {c.nit && <div className="text-[10px] text-neutral-500 font-mono mt-1">{c.nit}</div>}
                                {(() => {
                                  const pedidosCliente = orders.filter(o => o.cliente_id === c.id);
                                  const saldoCliente = invoices
                                    .filter(i => i.tipo === 'cxc' && i.cliente_id === c.id)
                                    .reduce((a, b) => a + b.saldo_pendiente, 0);
                                  return (
                                    <div className="flex justify-between items-center mt-3">
                                      <span className="text-[10px] text-neutral-600 font-mono">
                                        Pedidos: {pedidosCliente.length}
                                      </span>
                                      <span className={`text-[10px] font-mono font-bold ${saldoCliente > 0 ? 'text-brand-red' : 'text-green-700'}`}>
                                        Saldo: ${saldoCliente.toLocaleString('es-CO')}
                                      </span>
                                    </div>
                                  );
                                })()}
                              </div>
                            ))
                          : suppliers.map((s) => (
                              <div
                                key={s.id}
                                onClick={() => setSelectedCrmEntityId(s.id)}
                                className={`neo-card p-3.5 bg-white cursor-pointer hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-sm transition-all ${
                                  selectedCrmEntityId === s.id ? 'border-brand-blue ring-1 ring-brand-blue' : ''
                                }`}
                              >
                                <div className="font-bold text-black text-xs">{s.nombre}</div>
                                <div className="text-[10px] text-neutral-500 font-mono mt-1">NIT: {s.nit}</div>
                                <div className="text-[10px] text-neutral-700 mt-2">Contacto: {s.contacto}</div>
                              </div>
                            ))
                        }
                      </div>

                    </div>

                    {/* Detalle Entidad & Bitácora */}
                    <div className="xl:col-span-2 flex flex-col gap-6">
                      
                      {(() => {
                        const client = customers.find(c => c.id === selectedCrmEntityId);
                        const supp = suppliers.find(s => s.id === selectedCrmEntityId);
                        
                        if (!client && !supp) {
                          return (
                            <div className="neo-card bg-white h-full flex items-center justify-center text-xs text-neutral-400 italic">
                              Selecciona un contacto del panel izquierdo
                            </div>
                          );
                        }

                        return (
                          <div className="neo-card bg-white flex flex-col gap-6">
                            
                            {/* Header Detalle */}
                            <div className="border-b border-black pb-4 flex items-start justify-between gap-3">
                              <div>
                                <h3 className="text-base font-bold text-black">{client?.nombre ?? supp?.nombre}</h3>
                                <span className="font-mono text-[10px] text-neutral-500 block mt-1">
                                  {client ? (client.nit ? `${client.nit} · ` : '') : supp?.nit ? `NIT: ${supp.nit} · ` : ''}
                                  Email: {client?.email ?? supp?.email} · Teléfono: {client?.telefono ?? supp?.telefono}
                                </span>
                                <span className="font-mono text-[10px] text-neutral-500 block">
                                  Dirección: {client?.direccion ?? supp?.direccion}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => (client ? openEditCustomer(client) : supp ? openEditSupplier(supp) : undefined)}
                                  className="neo-btn p-1.5 hover:bg-neutral-100"
                                  title={client ? 'Editar cliente' : 'Editar proveedor'}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => (client ? void handleDeleteCustomer(client) : supp ? void handleDeleteSupplier(supp) : undefined)}
                                  className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red"
                                  title={client ? 'Eliminar cliente' : 'Eliminar proveedor'}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>

                            {/* Saldo pendiente + lista de pedidos del cliente (reemplaza el viejo "score crediticio") */}
                            {client && (() => {
                              const pedidosCliente = orders
                                .filter(o => o.cliente_id === client.id)
                                .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
                              const facturasCliente = invoices.filter(i => i.tipo === 'cxc' && i.cliente_id === client.id);
                              const saldoCliente = facturasCliente.reduce((a, b) => a + b.saldo_pendiente, 0);

                              return (
                                <div className="flex flex-col gap-4">
                                  <div className="border-2 border-black p-4 bg-neutral-50 flex items-center gap-4">
                                    <DollarSign className="text-brand-red shrink-0" size={28} />
                                    <div>
                                      <div className="font-mono text-[10px] text-neutral-500 font-bold">SALDO PENDIENTE (CxC)</div>
                                      <div className={`font-mono text-sm font-black mt-0.5 ${saldoCliente > 0 ? 'text-brand-red' : 'text-green-700'}`}>
                                        ${saldoCliente.toLocaleString('es-CO')} COP
                                      </div>
                                      <div className="text-[10px] text-neutral-500 mt-1">
                                        De {facturasCliente.length} {facturasCliente.length === 1 ? 'factura emitida' : 'facturas emitidas'}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex flex-col gap-2">
                                    <h4 className="font-mono text-xs font-bold border-b border-black pb-1">
                                      PEDIDOS DEL CLIENTE ({pedidosCliente.length})
                                    </h4>
                                    {pedidosCliente.length === 0 ? (
                                      <p className="text-xs text-neutral-400 italic font-mono py-1">Este cliente todavía no tiene pedidos.</p>
                                    ) : (
                                      <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
                                        {pedidosCliente.map((ord) => (
                                          <div key={ord.id} className="flex items-center justify-between border border-black/15 bg-white px-2.5 py-1.5 text-[11px] font-mono">
                                            <div className="flex flex-col min-w-0 flex-1 mr-2">
                                              <span className="font-bold text-black truncate">{getOrderDisplayName(ord)}</span>
                                              <span className="text-neutral-500 text-[10px]">{ord.numero} · {new Date(ord.fecha).toLocaleDateString('es-CO')}</span>
                                            </div>
                                            <span className="border border-black/20 bg-neutral-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neutral-700">
                                              {ord.estado.replace('_', ' ')}
                                            </span>
                                            <span className="font-bold text-black">${ord.total.toLocaleString('es-CO')}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Timeline de interacción */}
                            <div className="space-y-4">
                              <h4 className="font-mono text-xs font-bold border-b border-black pb-1">BITÁCORA DE INTERACCIONES COMERCIALES</h4>
                              
                              {/* Formulario Agregar Nota */}
                              <form onSubmit={handleAddCrmInteraction} className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Registrar nueva llamada, nota de cobranza o acuerdo..."
                                  value={newCrmInteraction}
                                  onChange={(e) => setNewCrmInteraction(e.target.value)}
                                  className="neo-input text-xs flex-1"
                                />
                                <button type="submit" className="neo-btn text-xs py-2">
                                  Agregar Nota
                                </button>
                              </form>

                              {crmNotasError && (
                                <div className="bg-red-50 border-2 border-red-600 text-red-700 p-2.5 text-[11px] font-mono flex items-center justify-between gap-3">
                                  <span>{crmNotasError}</span>
                                  <button
                                    type="button"
                                    onClick={() => void fetchCrmNotas()}
                                    className="neo-button text-[10px] px-2 py-1"
                                  >
                                    Reintentar
                                  </button>
                                </div>
                              )}

                              {/* Timeline list */}
                              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                                {crmNotasCargando && (
                                  <div className="text-xs text-neutral-400 italic text-center py-4 font-mono">
                                    Cargando bitácora...
                                  </div>
                                )}

                                {!crmNotasCargando && crmNotas.map((note, idx) => (
                                  <div key={idx} className="border border-neutral-300 p-2.5 bg-neutral-50 flex flex-col gap-1 text-xs">
                                    <div className="flex justify-between items-center">
                                      <span className="font-bold text-neutral-500 font-mono text-[9px]">INTERACCIÓN #{idx+1}</span>
                                      <span className="font-mono text-[10px] text-neutral-500">{note.fecha}</span>
                                    </div>
                                    <p className="text-black text-xs leading-relaxed">{note.nota}</p>
                                  </div>
                                ))}

                                {!crmNotasCargando && crmNotas.length === 0 && (
                                  <div className="text-xs text-neutral-400 italic text-center py-4">
                                    No hay interacciones registradas para este contacto
                                  </div>
                                )}
                              </div>

                            </div>

                          </div>
                        );
                      })()}

                    </div>

                  </div>

                  </div>
                )}

                {/* --- COMUNICACIONES TAB --- */}
                {activeTab === 'comunicaciones' && (
                  <div className="flex flex-col gap-4">

                    {/* Sub-tabs */}
                    <div className="flex border-b-2 border-black bg-white">
                      {(['calendario', 'notas', 'redes'] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setComunicacionesSubTab(tab)}
                          className={`font-mono text-xs font-bold px-4 py-3 border-r-2 border-black transition-all ${
                            comunicacionesSubTab === tab
                              ? 'bg-brand-blue text-white'
                              : 'text-black hover:bg-neutral-50'
                          }`}
                        >
                          {tab === 'calendario' && 'Calendario / Planner'}
                          {tab === 'notas' && '📝 Notas'}
                          {tab === 'redes' && '📊 Redes Sociales'}
                        </button>
                      ))}
                    </div>

                    {comunicacionesSubTab === 'calendario' && (
                      <>
                        {comunicacionesCargando && (
                          <div className="bg-white border-2 border-black p-3 text-xs font-mono text-neutral-500">
                            Cargando calendario desde el servidor...
                          </div>
                        )}
                        {comunicacionesError && (
                          <div className="bg-red-50 border-2 border-red-600 text-red-700 p-3 text-xs font-mono flex items-center justify-between gap-3">
                            <span>{comunicacionesError}</span>
                            <button
                              type="button"
                              onClick={() => void fetchComunicaciones()}
                              className="neo-button text-[11px] px-2 py-1"
                            >
                              Reintentar
                            </button>
                          </div>
                        )}

                        {/* Navegación del mes + nuevo evento */}
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border-2 border-black p-3">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setCalendarMonthCursor(new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth() - 1, 1))}
                              className="neo-button text-xs px-2 py-1"
                            >
                              ←
                            </button>
                            <span className="font-mono font-bold text-sm capitalize">{calendarGrid.label}</span>
                            <button
                              type="button"
                              onClick={() => setCalendarMonthCursor(new Date(calendarMonthCursor.getFullYear(), calendarMonthCursor.getMonth() + 1, 1))}
                              className="neo-button text-xs px-2 py-1"
                            >
                              →
                            </button>
                            <button
                              type="button"
                              onClick={() => setCalendarMonthCursor(new Date())}
                              className="neo-button text-xs px-2 py-1"
                            >
                              Hoy
                            </button>
                          </div>
                          <button
                            onClick={() => { resetEventForm(); setShowCreateEvent(true); }}
                            className="neo-btn bg-brand-blue text-white hover:opacity-90 flex items-center gap-2 px-4 py-2 text-xs"
                          >
                            <Plus size={16} />
                            <span>Nuevo evento</span>
                          </button>
                        </div>

                        {/* Cuadrícula del mes */}
                        <div className="bg-white border-2 border-black">
                          <div className="grid grid-cols-7 border-b-2 border-black">
                            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
                              <div key={d} className="font-mono text-[10px] font-bold text-center py-2 border-r border-black last:border-r-0 text-neutral-500">
                                {d}
                              </div>
                            ))}
                          </div>
                          <div className="grid grid-cols-7">
                            {calendarGrid.days.map(({ date, key, enMes }) => {
                              const eventos = calendarGrid.eventosPorDia.get(key) ?? [];
                              const esHoy = key === new Date().toISOString().slice(0, 10);
                              return (
                                <div
                                  key={key}
                                  className={`min-h-[110px] border-r border-b border-black last:border-r-0 p-1.5 flex flex-col gap-1 ${
                                    enMes ? 'bg-white' : 'bg-neutral-50'
                                  }`}
                                >
                                  <span className={`font-mono text-[10px] font-bold ${
                                    esHoy ? 'bg-brand-blue text-white px-1.5 py-0.5 inline-block w-fit' : enMes ? 'text-black' : 'text-neutral-400'
                                  }`}>
                                    {date.getDate()}
                                  </span>
                                  <div className="flex flex-col gap-1">
                                    {eventos.map((evento) => (
                                      <button
                                        key={evento.id}
                                        type="button"
                                        onClick={() => { setEventoPopup(evento); setEventoPopupDesc(evento.descripcion ?? ''); }}
                                        title="Click para ver detalle y cambiar estado"
                                        className={`text-left text-[9px] font-mono font-bold px-1.5 py-1 border-[1.5px] border-black truncate flex items-center gap-1 ${
                                          evento.tipo === 'nota' ? 'bg-brand-yellow/30' :
                                          evento.tipo === 'recordatorio' ? 'bg-brand-blue/20' :
                                          'bg-brand-red/15'
                                        } ${(evento.estado === 'hecho' || evento.estado === 'subido') ? 'opacity-50 line-through' : ''}`}
                                      >
                                        {evento.tipo === 'post' && evento.canal === 'instagram' && <Instagram size={10} />}
                                        {evento.tipo === 'post' && evento.canal === 'facebook' && <Facebook size={10} />}
                                        {evento.tipo === 'post' && evento.canal === 'tiktok' && <TikTokIcon size={10} />}
                                        <span className="truncate">{evento.titulo}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Listado detallado del mes (con acción de eliminar) */}
                        <div className="bg-white border-2 border-black p-3 flex flex-col gap-2">
                          <h3 className="font-mono font-bold text-xs uppercase border-b border-black pb-2">Eventos de este mes</h3>
                          {calendarEvents
                            .filter(ev => {
                              const d = new Date(ev.fecha);
                              return d.getFullYear() === calendarMonthCursor.getFullYear() && d.getMonth() === calendarMonthCursor.getMonth();
                            })
                            .map((evento) => (
                              <div key={evento.id} className="flex items-center justify-between gap-3 border-b border-neutral-200 last:border-b-0 py-2 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`inline-block border-[1.5px] border-black text-[9px] font-mono font-bold px-1.5 py-0.5 shrink-0 ${
                                    evento.tipo === 'nota' ? 'bg-brand-yellow/30' :
                                    evento.tipo === 'recordatorio' ? 'bg-brand-blue/20' :
                                    'bg-brand-red/15'
                                  }`}>
                                    {evento.tipo.toUpperCase()}
                                  </span>
                                  <span className="font-mono text-neutral-500 text-[10px] shrink-0">{new Date(evento.fecha).toLocaleDateString('es-CO')}</span>
                                  <span className="font-semibold text-black truncate">{evento.titulo}</span>
                                  {evento.canal && (
                                    <span className="text-neutral-500 shrink-0">
                                      {evento.canal === 'instagram' && <Instagram size={12} />}
                                      {evento.canal === 'facebook' && <Facebook size={12} />}
                                      {evento.canal === 'tiktok' && <TikTokIcon size={12} />}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {/* Estado con colores por etapa */}
                                  <div className="flex items-center gap-1">
                                    {ESTADO_ANTERIOR_LOCAL[evento.estado] !== null && (
                                      <button type="button" onClick={() => void handleRetrocederEventEstado(evento)}
                                        className="text-neutral-400 hover:text-black font-bold text-xs" title="Retroceder estado">‹</button>
                                    )}
                                    <span className={`font-mono text-[9px] font-bold border-[1.5px] border-black px-2 py-1 ${
                                      evento.estado === 'idea' ? 'bg-neutral-100 text-neutral-600' :
                                      evento.estado === 'grabado' ? 'bg-orange-100 text-orange-700 border-orange-400' :
                                      evento.estado === 'editado' ? 'bg-brand-yellow/30 text-neutral-700' :
                                      evento.estado === 'subido' ? 'bg-green-100 text-green-700 border-green-400' :
                                      evento.estado === 'hecho' ? 'bg-green-100 text-green-700 border-green-400' :
                                      'bg-white text-neutral-600'
                                    }`}>
                                      {evento.estado.toUpperCase()}
                                    </span>
                                    {TRANSICIONES_EVENTO_LOCAL[evento.estado] !== null && (
                                      <button type="button" onClick={() => void handleAvanzarEventEstado(evento)}
                                        className="text-neutral-400 hover:text-black font-bold text-xs" title={`Avanzar a ${TRANSICIONES_EVENTO_LOCAL[evento.estado]}`}>›</button>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteCalendarEvent(evento.id)}
                                    className="text-neutral-400 hover:text-brand-red"
                                    title="Eliminar"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          {calendarEvents.filter(ev => {
                            const d = new Date(ev.fecha);
                            return d.getFullYear() === calendarMonthCursor.getFullYear() && d.getMonth() === calendarMonthCursor.getMonth();
                          }).length === 0 && (
                            <p className="text-xs text-neutral-500 font-mono py-2">No hay notas, recordatorios ni posts planeados este mes.</p>
                          )}
                        </div>
                      </>
                    )}

                    {/* ─── NOTAS ─── */}
                    {comunicacionesSubTab === 'notas' && (
                      <div className="flex flex-col gap-4">
                        {notasError && <p className="text-xs text-brand-red font-mono border border-brand-red bg-red-50 p-2">{notasError}</p>}

                        {/* Barra de acción */}
                        <div className="flex items-center justify-between bg-white border-2 border-black p-3">
                          <span className="font-mono text-xs font-bold text-neutral-600">{notasInternas.length} nota{notasInternas.length !== 1 ? 's' : ''}</span>
                          <button
                            type="button"
                            onClick={() => setShowCreateNota(true)}
                            className="neo-btn bg-brand-blue text-white hover:opacity-90 flex items-center gap-1.5 text-xs px-3 py-2"
                          >
                            <Plus size={13} /> Nueva nota
                          </button>
                        </div>

                        {/* Lista de notas */}
                        {notasCargando ? (
                          <p className="text-xs text-neutral-400 font-mono italic">Cargando notas...</p>
                        ) : notasInternas.length === 0 ? (
                          <div className="neo-card bg-white text-center py-12 text-xs text-neutral-400 font-mono italic">
                            Todavía no hay notas. Crea la primera con el botón de arriba.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {/* Separadores por grupo */}
                            {(['pendientes', 'sin_checkbox', 'completadas'] as const).map((grupo) => {
                              const notasGrupo = notasSorted(notasInternas).filter((n) => {
                                if (grupo === 'pendientes') return n.tieneCheckbox && !n.completada;
                                if (grupo === 'sin_checkbox') return !n.tieneCheckbox;
                                return n.tieneCheckbox && n.completada;
                              });
                              if (notasGrupo.length === 0) return null;
                              return (
                                <div key={grupo} className="flex flex-col gap-1.5">
                                  <div className="font-mono text-[10px] font-bold text-neutral-400 uppercase tracking-widest px-1 pt-2">
                                    {grupo === 'pendientes' ? '● Pendientes' : grupo === 'sin_checkbox' ? '○ Notas' : '✓ Completadas'}
                                  </div>
                                  {notasGrupo.map((nota) => (
                                    <div
                                      key={nota.id}
                                      draggable
                                      onDragStart={() => handleNotaDragStart(nota.id)}
                                      onDragOver={(e) => handleNotaDragOver(e, nota.id)}
                                      onDrop={() => void handleNotaDrop(nota.id)}
                                      onDragEnd={() => setDragOverNotaId(null)}
                                      className={`neo-card bg-white flex items-start gap-2.5 p-3 cursor-grab active:cursor-grabbing transition-all ${
                                        dragOverNotaId === nota.id ? 'border-brand-blue bg-brand-blue/5' : ''
                                      }`}
                                    >
                                      <GripVertical size={14} className="text-neutral-300 shrink-0 mt-0.5" />

                                      {nota.tieneCheckbox && (
                                        <button
                                          type="button"
                                          onClick={() => void handleToggleNotaCompletada(nota)}
                                          className={`mt-0.5 shrink-0 w-4 h-4 border-2 border-black flex items-center justify-center hover:opacity-70 ${nota.completada ? 'bg-black' : 'bg-white'}`}
                                        >
                                          {nota.completada && <span className="text-white text-[9px] font-black leading-none">✓</span>}
                                        </button>
                                      )}

                                      <div className="flex-1 min-w-0">
                                        <div className={`font-bold text-xs text-black ${nota.completada ? 'line-through opacity-50' : ''}`}>{nota.titulo}</div>
                                        {nota.tipoContenido === 'lista' && nota.contenido ? (
                                          <div className="mt-1.5 flex flex-col gap-0.5">
                                            {sortChecklist(parsearChecklist(nota.contenido)).slice(0, 4).map(item => (
                                              <div key={item.id} className={`flex items-center gap-1.5 text-[11px] ${item.checked ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}>
                                                <span className={`w-3 h-3 border shrink-0 flex items-center justify-center ${item.checked ? 'bg-black border-black' : 'border-black/40 bg-white'}`}>
                                                  {item.checked && <span className="text-white text-[7px] font-black">✓</span>}
                                                </span>
                                                {item.texto || <span className="italic text-neutral-300">sin texto</span>}
                                              </div>
                                            ))}
                                            {parsearChecklist(nota.contenido).length > 4 && (
                                              <div className="text-[10px] text-neutral-400">+{parsearChecklist(nota.contenido).length - 4} más</div>
                                            )}
                                          </div>
                                        ) : nota.contenido ? (
                                          <div className={`text-[11px] text-neutral-600 mt-1 line-clamp-2 ${nota.completada ? 'opacity-50' : ''}`} dangerouslySetInnerHTML={{ __html: nota.contenido }} />
                                        ) : null}
                                        <div className="text-[10px] text-neutral-400 font-mono mt-1.5">
                                          {new Date(nota.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                                          {nota.tipoContenido === 'lista' && <span className="ml-2 border border-black/20 px-1">☑ lista</span>}
                                          {nota.tieneCheckbox && <span className="ml-2 border border-black/20 px-1">global ✓</span>}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingNota(nota);
                                            const esLista = nota.tipoContenido === 'lista';
                                            setNotaEditForm({
                                              titulo: nota.titulo,
                                              tipoContenido: nota.tipoContenido,
                                              contenido: esLista ? '' : (nota.contenido ?? ''),
                                              tieneCheckbox: nota.tieneCheckbox,
                                              checklistItems: esLista ? parsearChecklist(nota.contenido) : [],
                                            });
                                          }}
                                          className="neo-btn p-1.5 hover:bg-neutral-100"
                                          title="Editar"
                                        >
                                          <Pencil size={12} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleEliminarNota(nota)}
                                          className="neo-btn p-1.5 hover:bg-red-50 hover:text-brand-red"
                                          title="Eliminar"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Modal: crear nota */}
                    {showCreateNota && (() => {
                      const isLista = notaForm.tipoContenido === 'lista';
                      const sorted = sortChecklist(notaForm.checklistItems);
                      const addItem = () => setNotaForm(f => ({ ...f, checklistItems: [...f.checklistItems, { id: crypto.randomUUID(), texto: '', checked: false, orden: f.checklistItems.length }] }));
                      const updateItem = (id: string, patch: Partial<{ texto: string; checked: boolean }>) => setNotaForm(f => {
                        const items = f.checklistItems.map(it => it.id === id ? { ...it, ...patch } : it);
                        return { ...f, checklistItems: items };
                      });
                      const removeItem = (id: string) => setNotaForm(f => ({ ...f, checklistItems: f.checklistItems.filter(it => it.id !== id) }));
                      return (
                        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                          <div className="neo-card bg-white w-full max-w-3xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
                            <div className="flex justify-between items-center border-b border-black pb-2 sticky top-0 bg-white z-10">
                              <h3 className="font-mono text-sm font-bold flex items-center gap-2"><StickyNote size={15} /> NUEVA NOTA</h3>
                              <div className="flex items-center gap-2">
                                {/* Toggle texto / lista */}
                                <div className="flex border-2 border-black text-[11px] font-mono font-bold overflow-hidden">
                                  <button type="button" onClick={() => setNotaForm(f => ({ ...f, tipoContenido: 'texto' }))} className={`px-3 py-1 ${!isLista ? 'bg-black text-white' : 'hover:bg-neutral-100'}`}>Texto</button>
                                  <button type="button" onClick={() => setNotaForm(f => ({ ...f, tipoContenido: 'lista' }))} className={`px-3 py-1 border-l-2 border-black ${isLista ? 'bg-black text-white' : 'hover:bg-neutral-100'}`}>☑ Lista</button>
                                </div>
                                <button onClick={() => setShowCreateNota(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
                              </div>
                            </div>
                            <form onSubmit={(e) => void handleCrearNota(e)} className="flex flex-col gap-3.5 text-xs">
                              <input type="text" required autoFocus placeholder="Título de la nota..." value={notaForm.titulo}
                                onChange={(e) => setNotaForm({ ...notaForm, titulo: e.target.value })}
                                className="neo-input text-sm font-semibold border-0 border-b-2 border-black rounded-none px-1 focus:shadow-none" />

                              {isLista ? (
                                <div className="flex flex-col gap-1 min-h-[240px]">
                                  {sorted.map((item) => (
                                    <div key={item.id} draggable
                                      onDragStart={() => { checklistDragRef.current = item.id; }}
                                      onDragOver={(e) => { e.preventDefault(); }}
                                      onDrop={() => {
                                        if (!checklistDragRef.current || checklistDragRef.current === item.id) return;
                                        setNotaForm(f => {
                                          const items = [...f.checklistItems];
                                          const fromIdx = items.findIndex(i => i.id === checklistDragRef.current);
                                          const toIdx = items.findIndex(i => i.id === item.id);
                                          if (fromIdx < 0 || toIdx < 0) return f;
                                          const [moved] = items.splice(fromIdx, 1);
                                          items.splice(toIdx, 0, moved!);
                                          return { ...f, checklistItems: items.map((i, idx) => ({ ...i, orden: idx })) };
                                        });
                                      }}
                                      className={`flex items-center gap-2 p-2 rounded border ${item.checked ? 'bg-neutral-50 border-neutral-200' : 'bg-white border-neutral-200'} group cursor-grab`}
                                    >
                                      <GripVertical size={12} className="text-neutral-300 group-hover:text-neutral-500 shrink-0" />
                                      <input type="checkbox" checked={item.checked}
                                        onChange={(e) => updateItem(item.id, { checked: e.target.checked })}
                                        className="w-4 h-4 border-2 border-black accent-black shrink-0" />
                                      <input type="text" value={item.texto} placeholder="Elemento de la lista..."
                                        onChange={(e) => updateItem(item.id, { texto: e.target.value })}
                                        className={`flex-1 bg-transparent border-none outline-none text-sm ${item.checked ? 'line-through text-neutral-400' : ''}`} />
                                      <button type="button" onClick={() => removeItem(item.id)} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-brand-red transition-opacity">×</button>
                                    </div>
                                  ))}
                                  <button type="button" onClick={addItem} className="text-left text-xs text-neutral-400 hover:text-black flex items-center gap-1.5 py-1 px-2">
                                    <Plus size={12} /> Añadir elemento
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0">
                                  <div className="flex items-center gap-1 border-2 border-b-0 border-black bg-neutral-50 px-2 py-1">
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }} className="neo-btn px-2 py-1 font-bold text-xs hover:bg-neutral-200"><strong>N</strong></button>
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); }} className="neo-btn px-2 py-1 text-xs hover:bg-neutral-200 underline">S</button>
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }} className="neo-btn px-2 py-1 text-xs italic hover:bg-neutral-200">I</button>
                                    <div className="w-px h-4 bg-neutral-300 mx-1" />
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertUnorderedList'); }} className="neo-btn px-2 py-1 text-xs hover:bg-neutral-200">• Lista</button>
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertOrderedList'); }} className="neo-btn px-2 py-1 text-xs hover:bg-neutral-200">1. Lista</button>
                                  </div>
                                  <div contentEditable suppressContentEditableWarning
                                    onInput={(e) => setNotaForm({ ...notaForm, contenido: (e.currentTarget as HTMLDivElement).innerHTML })}
                                    className="neo-input min-h-[240px] font-normal text-sm leading-relaxed focus:outline-none overflow-y-auto"
                                    style={{ whiteSpace: 'pre-wrap' }} data-placeholder="Escribe aquí el contenido..." />
                                </div>
                              )}

                              {/* IA helper para nueva nota */}
                              {notaForm.contenido.replace(/<[^>]+>/g, '').trim() && (
                                <AiNotasHelper
                                  texto={notaForm.contenido.replace(/<[^>]+>/g, ' ').trim()}
                                  onAplicar={(txt) => setNotaForm({ ...notaForm, contenido: txt })}
                                />
                              )}

                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" checked={notaForm.tieneCheckbox}
                                  onChange={(e) => setNotaForm({ ...notaForm, tieneCheckbox: e.target.checked })}
                                  className="w-4 h-4 border-2 border-black accent-black" />
                                <span className="font-mono font-bold">Checkbox de completado global</span>
                              </label>
                              <button type="submit" disabled={guardandoNota} className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 disabled:opacity-50">
                                {guardandoNota ? 'GUARDANDO...' : 'CREAR NOTA'}
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Modal: editar nota */}
                    {editingNota && (() => {
                      const isLista = notaEditForm.tipoContenido === 'lista';
                      const sorted = sortChecklist(notaEditForm.checklistItems);
                      const addItem = () => setNotaEditForm(f => ({ ...f, checklistItems: [...f.checklistItems, { id: crypto.randomUUID(), texto: '', checked: false, orden: f.checklistItems.length }] }));
                      const updateItem = (id: string, patch: Partial<{ texto: string; checked: boolean }>) => setNotaEditForm(f => ({ ...f, checklistItems: f.checklistItems.map(it => it.id === id ? { ...it, ...patch } : it) }));
                      const removeItem = (id: string) => setNotaEditForm(f => ({ ...f, checklistItems: f.checklistItems.filter(it => it.id !== id) }));
                      return (
                        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                          <div className="neo-card bg-white w-full max-w-3xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
                            <div className="flex justify-between items-center border-b border-black pb-2 sticky top-0 bg-white z-10">
                              <h3 className="font-mono text-sm font-bold flex items-center gap-2"><Pencil size={14} /> EDITAR NOTA</h3>
                              <div className="flex items-center gap-2">
                                <div className="flex border-2 border-black text-[11px] font-mono font-bold overflow-hidden">
                                  <button type="button" onClick={() => setNotaEditForm(f => ({ ...f, tipoContenido: 'texto' }))} className={`px-3 py-1 ${!isLista ? 'bg-black text-white' : 'hover:bg-neutral-100'}`}>Texto</button>
                                  <button type="button" onClick={() => setNotaEditForm(f => ({ ...f, tipoContenido: 'lista' }))} className={`px-3 py-1 border-l-2 border-black ${isLista ? 'bg-black text-white' : 'hover:bg-neutral-100'}`}>☑ Lista</button>
                                </div>
                                <button onClick={() => setEditingNota(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
                              </div>
                            </div>
                            <form onSubmit={(e) => void handleGuardarEdicionNota(e)} className="flex flex-col gap-3.5 text-xs">
                              <input type="text" required autoFocus value={notaEditForm.titulo}
                                onChange={(e) => setNotaEditForm({ ...notaEditForm, titulo: e.target.value })}
                                className="neo-input text-sm font-semibold border-0 border-b-2 border-black rounded-none px-1 focus:shadow-none" />

                              {isLista ? (
                                <div className="flex flex-col gap-1 min-h-[240px]">
                                  {sorted.map((item) => (
                                    <div key={item.id} draggable
                                      onDragStart={() => { checklistDragRef.current = item.id; }}
                                      onDragOver={(e) => { e.preventDefault(); }}
                                      onDrop={() => {
                                        if (!checklistDragRef.current || checklistDragRef.current === item.id) return;
                                        setNotaEditForm(f => {
                                          const items = [...f.checklistItems];
                                          const fromIdx = items.findIndex(i => i.id === checklistDragRef.current);
                                          const toIdx = items.findIndex(i => i.id === item.id);
                                          if (fromIdx < 0 || toIdx < 0) return f;
                                          const [moved] = items.splice(fromIdx, 1);
                                          items.splice(toIdx, 0, moved!);
                                          return { ...f, checklistItems: items.map((i, idx) => ({ ...i, orden: idx })) };
                                        });
                                      }}
                                      className={`flex items-center gap-2 p-2 rounded border ${item.checked ? 'bg-neutral-50 border-neutral-200' : 'bg-white border-neutral-200'} group cursor-grab`}
                                    >
                                      <GripVertical size={12} className="text-neutral-300 group-hover:text-neutral-500 shrink-0" />
                                      <input type="checkbox" checked={item.checked}
                                        onChange={(e) => updateItem(item.id, { checked: e.target.checked })}
                                        className="w-4 h-4 border-2 border-black accent-black shrink-0" />
                                      <input type="text" value={item.texto} placeholder="Elemento..."
                                        onChange={(e) => updateItem(item.id, { texto: e.target.value })}
                                        className={`flex-1 bg-transparent border-none outline-none text-sm ${item.checked ? 'line-through text-neutral-400' : ''}`} />
                                      <button type="button" onClick={() => removeItem(item.id)} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-brand-red transition-opacity">×</button>
                                    </div>
                                  ))}
                                  <button type="button" onClick={addItem} className="text-left text-xs text-neutral-400 hover:text-black flex items-center gap-1.5 py-1 px-2">
                                    <Plus size={12} /> Añadir elemento
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0">
                                  <div className="flex items-center gap-1 border-2 border-b-0 border-black bg-neutral-50 px-2 py-1">
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }} className="neo-btn px-2 py-1 font-bold text-xs hover:bg-neutral-200"><strong>N</strong></button>
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); }} className="neo-btn px-2 py-1 text-xs hover:bg-neutral-200 underline">S</button>
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }} className="neo-btn px-2 py-1 text-xs italic hover:bg-neutral-200">I</button>
                                    <div className="w-px h-4 bg-neutral-300 mx-1" />
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertUnorderedList'); }} className="neo-btn px-2 py-1 text-xs hover:bg-neutral-200">• Lista</button>
                                    <button type="button" onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertOrderedList'); }} className="neo-btn px-2 py-1 text-xs hover:bg-neutral-200">1. Lista</button>
                                  </div>
                                  <div contentEditable suppressContentEditableWarning
                                    dangerouslySetInnerHTML={{ __html: notaEditForm.contenido }}
                                    onInput={(e) => setNotaEditForm({ ...notaEditForm, contenido: (e.currentTarget as HTMLDivElement).innerHTML })}
                                    className="neo-input min-h-[240px] font-normal text-sm leading-relaxed focus:outline-none overflow-y-auto"
                                    style={{ whiteSpace: 'pre-wrap' }} />
                                </div>
                              )}

                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" checked={notaEditForm.tieneCheckbox}
                                  onChange={(e) => setNotaEditForm({ ...notaEditForm, tieneCheckbox: e.target.checked })}
                                  className="w-4 h-4 border-2 border-black accent-black" />
                                <span className="font-mono font-bold">Checkbox de completado global</span>
                              </label>
                              <button type="submit" disabled={guardandoNota} className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 disabled:opacity-50">
                                {guardandoNota ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                    })()}

                    {comunicacionesSubTab === 'redes' && (
                      <div className="flex flex-col gap-4">
                        {/* Dashboard de métricas reales (Apify) */}
                        <IgDashboard />

                        {/* Planner de Contenido — Kanban de posts programados */}
                        {(() => {
                          const estadosPost = ['idea', 'grabado', 'editado', 'subido'] as const;
                          const dosSemanasAtras = new Date();
                          dosSemanasAtras.setDate(dosSemanasAtras.getDate() - 14);
                          const dosSemanasAdelante = new Date();
                          dosSemanasAdelante.setDate(dosSemanasAdelante.getDate() + 14);
                          const postsSemana = calendarEvents.filter(ev =>
                            ev.tipo === 'post' &&
                            new Date(ev.fecha) >= dosSemanasAtras &&
                            new Date(ev.fecha) <= dosSemanasAdelante
                          );
                          const estadoColores: Record<string, string> = {
                            idea: 'bg-neutral-100 border-neutral-400',
                            grabado: 'bg-orange-50 border-orange-400',
                            editado: 'bg-yellow-50 border-yellow-400',
                            subido: 'bg-green-50 border-green-400',
                          };
                          return (
                            <div className="bg-white border-2 border-black p-3 flex flex-col gap-3">
                              <h3 className="font-mono font-bold text-xs uppercase border-b border-black pb-2">Planner de Contenido — 4 semanas</h3>
                              {postsSemana.length === 0 ? (
                                <p className="text-xs font-mono text-neutral-400 text-center py-4">
                                  Sin posts planeados — crea uno desde el Calendario con tipo &ldquo;Post planeado&rdquo;.
                                </p>
                              ) : (
                                <div className="flex overflow-x-auto gap-3 pb-2">
                                  {estadosPost.map(estado => {
                                    const columna = postsSemana.filter(ev => ev.estado === estado);
                                    const siguiente = TRANSICIONES_EVENTO_LOCAL[estado] ?? null;
                                    const anterior = ESTADO_ANTERIOR_LOCAL[estado] ?? null;
                                    return (
                                      <div key={estado} className={`w-44 shrink-0 border-2 ${estadoColores[estado] ?? 'bg-white border-black'} flex flex-col`}>
                                        <div className="px-2 py-1.5 border-b border-black bg-white/70">
                                          <div className="font-mono text-[10px] font-bold uppercase">{estado}</div>
                                          <div className="font-mono text-[10px] text-neutral-500">{columna.length} posts</div>
                                        </div>
                                        <div className="flex flex-col gap-1.5 p-1.5 max-h-60 overflow-y-auto">
                                          {columna.length === 0 && (
                                            <p className="text-[9px] text-neutral-400 font-mono italic text-center py-3">Vacío</p>
                                          )}
                                          {columna.map(ev => (
                                            <div key={ev.id} className="bg-white border border-black p-1.5 flex flex-col gap-1 text-[9px]">
                                              <div className="flex items-center gap-1">
                                                {ev.canal === 'instagram' && <Instagram size={10} />}
                                                {ev.canal === 'facebook' && <Facebook size={10} />}
                                                {ev.canal === 'tiktok' && <TikTokIcon size={10} />}
                                                <span className="font-bold text-black truncate leading-tight">{ev.titulo}</span>
                                              </div>
                                              <div className="font-mono text-neutral-400">{new Date(ev.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</div>
                                              <div className="flex gap-1">
                                                {anterior && (
                                                  <button type="button" onClick={() => void handlePopupCambiarEstado(ev, anterior)}
                                                    className="border border-black bg-white hover:bg-neutral-100 px-1 py-0.5 font-mono font-bold flex-1">‹</button>
                                                )}
                                                {siguiente && (
                                                  <button type="button" onClick={() => void handlePopupCambiarEstado(ev, siguiente)}
                                                    className="border border-black bg-brand-blue text-white hover:opacity-90 px-1 py-0.5 font-mono font-bold flex-1">›</button>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                  </div>
                )}

                {/* --- CONFIGURACIÓN TAB --- */}
                {activeTab === 'config' && (
                  <div className="flex flex-col gap-6">

                    {/* Personalización de la interfaz — color secundario por usuario */}
                    <div className="neo-card bg-white flex flex-col gap-4">
                      <h3 className="font-mono text-sm font-bold border-b border-black pb-2">PERSONALIZACIÓN DE LA INTERFAZ</h3>
                      <p className="text-xs text-neutral-600 leading-relaxed">
                        Elige el color secundario de acento (botones, resaltados, indicadores) que se usa en toda la plataforma. Es una preferencia personal — cada usuario de tu empresa puede elegir el suyo sin afectar a los demás.
                      </p>

                      <div className="flex flex-wrap items-center gap-4">
                        <input
                          type="color"
                          value={/^#[0-9a-fA-F]{6}$/.test(colorSecundarioInput) ? colorSecundarioInput : '#5092A9'}
                          onChange={(e) => setColorSecundarioInput(e.target.value)}
                          className="h-10 w-16 border-2 border-black cursor-pointer bg-white p-0.5"
                        />
                        <input
                          type="text"
                          value={colorSecundarioInput}
                          onChange={(e) => setColorSecundarioInput(e.target.value)}
                          placeholder="#5092A9"
                          className="neo-input font-mono w-32 text-xs"
                        />
                        <button
                          type="button"
                          disabled={guardandoColor || !/^#[0-9a-fA-F]{6}$/.test(colorSecundarioInput)}
                          onClick={() => void handleGuardarColorSecundario(colorSecundarioInput)}
                          className="neo-btn bg-brand-blue text-white hover:opacity-90 text-xs px-4 py-2 disabled:opacity-50"
                        >
                          {guardandoColor ? 'Guardando...' : 'Guardar color'}
                        </button>
                        <button
                          type="button"
                          disabled={guardandoColor || !usuario?.colorSecundario}
                          onClick={() => void handleGuardarColorSecundario(null)}
                          className="neo-btn text-xs px-4 py-2 disabled:opacity-50"
                        >
                          Restablecer al de la plataforma
                        </button>
                      </div>

                      {colorError && <p className="text-brand-red font-mono text-[10px]">{colorError}</p>}

                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-mono text-neutral-500">VISTA PREVIA:</span>
                        <span className="px-3 py-1.5 border-2 border-black font-mono font-bold text-white" style={{ backgroundColor: colorSecundarioInput }}>
                          Botón de acento
                        </span>
                        <span className="font-mono font-bold" style={{ color: colorSecundarioInput }}>
                          Texto resaltado
                        </span>
                      </div>
                    </div>

                    {/* Consumo de límites */}
                    <div className="neo-card bg-white">
                      <h3 className="font-mono text-sm font-bold border-b border-black pb-2 mb-4">LÍMITES Y CONSUMO DEL PLAN ACTUAL (PROFESIONAL)</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono text-xs">
                        
                        <div>
                          <div className="flex justify-between mb-1">
                            <span>USUARIOS ACTIVOS EN TENANT</span>
                            <span className="font-bold">4 / 10 creados (40%)</span>
                          </div>
                          <div className="w-full bg-neutral-100 border border-black h-4">
                            <div className="bg-brand-blue border-r border-black h-full" style={{ width: '40%' }}></div>
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between mb-1">
                            <span>PRODUCTOS EN INVENTARIO</span>
                            <span className="font-bold">{products.length} / 10,000 creados ({Math.round(products.length / 10000 * 100)}%)</span>
                          </div>
                          <div className="w-full bg-neutral-100 border border-black h-4">
                            <div className="bg-brand-red border-r border-black h-full" style={{ width: `${products.length / 10000 * 100}%` }}></div>
                          </div>
                        </div>

                      </div>
                    </div>


                  </div>
                )}
              </>
            )}

          </section>

        </div>

      {/* ======================================= */}
      {/* --- MODALES Y DIÁLOGOS DE INTERACCIÓN --- */}
      {/* ======================================= */}

      {/* 1. Modal: Crear Producto */}
      {showCreateProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">REGISTRAR NUEVO PRODUCTO</h3>
              <button onClick={() => setShowCreateProduct(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>

            <form onSubmit={handleCreateProduct} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">CATEGORÍA</label>
                {!showNewCategoryInput ? (
                  <select
                    value={newProduct.categoria_id}
                    onChange={(e) => {
                      if (e.target.value === '__nueva__') {
                        setShowNewCategoryInput(true);
                        setNewCategoryError(null);
                        return;
                      }
                      setNewProduct({ ...newProduct, categoria_id: e.target.value });
                    }}
                    className="neo-input font-mono"
                  >
                    <option value="">Sin categoría</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                    <option value="__nueva__">+ Crear nueva categoría…</option>
                  </select>
                ) : (
                  <div className="flex flex-col gap-1.5 border border-black p-2 bg-neutral-50">
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        autoFocus
                        placeholder="Nombre de la categoría"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void handleCreateCategoryInline(); }
                        }}
                        className="neo-input font-mono flex-1"
                      />
                      <button
                        type="button"
                        disabled={creandoCategoria}
                        onClick={() => void handleCreateCategoryInline()}
                        className="neo-btn bg-brand-blue text-white hover:opacity-90 px-3 disabled:opacity-50"
                      >
                        {creandoCategoria ? '...' : 'OK'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNewCategoryInput(false); setNewCategoryName(''); setNewCategoryError(null); }}
                        className="neo-btn px-3"
                      >
                        ×
                      </button>
                    </div>
                    {newCategoryError && <p className="text-brand-red font-mono text-[10px]">{newCategoryError}</p>}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOMBRE DEL PRODUCTO</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Camisa Polo Roja"
                  value={newProduct.nombre}
                  onChange={(e) => setNewProduct({ ...newProduct, nombre: e.target.value })}
                  className="neo-input"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">DESCRIPCIÓN</label>
                <input
                  type="text"
                  placeholder="Ej. Algodón 100% transpirable"
                  value={newProduct.descripcion}
                  onChange={(e) => setNewProduct({ ...newProduct, descripcion: e.target.value })}
                  className="neo-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">PRECIO COSTO (COP)</label>
                  <input
                    type="number"
                    required
                    placeholder="35000"
                    value={newProduct.precio_costo}
                    onChange={(e) => setNewProduct({ ...newProduct, precio_costo: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">PRECIO VENTA BASE</label>
                  <input
                    type="number"
                    required
                    placeholder="79000"
                    value={newProduct.precio_venta}
                    onChange={(e) => setNewProduct({ ...newProduct, precio_venta: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">STOCK MÍNIMO ALERTA</label>
                  <input
                    type="number"
                    required
                    value={newProduct.stock_minimo}
                    onChange={(e) => setNewProduct({ ...newProduct, stock_minimo: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">STOCK COMPRA INICIAL</label>
                  <input
                    type="number"
                    required
                    value={newProduct.stock_inicial}
                    onChange={(e) => setNewProduct({ ...newProduct, stock_inicial: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
              </div>

              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5">
                CREAR Y REGISTRAR EN STOCK
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: Importador de Excel */}
      {showImportExcel && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-lg w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">
                {importStep === 1 && '1. SUBIR ARCHIVO EXCEL'}
                {importStep === 2 && '2. MAPEAR COLUMNAS DE EXCEL'}
                {importStep === 3 && '3. PROCESANDO E IMPORTANDO...'}
                {importStep === 4 && '4. IMPORTACIÓN EXITOSA'}
              </h3>
              <button
                onClick={() => setShowImportExcel(false)}
                disabled={importStep === 3}
                className="font-mono font-bold text-lg hover:text-brand-red disabled:opacity-50"
              >
                ×
              </button>
            </div>

            {/* STEP 1: Upload simulation */}
            {importStep === 1 && (
              <div className="flex flex-col gap-4 py-4 items-center justify-center border-2 border-dashed border-neutral-400 p-6 bg-neutral-50/50">
                <FileSpreadsheet size={48} className="text-neutral-400" />
                <div className="text-center text-xs">
                  <p className="font-bold text-black">Arrastra tu archivo .xlsx o .csv aquí</p>
                  <p className="text-neutral-500 mt-1">El archivo debe contener SKU, Nombre, Costo y stock mínimo.</p>
                </div>
                <button
                  onClick={triggerExcelUpload}
                  className="neo-btn bg-white hover:bg-neutral-50 text-xs py-2 mt-2"
                >
                  Simular Subida de inventario.xlsx
                </button>
              </div>
            )}

            {/* STEP 2: Mapping config */}
            {importStep === 2 && (
              <div className="flex flex-col gap-4 text-xs">
                <p className="text-neutral-700 font-medium leading-relaxed bg-neutral-100 p-2.5 border border-black/10">
                  Archivo subido: <code className="font-mono font-bold text-black">{excelFilename}</code>. 
                  Por favor, asocia los campos del sistema con las columnas detectadas en tu hoja de Excel.
                </p>

                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold">SKU (Filtro base)</span>
                    <select
                      value={excelMapping.sku}
                      onChange={(e) => setExcelMapping({ ...excelMapping, sku: e.target.value })}
                      className="neo-input font-mono text-[11px] py-1"
                    >
                      <option value="REF_PRODUCTO">REF_PRODUCTO (Col. A)</option>
                      <option value="SKU">SKU (Col. B)</option>
                    </select>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold">Nombre del Producto</span>
                    <select
                      value={excelMapping.nombre}
                      onChange={(e) => setExcelMapping({ ...excelMapping, nombre: e.target.value })}
                      className="neo-input font-mono text-[11px] py-1"
                    >
                      <option value="DESCRIPCION_LARGA">DESCRIPCION_LARGA (Col. C)</option>
                      <option value="NAME">NAME (Col. A)</option>
                    </select>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold">Precio Venta Cop</span>
                    <select
                      value={excelMapping.precio_venta}
                      onChange={(e) => setExcelMapping({ ...excelMapping, precio_venta: e.target.value })}
                      className="neo-input font-mono text-[11px] py-1"
                    >
                      <option value="PRECIO_CORRIENTE">PRECIO_CORRIENTE (Col. E)</option>
                      <option value="PRICE">PRICE (Col. D)</option>
                    </select>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold">Stock Inicial Físico</span>
                    <select
                      value={excelMapping.stock_inicial}
                      onChange={(e) => setExcelMapping({ ...excelMapping, stock_inicial: e.target.value })}
                      className="neo-input font-mono text-[11px] py-1"
                    >
                      <option value="CANTIDAD_FONDOS">CANTIDAD_FONDOS (Col. F)</option>
                      <option value="STOCK">STOCK (Col. F)</option>
                    </select>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-500 p-2.5 text-[10px] text-green-800 leading-normal">
                  💡 <strong>Validación inicial exitosa:</strong> Se detectaron 80 filas. 78 filas están listas para importar. 2 filas registran valores nulos (se omitirán).
                </div>

                <div className="flex gap-2 justify-end mt-2">
                  <button
                    onClick={() => setImportStep(1)}
                    className="border border-black hover:bg-neutral-50 px-4 py-2 font-mono font-bold"
                  >
                    Atrás
                  </button>
                  <button
                    onClick={executeImportSimulation}
                    className="neo-btn bg-brand-blue text-white hover:opacity-90 px-4 py-2"
                  >
                    Iniciar Importación Masiva
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Progress simulation */}
            {importStep === 3 && (
              <div className="flex flex-col gap-4 text-xs font-mono py-4">
                <div className="flex justify-between items-center">
                  <span>Importando registros en Postgres...</span>
                  <span className="font-bold">{importProgress}%</span>
                </div>
                
                {/* Progress bar */}
                <div className="w-full bg-neutral-100 border-2 border-black h-5 overflow-hidden">
                  <div className="bg-brand-blue h-full transition-all duration-300" style={{ width: `${importProgress}%` }}></div>
                </div>

                {/* Websocket simulation log */}
                <div className="bg-neutral-900 text-green-400 p-3 h-32 overflow-y-auto text-[10px] font-mono leading-relaxed border border-black">
                  {importLogs.map((log, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="text-neutral-500">&gt;</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 4: Success */}
            {importStep === 4 && (
              <div className="flex flex-col gap-4 text-xs py-4 text-center items-center">
                <div className="w-12 h-12 rounded-full border-2 border-black bg-green-100 text-green-800 flex items-center justify-center font-bold text-xl">✓</div>
                <div>
                  <h4 className="text-sm font-bold text-black">¡IMPORTACIÓN COMPLETADA!</h4>
                  <p className="text-neutral-600 mt-1 max-w-sm">
                    Se crearon 78 productos correctamente en tu schema PostgreSQL. El saldo de stock inicial fue agregado en un movimiento histórico.
                  </p>
                </div>
                <button
                  onClick={() => setShowImportExcel(false)}
                  className="neo-btn bg-brand-blue text-white hover:opacity-90 px-6 py-2.5 mt-2"
                >
                  Ver Inventario Actualizado
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* 3. Modal: Crear Pedido */}
      {showCreateOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-lg w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">CREAR NUEVO PEDIDO</h3>
              <button onClick={() => { setShowCreateOrder(false); setShowInlineNewClient(false); setInlineClientForm({ nombre: '', email: '', telefono: '' }); }} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>

            <form onSubmit={handleCreateOrder} className="flex flex-col gap-4 text-xs">
              
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="font-mono font-bold">SELECCIONAR CLIENTE</label>
                  <button
                    type="button"
                    onClick={() => { setShowInlineNewClient(v => !v); setInlineClientError(null); }}
                    className="font-mono text-[10px] text-brand-blue hover:underline font-bold flex items-center gap-0.5"
                  >
                    {showInlineNewClient ? '✕ Cancelar' : '+ Nuevo cliente'}
                  </button>
                </div>

                {!showInlineNewClient ? (
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="neo-input"
                  >
                    <option value="">— Sin cliente —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}{c.nit ? ` (${c.nit})` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <div className="border border-black/20 bg-neutral-50 p-3 flex flex-col gap-2">
                    <p className="font-mono text-[10px] font-bold text-neutral-500 uppercase">Nuevo cliente</p>
                    <form onSubmit={(e) => void handleInlineCreateClient(e)} className="flex flex-col gap-2">
                      <input
                        type="text"
                        placeholder="Nombre *"
                        value={inlineClientForm.nombre}
                        onChange={e => setInlineClientForm(f => ({ ...f, nombre: e.target.value }))}
                        className="neo-input text-xs"
                        autoFocus
                      />
                      <input
                        type="email"
                        placeholder="Email (opcional)"
                        value={inlineClientForm.email}
                        onChange={e => setInlineClientForm(f => ({ ...f, email: e.target.value }))}
                        className="neo-input text-xs"
                      />
                      <input
                        type="tel"
                        placeholder="Teléfono (opcional)"
                        value={inlineClientForm.telefono}
                        onChange={e => setInlineClientForm(f => ({ ...f, telefono: e.target.value }))}
                        className="neo-input text-xs"
                      />
                      {inlineClientError && (
                        <p className="text-brand-red font-mono text-[10px]">{inlineClientError}</p>
                      )}
                      <button
                        type="submit"
                        disabled={inlineCreandoCliente || !inlineClientForm.nombre.trim()}
                        className="neo-btn bg-black text-white text-xs py-1.5 disabled:opacity-50"
                      >
                        {inlineCreandoCliente ? 'Creando…' : 'Crear y seleccionar'}
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {/* Items agregados */}
              <div className="space-y-3">
                <div className="font-mono font-bold flex justify-between">
                  <span>PRODUCTOS DEL PEDIDO</span>
                  <button
                    type="button"
                    onClick={() => {
                      const firstProd = products[0];
                      if (firstProd) {
                        setOrderItems([...orderItems, { producto_id: firstProd.id, cantidad: 1, precio_excepcional: null }]);
                      }
                    }}
                    className="text-brand-blue hover:underline font-bold flex items-center gap-0.5 text-[10px]"
                  >
                    + Agregar Ítem
                  </button>
                </div>

                <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                  {orderItems.map((item, idx) => {
                    const activeProd = products.find(p => p.id === item.producto_id);
                    const maxAvailable = activeProd ? (productStocks[activeProd.id] ?? 0) : 0;
                    const isExceeded = item.cantidad > maxAvailable;
                    const precioCatalogo = activeProd?.precio_venta ?? 0;
                    const precioEfectivo = item.precio_excepcional ?? precioCatalogo;
                    const esExcepcional = item.precio_excepcional !== null;
                    const costo = activeProd?.precio_costo ?? null;
                    const margenUnitario = costo !== null ? precioEfectivo - costo : null;
                    const margenPorcentaje = margenUnitario !== null && precioEfectivo > 0 ? (margenUnitario / precioEfectivo) * 100 : null;

                    return (
                      <div key={idx} className="border border-black/10 bg-neutral-50/60 p-2 flex flex-col gap-1.5">
                        <div className="flex gap-2 items-center">
                          <select
                            value={item.producto_id}
                            onChange={(e) => {
                              const updated = [...orderItems];
                              const target = updated[idx];
                              if (target) {
                                target.producto_id = e.target.value;
                                target.precio_excepcional = null; // nuevo producto → vuelve al precio de catálogo
                                setOrderItems(updated);
                              }
                            }}
                            className="neo-input flex-1 py-1.5"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>{p.nombre} (Dispo: {productStocks[p.id] ?? 0})</option>
                            ))}
                          </select>

                          <div className="w-20 flex flex-col">
                            <input
                              type="number"
                              min="1"
                              value={item.cantidad}
                              onChange={(e) => {
                                const updated = [...orderItems];
                                const target = updated[idx];
                                if (target) {
                                  target.cantidad = parseInt(e.target.value) || 1;
                                  setOrderItems(updated);
                                }
                              }}
                              className={`neo-input py-1.5 text-center font-mono ${isExceeded ? 'border-brand-red text-brand-red bg-red-50' : ''}`}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const updated = orderItems.filter((_, i) => i !== idx);
                              const firstProd = products[0];
                              const defaultId = firstProd ? firstProd.id : '';
                              setOrderItems(updated.length === 0 ? [{ producto_id: defaultId, cantidad: 1, precio_excepcional: null }] : updated);
                            }}
                            className="font-mono font-bold text-base hover:text-brand-red px-2"
                          >
                            ×
                          </button>
                        </div>

                        {/* Precio excepcional + margen — permite cobrar distinto al precio de
                            catálogo (p.ej. un descuento puntual) y ver de inmediato cuánto
                            margen queda con ese precio, comparado contra el costo del producto. */}
                        <div className="flex gap-2 items-center pl-0.5">
                          <label className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-neutral-600 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={esExcepcional}
                              onChange={(e) => {
                                const updated = [...orderItems];
                                const target = updated[idx];
                                if (target) {
                                  target.precio_excepcional = e.target.checked ? precioCatalogo : null;
                                  setOrderItems(updated);
                                }
                              }}
                            />
                            PRECIO EXCEPCIONAL
                          </label>

                          <div className="w-28 flex flex-col">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={!esExcepcional}
                              // OJO: cuando NO está marcado "precio excepcional" el campo
                              // queda VACÍO — no se precarga el precio de catálogo. Así
                              // queda claro que no se está fijando ningún valor a mano;
                              // el catálogo sigue siendo la fuente de verdad por defecto.
                              placeholder={esExcepcional ? undefined : `Catálogo: $${precioCatalogo.toLocaleString('es-CO')}`}
                              value={esExcepcional ? (item.precio_excepcional ?? '') : ''}
                              onChange={(e) => {
                                const updated = [...orderItems];
                                const target = updated[idx];
                                if (target) {
                                  target.precio_excepcional = e.target.value === '' ? null : parseFloat(e.target.value) || 0;
                                  setOrderItems(updated);
                                }
                              }}
                              className={`neo-input py-1 px-1.5 text-right font-mono text-[11px] ${esExcepcional ? 'border-brand-blue' : 'opacity-50 cursor-not-allowed placeholder:text-[9px]'}`}
                            />
                          </div>

                          <span className="text-[10px] font-mono text-neutral-400">
                            (catálogo: ${precioCatalogo.toLocaleString('es-CO')})
                          </span>

                          {margenUnitario !== null ? (
                            <span className={`ml-auto text-[10px] font-mono font-bold ${margenUnitario < 0 ? 'text-brand-red' : 'text-emerald-700'}`}>
                              Margen: ${margenUnitario.toLocaleString('es-CO', { maximumFractionDigits: 0 })}
                              {margenPorcentaje !== null && ` (${margenPorcentaje.toFixed(1)}%)`}
                            </span>
                          ) : (
                            <span className="ml-auto text-[10px] font-mono text-neutral-400">Sin costo cargado — no se puede calcular margen</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cargo dinámico de Envío — un ítem que NO está en el catálogo,
                  se cobra "a costo" (sin margen) pero el cliente igual debe pagarlo. */}
              <div className="border border-black/10 bg-neutral-50/60 p-2.5 flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 font-mono font-bold text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shippingEnabled}
                    onChange={(e) => {
                      setShippingEnabled(e.target.checked);
                      if (!e.target.checked) setShippingPrice('');
                    }}
                  />
                  AGREGAR COBRO DE ENVÍO
                </label>
                {shippingEnabled && (
                  <div className="flex items-center gap-2 pl-0.5">
                    <span className="font-mono text-[11px] text-neutral-600">Envío</span>
                    <div className="w-32 flex flex-col">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Valor a cobrar"
                        value={shippingPrice}
                        onChange={(e) => setShippingPrice(e.target.value)}
                        className="neo-input py-1 px-1.5 text-right font-mono text-[11px] border-brand-blue"
                      />
                    </div>
                    <span className="text-[10px] font-mono text-neutral-400">
                      Se cobra a costo — no deja margen, pero igual lo paga el cliente.
                    </span>
                  </div>
                )}
              </div>

              {/* Errores de stock */}
              {orderValidationError && (
                <div className="border border-brand-red bg-red-50 p-2.5 text-[11px] text-brand-red font-mono">
                  {orderValidationError}
                </div>
              )}

              <div className="bg-neutral-50 p-3 border border-black/10 flex flex-col gap-1 font-mono font-bold">
                <div className="flex justify-between items-center">
                  <span>TOTAL PEDIDO:</span>
                  <span className="text-sm text-black">
                    ${(orderItems.reduce((sum, item) => {
                      const p = products.find(prod => prod.id === item.producto_id);
                      const precio = item.precio_excepcional ?? p?.precio_venta ?? 0;
                      return sum + precio * item.cantidad;
                    }, 0) + (shippingEnabled ? (parseFloat(shippingPrice) || 0) : 0)).toLocaleString('es-CO')} COP
                  </span>
                </div>
                {(() => {
                  // El envío se cobra "a costo" (costo = precio) — su aporte al
                  // margen siempre es cero, así que no afecta `margenTotal`,
                  // solo se refleja en el total de arriba.
                  let margenTotal = 0;
                  let hayCostoFaltante = false;
                  for (const item of orderItems) {
                    const p = products.find(prod => prod.id === item.producto_id);
                    const precio = item.precio_excepcional ?? p?.precio_venta ?? 0;
                    if (!p || p.precio_costo === null || p.precio_costo === undefined) {
                      hayCostoFaltante = true;
                      continue;
                    }
                    margenTotal += (precio - p.precio_costo) * item.cantidad;
                  }
                  return (
                    <div className="flex justify-between items-center text-[10px] text-neutral-500 font-normal">
                      <span>MARGEN ESTIMADO{hayCostoFaltante ? ' (parcial — faltan costos)' : ''}:</span>
                      <span className={margenTotal < 0 ? 'text-brand-red font-bold' : 'text-emerald-700 font-bold'}>
                        ${margenTotal.toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP
                      </span>
                    </div>
                  );
                })()}
              </div>

              <button
                type="submit"
                className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 mt-2"
              >
                CREAR PEDIDO EN BORRADOR
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 4. Modal: Registrar Abono */}
      {showCreateAbono && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-sm w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">REGISTRAR PAGO / ABONO</h3>
              <button onClick={() => setShowCreateAbono(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>

            <form onSubmit={handleCreateAbono} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">SELECCIONAR FACTURA</label>
                <select
                  value={selectedInvoiceId}
                  onChange={(e) => {
                    setSelectedInvoiceId(e.target.value);
                    const inv = invoices.find(i => i.id === e.target.value);
                    if (inv) setAbonoMonto(inv.saldo_pendiente.toString());
                  }}
                  className="neo-input"
                >
                  {invoices
                    .filter(i => i.saldo_pendiente > 0)
                    .map(inv => {
                      const client = customers.find(c => c.id === inv.cliente_id);
                      const supp = suppliers.find(s => s.id === inv.proveedor_id);
                      return (
                        <option key={inv.id} value={inv.id}>
                          {inv.numero} - {client?.nombre ?? supp?.nombre} (Saldo: ${inv.saldo_pendiente.toLocaleString('es-CO')})
                        </option>
                      );
                    })}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">MONTO DEL ABONO (COP)</label>
                <input
                  type="number"
                  required
                  placeholder="Monto"
                  value={abonoMonto}
                  onChange={(e) => setAbonoMonto(e.target.value)}
                  className="neo-input font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">REFERENCIA / MÉTODO PAGO</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Transferencia Bancolombia #129038"
                  value={abonoReferencia}
                  onChange={(e) => setAbonoReferencia(e.target.value)}
                  className="neo-input"
                />
              </div>

              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 mt-2">
                APLICAR ABONO E INGRESAR A BANCO
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nuevo evento de calendario (nota / recordatorio / post planeado) */}
      {showCreateEvent && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-sm w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">NUEVO EVENTO DE CALENDARIO</h3>
              <button onClick={() => setShowCreateEvent(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>

            <form onSubmit={handleCreateCalendarEvent} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">TIPO</label>
                <select
                  value={eventFormTipo}
                  onChange={(e) => setEventFormTipo(e.target.value as 'nota' | 'recordatorio' | 'post')}
                  className="neo-input font-mono"
                >
                  <option value="nota">Nota</option>
                  <option value="recordatorio">Recordatorio</option>
                  <option value="post">Post planeado (red social)</option>
                </select>
              </div>

              {eventFormTipo === 'post' && (
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">RED SOCIAL</label>
                  <select
                    value={eventFormCanal}
                    onChange={(e) => setEventFormCanal(e.target.value as 'instagram' | 'facebook' | 'tiktok')}
                    className="neo-input font-mono"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                  <p className="text-[10px] text-neutral-500 leading-snug mt-0.5">
                    Esto es solo organización visual — no publica nada automáticamente en la red social.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">TÍTULO</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Publicar nueva colección"
                  value={eventFormTitulo}
                  onChange={(e) => setEventFormTitulo(e.target.value)}
                  className="neo-input"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">FECHA</label>
                <input
                  type="date"
                  required
                  value={eventFormFecha}
                  onChange={(e) => setEventFormFecha(e.target.value)}
                  className="neo-input font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">DESCRIPCIÓN (OPCIONAL)</label>
                <textarea
                  placeholder="Notas adicionales, borrador del caption, etc."
                  value={eventFormDescripcion}
                  onChange={(e) => setEventFormDescripcion(e.target.value)}
                  className="neo-input min-h-[70px]"
                />
              </div>

              {eventFormError && (
                <div className="bg-red-50 border-2 border-red-600 text-red-700 p-2 text-[11px] font-mono">
                  {eventFormError}
                </div>
              )}

              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 mt-2">
                GUARDAR EVENTO
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 5. Modal: WhatsApp Business Test */}
      {/* Modal: Nueva Orden de Compra */}
      {showCreateCompra && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white w-full max-w-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-black pb-2 sticky top-0 bg-white z-10">
              <h3 className="font-mono text-sm font-bold">NUEVA ORDEN DE COMPRA</h3>
              <button onClick={() => setShowCreateCompra(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>

            <form onSubmit={(e) => void handleCrearCompra(e)} className="flex flex-col gap-4 text-xs">
              {compraFormError && (
                <div className="bg-red-50 border-2 border-red-500 text-red-700 p-2 font-mono text-xs">{compraFormError}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">PROVEEDOR</label>
                  <select
                    value={compraForm.proveedorId}
                    onChange={(e) => setCompraForm({ ...compraForm, proveedorId: e.target.value })}
                    className="neo-input font-mono"
                  >
                    <option value="">Sin proveedor asignado</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">FECHA ESPERADA DE ENTREGA</label>
                  <input
                    type="date"
                    value={compraForm.fechaEsperada}
                    onChange={(e) => setCompraForm({ ...compraForm, fechaEsperada: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOTAS (opcional)</label>
                <textarea
                  rows={2}
                  value={compraForm.notas}
                  onChange={(e) => setCompraForm({ ...compraForm, notas: e.target.value })}
                  className="neo-input resize-y"
                  placeholder="Instrucciones, referencias, condiciones..."
                />
              </div>

              {/* Ítems */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-black pb-1">
                  <label className="font-mono font-bold">ÍTEMS DE LA ORDEN</label>
                  <button
                    type="button"
                    onClick={() => setCompraForm({ ...compraForm, items: [...compraForm.items, { productoId: '', concepto: '', esLibre: false, cantidad: '1', precioUnitario: '0' }] })}
                    className="neo-btn text-[10px] px-2 py-1 flex items-center gap-1"
                  >
                    <Plus size={10} /> Añadir ítem
                  </button>
                </div>

                {compraForm.items.map((item, idx) => (
                  <div key={idx} className="border border-neutral-200 p-3 flex flex-col gap-2 bg-neutral-50">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.esLibre}
                          onChange={(e) => {
                            const updated = [...compraForm.items];
                            updated[idx] = { ...item, esLibre: e.target.checked };
                            setCompraForm({ ...compraForm, items: updated });
                          }}
                          className="w-3 h-3 border border-black accent-black"
                        />
                        Ítem libre (sin producto del catálogo)
                      </label>
                      <button
                        type="button"
                        onClick={() => setCompraForm({ ...compraForm, items: compraForm.items.filter((_, i) => i !== idx) })}
                        className="neo-btn p-1 hover:bg-red-50 hover:text-brand-red"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {item.esLibre ? (
                      <input
                        type="text"
                        placeholder="Descripción del ítem..."
                        value={item.concepto}
                        onChange={(e) => {
                          const updated = [...compraForm.items];
                          updated[idx] = { ...item, concepto: e.target.value };
                          setCompraForm({ ...compraForm, items: updated });
                        }}
                        className="neo-input text-xs"
                        required
                      />
                    ) : (
                      <select
                        value={item.productoId}
                        onChange={(e) => {
                          const updated = [...compraForm.items];
                          updated[idx] = { ...item, productoId: e.target.value };
                          setCompraForm({ ...compraForm, items: updated });
                        }}
                        className="neo-input font-mono text-xs"
                        required
                      >
                        <option value="">Seleccionar producto...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="font-mono text-[10px] font-bold">CANTIDAD</label>
                        <input
                          type="number" min="0.001" step="0.001" required
                          value={item.cantidad}
                          onChange={(e) => {
                            const updated = [...compraForm.items];
                            updated[idx] = { ...item, cantidad: e.target.value };
                            setCompraForm({ ...compraForm, items: updated });
                          }}
                          className="neo-input font-mono text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-mono text-[10px] font-bold">PRECIO UNITARIO (COP)</label>
                        <input
                          type="number" min="0" step="1" required
                          value={item.precioUnitario}
                          onChange={(e) => {
                            const updated = [...compraForm.items];
                            updated[idx] = { ...item, precioUnitario: e.target.value };
                            setCompraForm({ ...compraForm, items: updated });
                          }}
                          className="neo-input font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Total estimado */}
                <div className="flex justify-end text-xs font-mono font-bold border-t border-black pt-2">
                  TOTAL ESTIMADO: $
                  {compraForm.items.reduce((acc, item) => acc + ((parseFloat(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0)), 0).toLocaleString('es-CO')}
                </div>
              </div>

              <button type="submit" disabled={guardandoCompra} className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 disabled:opacity-50">
                {guardandoCompra ? 'GUARDANDO...' : 'CREAR ORDEN DE COMPRA'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Detalle Orden de Compra */}
      {selectedCompra && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white w-full max-w-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <div>
                <h3 className="font-mono text-sm font-bold">{selectedCompra.numero}</h3>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 border ${
                  selectedCompra.estado === 'recibido' ? 'bg-green-100 text-green-800 border-green-400' :
                  selectedCompra.estado === 'cancelado' ? 'bg-neutral-100 text-neutral-500 border-neutral-300' :
                  'bg-brand-yellow/20 text-neutral-700 border-brand-yellow'
                }`}>{selectedCompra.estado.replace('_', ' ').toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-2">
                {!['recibido', 'cancelado'].includes(selectedCompra.estado) && (
                  <button
                    type="button"
                    onClick={() => { openEditCompra(selectedCompra); setSelectedCompra(null); }}
                    className="neo-btn text-xs px-3 py-1.5 flex items-center gap-1.5 hover:bg-neutral-100"
                  >
                    <Pencil size={12} /> Editar OC
                  </button>
                )}
                <button onClick={() => setSelectedCompra(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
              </div>
            </div>

            {/* Info básica */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="font-mono font-bold text-neutral-500">PROVEEDOR:</span> <span className="font-semibold">{suppliers.find(s => s.id === selectedCompra.proveedorId)?.nombre ?? '—'}</span></div>
              <div><span className="font-mono font-bold text-neutral-500">FECHA ESPERADA:</span> <span>{selectedCompra.fechaEsperada ?? '—'}</span></div>
              <div><span className="font-mono font-bold text-neutral-500">TOTAL:</span> <span className="font-bold font-mono">${selectedCompra.total.toLocaleString('es-CO')}</span></div>
              <div><span className="font-mono font-bold text-neutral-500">CxP:</span> <span>{selectedCompra.facturaCompraId ? invoices.find(i => i.id === selectedCompra.facturaCompraId)?.numero ?? selectedCompra.facturaCompraId : 'No generada aún'}</span></div>
            </div>

            {/* Ítems */}
            <div className="flex flex-col gap-1">
              <h4 className="font-mono font-bold text-xs border-b border-black pb-1">ÍTEMS</h4>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-neutral-100 font-mono font-bold text-[10px]">
                    <th className="p-2 text-left">PRODUCTO / CONCEPTO</th>
                    <th className="p-2 text-right">PEDIDO</th>
                    <th className="p-2 text-right">RECIBIDO</th>
                    <th className="p-2 text-right">P. UNIT.</th>
                    <th className="p-2 text-right">SUBTOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCompra.items.map(item => {
                    const prod = item.productoId ? products.find(p => p.id === item.productoId) : null;
                    const recibido = item.cantidadRecibida ?? 0;
                    const pendiente = item.cantidad - recibido;
                    return (
                      <tr key={item.id} className="border-b border-neutral-100">
                        <td className="p-2">{prod?.nombre ?? item.concepto ?? '—'}</td>
                        <td className="p-2 text-right font-mono">{item.cantidad}</td>
                        <td className="p-2 text-right font-mono">
                          <span className={recibido >= item.cantidad ? 'text-green-700 font-bold' : recibido > 0 ? 'text-brand-yellow font-bold' : 'text-neutral-400'}>
                            {recibido}
                          </span>
                          {pendiente > 0 && (
                            <span className="text-[10px] text-neutral-400 ml-1">({pendiente} pend.)</span>
                          )}
                        </td>
                        <td className="p-2 text-right font-mono">${item.precioUnitario.toLocaleString('es-CO')}</td>
                        <td className="p-2 text-right font-mono font-bold">${item.subtotal.toLocaleString('es-CO')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Transiciones disponibles */}
            {TRANSICIONES_VALIDAS_PROVEEDOR[selectedCompra.estado].length > 0 && (
              <div className="flex flex-col gap-2">
                <h4 className="font-mono font-bold text-xs border-b border-black pb-1">CAMBIAR ESTADO</h4>
                <div className="flex flex-wrap gap-2">
                  {TRANSICIONES_VALIDAS_PROVEEDOR[selectedCompra.estado].map(est => (
                    <button
                      key={est}
                      type="button"
                      disabled={transicionandoCompra}
                      onClick={() => void handleTransicionarCompra(selectedCompra, est)}
                      className={`neo-btn text-xs px-3 py-2 font-mono font-bold disabled:opacity-50 ${
                        est === 'cancelado' ? 'hover:bg-red-50 hover:text-brand-red' :
                        est === 'recibido' ? 'bg-green-50 hover:bg-green-100 border-green-600 text-green-800' :
                        'hover:bg-brand-blue/10'
                      }`}
                    >
                      → {est.replace('_', ' ').toUpperCase()}
                      {(est === 'recibido' || est === 'recibido_parcial') && !selectedCompra.facturaCompraId && selectedCompra.proveedorId && ' (crea CxP)'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedCompra.notas && (
              <div className="bg-neutral-50 border border-neutral-200 p-3 text-xs">
                <span className="font-mono font-bold text-neutral-500">NOTAS: </span>{selectedCompra.notas}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Editar Orden de Compra */}
      {editingCompra && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white w-full max-w-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-black pb-2 sticky top-0 bg-white z-10">
              <h3 className="font-mono text-sm font-bold">EDITAR {editingCompra.numero}</h3>
              <button onClick={() => setEditingCompra(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>

            <form onSubmit={(e) => void handleGuardarEditCompra(e)} className="flex flex-col gap-4 text-xs">
              {editCompraError && (
                <div className="bg-red-50 border-2 border-red-500 text-red-700 p-2 font-mono text-xs">{editCompraError}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">PROVEEDOR</label>
                  <select
                    value={editCompraForm.proveedorId}
                    onChange={(e) => setEditCompraForm({ ...editCompraForm, proveedorId: e.target.value })}
                    className="neo-input font-mono"
                  >
                    <option value="">Sin proveedor</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">FECHA ESPERADA</label>
                  <input
                    type="date"
                    value={editCompraForm.fechaEsperada}
                    onChange={(e) => setEditCompraForm({ ...editCompraForm, fechaEsperada: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOTAS</label>
                <textarea rows={2} value={editCompraForm.notas}
                  onChange={(e) => setEditCompraForm({ ...editCompraForm, notas: e.target.value })}
                  className="neo-input resize-y" />
              </div>

              {/* Ítems editables */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-black pb-1">
                  <label className="font-mono font-bold">ÍTEMS</label>
                  <button type="button"
                    onClick={() => setEditCompraForm({ ...editCompraForm, items: [...editCompraForm.items, { productoId: '', concepto: '', esLibre: false, cantidad: '1', precioUnitario: '0' }] })}
                    className="neo-btn text-[10px] px-2 py-1 flex items-center gap-1">
                    <Plus size={10} /> Añadir
                  </button>
                </div>

                {editCompraForm.items.map((item, idx) => (
                  <div key={idx} className="border border-neutral-200 p-3 flex flex-col gap-2 bg-neutral-50">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer">
                        <input type="checkbox" checked={item.esLibre}
                          onChange={(e) => { const u = [...editCompraForm.items]; u[idx] = { ...item, esLibre: e.target.checked }; setEditCompraForm({ ...editCompraForm, items: u }); }}
                          className="w-3 h-3 border border-black accent-black" />
                        Ítem libre
                      </label>
                      <button type="button"
                        onClick={() => setEditCompraForm({ ...editCompraForm, items: editCompraForm.items.filter((_, i) => i !== idx) })}
                        className="neo-btn p-1 hover:bg-red-50 hover:text-brand-red">
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {item.esLibre ? (
                      <input type="text" placeholder="Descripción..." value={item.concepto} required
                        onChange={(e) => { const u = [...editCompraForm.items]; u[idx] = { ...item, concepto: e.target.value }; setEditCompraForm({ ...editCompraForm, items: u }); }}
                        className="neo-input text-xs" />
                    ) : (
                      <select value={item.productoId} required
                        onChange={(e) => { const u = [...editCompraForm.items]; u[idx] = { ...item, productoId: e.target.value }; setEditCompraForm({ ...editCompraForm, items: u }); }}
                        className="neo-input font-mono text-xs">
                        <option value="">Seleccionar producto...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="font-mono text-[10px] font-bold">CANTIDAD</label>
                        <input type="number" min="0.001" step="0.001" required value={item.cantidad}
                          onChange={(e) => { const u = [...editCompraForm.items]; u[idx] = { ...item, cantidad: e.target.value }; setEditCompraForm({ ...editCompraForm, items: u }); }}
                          className="neo-input font-mono text-xs" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="font-mono text-[10px] font-bold">PRECIO UNITARIO</label>
                        <input type="number" min="0" step="1" required value={item.precioUnitario}
                          onChange={(e) => { const u = [...editCompraForm.items]; u[idx] = { ...item, precioUnitario: e.target.value }; setEditCompraForm({ ...editCompraForm, items: u }); }}
                          className="neo-input font-mono text-xs" />
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end text-xs font-mono font-bold border-t border-black pt-2">
                  TOTAL: $
                  {editCompraForm.items.reduce((acc, item) => acc + ((parseFloat(item.cantidad) || 0) * (parseFloat(item.precioUnitario) || 0)), 0).toLocaleString('es-CO')}
                </div>
              </div>

              <button type="submit" disabled={guardandoEditCompra} className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 disabled:opacity-50">
                {guardandoEditCompra ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 6. Modal: Crear/Editar Cuenta Bancaria */}
      {showBankAccountModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-sm w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">
                {editingBankAccount ? 'EDITAR CUENTA BANCARIA' : 'NUEVA CUENTA BANCARIA'}
              </h3>
              <button
                onClick={() => { setShowBankAccountModal(false); resetBankAccountForm(); }}
                className="font-mono font-bold text-lg hover:text-brand-red"
              >
                ×
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveBankAccount(e)} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">BANCO</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Bancolombia"
                  value={bankAccountForm.banco}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, banco: e.target.value })}
                  className="neo-input"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NÚMERO DE CUENTA</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. 123-456789-00"
                  value={bankAccountForm.numero}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, numero: e.target.value })}
                  className="neo-input font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">TIPO</label>
                  <select
                    value={bankAccountForm.tipo}
                    onChange={(e) => setBankAccountForm({ ...bankAccountForm, tipo: e.target.value as 'ahorros' | 'corriente' })}
                    className="neo-input font-mono"
                  >
                    <option value="ahorros">Ahorros</option>
                    <option value="corriente">Corriente</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">SALDO (COP)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={bankAccountForm.saldo}
                    onChange={(e) => setBankAccountForm({ ...bankAccountForm, saldo: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
              </div>

              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2.5 mt-2">
                {editingBankAccount ? 'Guardar cambios' : 'Crear cuenta'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Gestor de Pedido */}
      {orderManager && (() => {
        const ord = orders.find(o => o.id === orderManager.id) ?? orderManager;
        const cxc = invoices.find(i => i.tipo === 'cxc' && i.pedido_id === ord.id);
        const abonosCxc = cxc ? abonos.filter(a => a.factura_id === cxc.id) : [];
        const client = customers.find(c => c.id === ord.cliente_id);
        const todosEstados: Order['estado'][] = ['borrador', 'confirmado', 'en_preparacion', 'despachado', 'entregado', 'cancelado'];
        const otrosEstados = todosEstados.filter(e => e !== ord.estado);

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setOrderManager(null)}>
            <div className="neo-card bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-0" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-start justify-between border-b-2 border-black p-4">
                <div>
                  <h2 className="font-mono font-black text-base text-black">{getOrderDisplayName(ord)}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[10px] text-neutral-500">{ord.numero}</span>
                    <span className={`text-[10px] font-mono font-bold border-[1.5px] border-black px-1.5 py-0.5 ${
                      ord.estado === 'borrador' ? 'bg-neutral-100 text-neutral-700' :
                      ord.estado === 'confirmado' ? 'bg-brand-blue/20 text-brand-blue' :
                      ord.estado === 'en_preparacion' ? 'bg-brand-yellow/20 text-neutral-700' :
                      ord.estado === 'despachado' ? 'bg-brand-blue text-white' :
                      ord.estado === 'entregado' ? 'bg-green-100 text-green-800' :
                      'bg-brand-red text-white'
                    }`}>{ord.estado.replace('_', ' ').toUpperCase()}</span>
                    {client && <span className="text-[10px] text-neutral-500 font-mono">{client.nombre}</span>}
                  </div>
                </div>
                <button onClick={() => setOrderManager(null)} className="font-mono font-bold text-xl hover:text-brand-red shrink-0 ml-4">×</button>
              </div>

              <div className="flex flex-col gap-0 divide-y divide-black/10">

                {/* Items del pedido */}
                <div className="p-4">
                  <div className="font-mono text-[10px] font-bold text-neutral-500 uppercase mb-2">Productos / Cargos</div>
                  <div className="flex flex-col gap-1">
                    {ord.items.map((item, idx) => {
                      const p = item.producto_id ? products.find(pr => pr.id === item.producto_id) : null;
                      const etiqueta = item.producto_id ? (p?.nombre ?? 'Producto') : (item.concepto ?? 'Cargo');
                      return (
                        <div key={idx} className="flex justify-between text-xs">
                          <span>{etiqueta} × {item.cantidad}</span>
                          <span className="font-mono font-bold">${(item.precio * item.cantidad).toLocaleString('es-CO')}</span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between text-sm font-black border-t border-black pt-2 mt-1">
                      <span className="font-mono">TOTAL</span>
                      <span>${ord.total.toLocaleString('es-CO')} COP</span>
                    </div>
                  </div>
                </div>

                {/* Cuenta por cobrar */}
                <div className="p-4 bg-neutral-50">
                  <div className="font-mono text-[10px] font-bold text-neutral-500 uppercase mb-2">Cuenta por Cobrar (CxC)</div>
                  {!cxc ? (
                    <p className="text-xs text-neutral-400 italic font-mono">
                      {ord.cliente_id ? 'No se encontró CxC asociada a este pedido.' : 'Sin cliente asignado — sin CxC.'}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono font-bold text-black">{cxc.numero}</span>
                          <span className="text-neutral-500 font-mono text-[10px]">Vence: {new Date(cxc.fecha_vencimiento).toLocaleDateString('es-CO')}</span>
                        </div>
                        <div className="text-right">
                          <div className={`font-mono font-black text-base ${cxc.saldo_pendiente > 0 ? 'text-brand-red' : 'text-green-700'}`}>
                            ${cxc.saldo_pendiente.toLocaleString('es-CO')}
                          </div>
                          <div className="text-[10px] text-neutral-500 font-mono">saldo pendiente</div>
                        </div>
                      </div>

                      {/* Historial de abonos */}
                      {abonosCxc.length > 0 && (
                        <div className="flex flex-col gap-1 border border-black/10 p-2 bg-white">
                          <span className="font-mono text-[9px] font-bold text-neutral-400 uppercase">Abonos registrados</span>
                          {abonosCxc.map(ab => (
                            <div key={ab.id} className="flex justify-between text-[10px] font-mono">
                              <span className="text-neutral-600">{new Date(ab.fecha).toLocaleDateString('es-CO')}</span>
                              <span className="font-bold text-green-700">+${ab.monto.toLocaleString('es-CO')}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Pagar completo */}
                      {cxc.saldo_pendiente > 0 && (
                        <button
                          type="button"
                          disabled={guardandoAbono}
                          onClick={() => void handleCrearAbono(cxc.id, cxc.saldo_pendiente, true)}
                          className="neo-btn w-full bg-green-700 text-white hover:opacity-90 py-2 font-mono font-bold text-xs disabled:opacity-50"
                        >
                          {guardandoAbono ? 'Procesando...' : `✓ PAGAR COMPLETO — $${cxc.saldo_pendiente.toLocaleString('es-CO')}`}
                        </button>
                      )}

                      {/* Agregar abono parcial */}
                      {cxc.saldo_pendiente > 0 && (
                        <div className="flex flex-col gap-2 border border-black/15 p-3 bg-white">
                          <span className="font-mono text-[10px] font-bold text-neutral-500 uppercase">Agregar abono parcial</span>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="font-mono text-[10px] font-bold">MONTO</label>
                              <input
                                type="number" min="1" step="any"
                                placeholder={`Máx $${cxc.saldo_pendiente.toLocaleString('es-CO')}`}
                                value={abonoForm.monto}
                                onChange={e => setAbonoForm({...abonoForm, monto: e.target.value})}
                                className="neo-input text-xs font-mono py-1.5"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="font-mono text-[10px] font-bold">MEDIO DE PAGO</label>
                              <select value={abonoForm.medioPago} onChange={e => setAbonoForm({...abonoForm, medioPago: e.target.value})} className="neo-input text-xs font-mono py-1.5">
                                <option value="efectivo">Efectivo</option>
                                <option value="transferencia">Transferencia</option>
                                <option value="tarjeta">Tarjeta</option>
                                <option value="cheque">Cheque</option>
                                <option value="nequi">Nequi</option>
                                <option value="daviplata">Daviplata</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="font-mono text-[10px] font-bold">CUENTA DESTINO (opcional)</label>
                            <select value={abonoForm.cuentaBancariaId} onChange={e => setAbonoForm({...abonoForm, cuentaBancariaId: e.target.value})} className="neo-input text-xs font-mono py-1.5">
                              <option value="">— Sin vincular a cuenta —</option>
                              {bankAccounts.map(b => (
                                <option key={b.id} value={b.id}>{b.banco} · {b.numero} (${b.saldo.toLocaleString('es-CO')})</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="font-mono text-[10px] font-bold">REFERENCIA (opcional)</label>
                            <input
                              type="text" placeholder="Nº comprobante, transferencia, etc."
                              value={abonoForm.referencia}
                              onChange={e => setAbonoForm({...abonoForm, referencia: e.target.value})}
                              className="neo-input text-xs py-1.5"
                            />
                          </div>
                          {abonoError && <p className="text-[10px] text-brand-red font-mono">{abonoError}</p>}
                          <button
                            type="button"
                            disabled={guardandoAbono || !abonoForm.monto}
                            onClick={() => void handleCrearAbono(cxc.id, parseFloat(abonoForm.monto) || 0)}
                            className="neo-btn bg-brand-blue text-white hover:opacity-90 py-2 font-mono font-bold text-xs disabled:opacity-50"
                          >
                            {guardandoAbono ? 'Registrando...' : 'REGISTRAR ABONO'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Notas del pedido */}
                <div className="p-4">
                  <div className="font-mono text-[10px] font-bold text-neutral-500 uppercase mb-2">Notas del pedido</div>
                  <textarea
                    rows={3}
                    placeholder="Observaciones, instrucciones de entrega, acuerdos con el cliente..."
                    value={orderManagerNotas}
                    onChange={e => setOrderManagerNotas(e.target.value)}
                    className="neo-input w-full text-xs resize-y font-normal"
                  />
                  <button
                    type="button"
                    disabled={guardandoNotasPedido}
                    onClick={() => void handleGuardarNotasPedido()}
                    className="neo-btn mt-2 px-3 py-1.5 text-xs font-mono font-bold hover:bg-neutral-100 disabled:opacity-50"
                  >
                    {guardandoNotasPedido ? 'Guardando...' : 'Guardar notas'}
                  </button>
                </div>

                {/* Cambiar estado */}
                <div className="p-4 bg-neutral-50">
                  <div className="font-mono text-[10px] font-bold text-neutral-500 uppercase mb-2">Cambiar estado</div>
                  <div className="flex flex-wrap gap-2">
                    {otrosEstados.map(next => (
                      <button
                        key={next}
                        onClick={() => { handleTransitionOrder(ord.id, next); setOrderManager(null); }}
                        className={`font-mono text-[10px] font-bold px-3 py-2 border-2 border-black ${
                          next === 'cancelado' ? 'bg-white text-brand-red hover:bg-red-50'
                          : next === 'entregado' ? 'bg-green-600 text-white hover:bg-green-700'
                          : next === 'despachado' ? 'bg-brand-blue text-white hover:opacity-90'
                          : next === 'en_preparacion' ? 'bg-yellow-400 text-black hover:bg-yellow-500'
                          : next === 'confirmado' ? 'bg-blue-200 text-black hover:bg-blue-300'
                          : 'bg-neutral-200 text-black hover:bg-neutral-300'
                        }`}
                      >
                        → {next.replace(/_/g, ' ').toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 7. Modal: Editar Producto */}
      {editingProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">EDITAR PRODUCTO</h3>
              <button onClick={() => setEditingProduct(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleSaveEditProduct(e)} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">SKU</label>
                <input type="text" value={editProductForm.sku} onChange={(e) => setEditProductForm({ ...editProductForm, sku: e.target.value })} className="neo-input font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">CATEGORÍA</label>
                <select value={editProductForm.categoria_id} onChange={(e) => setEditProductForm({ ...editProductForm, categoria_id: e.target.value })} className="neo-input font-mono">
                  <option value="">Sin categoría</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOMBRE DEL PRODUCTO</label>
                <input type="text" required value={editProductForm.nombre} onChange={(e) => setEditProductForm({ ...editProductForm, nombre: e.target.value })} className="neo-input" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">DESCRIPCIÓN</label>
                <input type="text" value={editProductForm.descripcion} onChange={(e) => setEditProductForm({ ...editProductForm, descripcion: e.target.value })} className="neo-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">PRECIO COSTO (COP)</label>
                  <input type="number" required value={editProductForm.precio_costo} onChange={(e) => setEditProductForm({ ...editProductForm, precio_costo: e.target.value })} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">PRECIO VENTA</label>
                  <input type="number" required value={editProductForm.precio_venta} onChange={(e) => setEditProductForm({ ...editProductForm, precio_venta: e.target.value })} className="neo-input font-mono" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">STOCK MÍNIMO ALERTA</label>
                <input type="number" required value={editProductForm.stock_minimo} onChange={(e) => setEditProductForm({ ...editProductForm, stock_minimo: e.target.value })} className="neo-input font-mono" />
              </div>
              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5">GUARDAR CAMBIOS</button>
            </form>
          </div>
        </div>
      )}

      {/* 7a. Modal: Registrar Entrada de Stock (reabastecimiento manual) */}
      {stockEntryProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black flex items-center gap-2">
                <PackagePlus size={16} />
                ENTRADA DE STOCK
              </h3>
              <button onClick={() => setStockEntryProduct(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <p className="text-xs font-mono text-neutral-600">
              Producto: <span className="font-bold text-black">{stockEntryProduct.nombre}</span>
              {' · '}Stock actual: <span className="font-bold text-black">{productStocks[stockEntryProduct.id] ?? 0}</span>
            </p>
            <form onSubmit={(e) => void handleRegisterStockEntry(e)} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">CANTIDAD A INGRESAR</label>
                <input
                  type="number" min="0.01" step="any" required autoFocus
                  value={stockEntryForm.cantidad}
                  onChange={(e) => setStockEntryForm({ ...stockEntryForm, cantidad: e.target.value })}
                  className="neo-input font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">COSTO UNITARIO (COP) — opcional</label>
                <input
                  type="number" min="0" step="any"
                  placeholder={stockEntryProduct.precio_costo ? `Catálogo: $${stockEntryProduct.precio_costo.toLocaleString('es-CO')}` : undefined}
                  value={stockEntryForm.precio_costo}
                  onChange={(e) => setStockEntryForm({ ...stockEntryForm, precio_costo: e.target.value })}
                  className="neo-input font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOTAS (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej. Compra a proveedor X, factura #123"
                  value={stockEntryForm.notas}
                  onChange={(e) => setStockEntryForm({ ...stockEntryForm, notas: e.target.value })}
                  className="neo-input"
                />
              </div>
              {stockEntryError && <p className="text-brand-red font-mono text-[10px]">{stockEntryError}</p>}
              <button type="submit" disabled={registrandoEntrada} className="neo-btn bg-emerald-600 text-white hover:opacity-90 mt-2 py-2.5 disabled:opacity-50">
                {registrandoEntrada ? 'REGISTRANDO...' : 'REGISTRAR ENTRADA'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 7b. Modal: Administrar Categorías — crear, renombrar y eliminar en un solo lugar */}
      {showCategoryAdmin && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black flex items-center gap-2">
                <Tag size={16} />
                ADMINISTRAR CATEGORÍAS
              </h3>
              <button onClick={() => setShowCategoryAdmin(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-mono font-bold text-xs">NUEVA CATEGORÍA</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Ej. Calzado"
                  value={adminCategoryName}
                  onChange={(e) => setAdminCategoryName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreateCategoryAdmin(); } }}
                  className="neo-input font-mono flex-1 text-xs"
                />
                <button
                  type="button"
                  disabled={creandoCategoriaAdmin}
                  onClick={() => void handleCreateCategoryAdmin()}
                  className="neo-btn bg-brand-blue text-white hover:opacity-90 px-4 text-xs disabled:opacity-50"
                >
                  {creandoCategoriaAdmin ? 'Creando...' : 'Crear'}
                </button>
              </div>
              {categoryAdminError && <p className="text-brand-red font-mono text-[10px]">{categoryAdminError}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="font-mono font-bold text-xs border-b border-black pb-1.5">CATEGORÍAS EXISTENTES ({categories.length})</span>
              {categories.length === 0 ? (
                <p className="text-xs text-neutral-500 font-mono py-2">Todavía no has creado ninguna categoría.</p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
                  {categories.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 border border-black px-2.5 py-1.5 bg-neutral-50 text-xs">
                      {editingCategoryId === c.id ? (
                        <>
                          <input
                            type="text"
                            autoFocus
                            value={editCategoryName}
                            onChange={(e) => setEditCategoryName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveEditCategory(c.id); }}
                            className="neo-input font-mono py-1 px-1.5 text-xs flex-1"
                          />
                          <button type="button" onClick={() => void handleSaveEditCategory(c.id)} className="font-mono font-bold hover:text-green-700 px-1" title="Guardar">✓</button>
                          <button type="button" onClick={() => setEditingCategoryId(null)} className="font-mono font-bold hover:text-brand-red px-1" title="Cancelar">×</button>
                        </>
                      ) : (
                        <>
                          <span className="text-black font-semibold flex-1">{c.nombre}</span>
                          <span className="text-[10px] text-neutral-400 font-mono">
                            {products.filter((p) => p.categoria_id === c.id).length} prod.
                          </span>
                          <button type="button" onClick={() => openEditCategory(c)} className="hover:text-brand-blue px-1" title="Renombrar categoría">
                            <Pencil size={13} />
                          </button>
                          <button type="button" onClick={() => void handleDeleteCategory(c)} className="hover:text-brand-red px-1" title="Eliminar categoría">
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Crear Cliente */}
      {showCreateCustomer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">CREAR CLIENTE</h3>
              <button onClick={() => setShowCreateCustomer(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleCreateCustomer(e)} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOMBRE</label>
                <input type="text" required value={newCustomerForm.nombre} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, nombre: e.target.value })} className="neo-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">INFO DE CONTACTO</label>
                  <input
                    type="text"
                    placeholder="Ej. WPP 3001234567 / IG @usuario"
                    value={newCustomerForm.nit}
                    onChange={(e) => setNewCustomerForm({ ...newCustomerForm, nit: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">TELÉFONO</label>
                  <input type="text" value={newCustomerForm.telefono} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, telefono: e.target.value })} className="neo-input font-mono" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">EMAIL</label>
                <input type="email" value={newCustomerForm.email} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })} className="neo-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">DIRECCIÓN</label>
                  <input type="text" value={newCustomerForm.direccion} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, direccion: e.target.value })} className="neo-input" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">CIUDAD</label>
                  <input type="text" value={newCustomerForm.ciudad} onChange={(e) => setNewCustomerForm({ ...newCustomerForm, ciudad: e.target.value })} className="neo-input" />
                </div>
              </div>

              {createCustomerError && (
                <div className="border border-brand-red bg-red-50 p-2.5 text-[11px] text-brand-red font-mono">
                  {createCustomerError}
                </div>
              )}

              <button type="submit" disabled={creandoCliente} className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5 disabled:opacity-50">
                {creandoCliente ? 'CREANDO...' : 'CREAR CLIENTE'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Crear Proveedor */}
      {showCreateSupplier && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">CREAR PROVEEDOR</h3>
              <button onClick={() => setShowCreateSupplier(false)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleCreateSupplier(e)} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOMBRE / RAZÓN SOCIAL</label>
                <input type="text" required value={newSupplierForm.nombre} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, nombre: e.target.value })} className="neo-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">NIT</label>
                  <input type="text" value={newSupplierForm.nit} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, nit: e.target.value })} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">CONTACTO</label>
                  <input type="text" value={newSupplierForm.contacto} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, contacto: e.target.value })} className="neo-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">TELÉFONO</label>
                  <input type="text" value={newSupplierForm.telefono} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, telefono: e.target.value })} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">EMAIL</label>
                  <input type="email" value={newSupplierForm.email} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, email: e.target.value })} className="neo-input" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">DIRECCIÓN</label>
                <input type="text" value={newSupplierForm.direccion} onChange={(e) => setNewSupplierForm({ ...newSupplierForm, direccion: e.target.value })} className="neo-input" />
              </div>

              {createSupplierError && (
                <div className="border border-brand-red bg-red-50 p-2.5 text-[11px] text-brand-red font-mono">
                  {createSupplierError}
                </div>
              )}

              <button type="submit" disabled={creandoProveedor} className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5 disabled:opacity-50">
                {creandoProveedor ? 'CREANDO...' : 'CREAR PROVEEDOR'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 8. Modal: Editar Cliente */}
      {editingCustomer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">EDITAR CLIENTE</h3>
              <button onClick={() => setEditingCustomer(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleSaveEditCustomer(e)} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOMBRE</label>
                <input type="text" required value={editCustomerForm.nombre} onChange={(e) => setEditCustomerForm({ ...editCustomerForm, nombre: e.target.value })} className="neo-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">INFO DE CONTACTO</label>
                  <input
                    type="text"
                    placeholder="Ej. WPP 3001234567 / IG @usuario"
                    value={editCustomerForm.nit}
                    onChange={(e) => setEditCustomerForm({ ...editCustomerForm, nit: e.target.value })}
                    className="neo-input font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">TELÉFONO</label>
                  <input type="text" value={editCustomerForm.telefono} onChange={(e) => setEditCustomerForm({ ...editCustomerForm, telefono: e.target.value })} className="neo-input font-mono" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">EMAIL</label>
                <input type="email" value={editCustomerForm.email} onChange={(e) => setEditCustomerForm({ ...editCustomerForm, email: e.target.value })} className="neo-input" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">DIRECCIÓN</label>
                <input type="text" value={editCustomerForm.direccion} onChange={(e) => setEditCustomerForm({ ...editCustomerForm, direccion: e.target.value })} className="neo-input" />
              </div>
              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5">GUARDAR CAMBIOS</button>
            </form>
          </div>
        </div>
      )}

      {/* 9. Modal: Editar Proveedor */}
      {editingSupplier && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">EDITAR PROVEEDOR</h3>
              <button onClick={() => setEditingSupplier(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleSaveEditSupplier(e)} className="flex flex-col gap-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOMBRE / RAZÓN SOCIAL</label>
                <input type="text" required value={editSupplierForm.nombre} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, nombre: e.target.value })} className="neo-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">NIT</label>
                  <input type="text" value={editSupplierForm.nit} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, nit: e.target.value })} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">CONTACTO</label>
                  <input type="text" value={editSupplierForm.contacto} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, contacto: e.target.value })} className="neo-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">TELÉFONO</label>
                  <input type="text" value={editSupplierForm.telefono} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, telefono: e.target.value })} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">EMAIL</label>
                  <input type="email" value={editSupplierForm.email} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, email: e.target.value })} className="neo-input" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">DIRECCIÓN</label>
                <input type="text" value={editSupplierForm.direccion} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, direccion: e.target.value })} className="neo-input" />
              </div>
              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5">GUARDAR CAMBIOS</button>
            </form>
          </div>
        </div>
      )}

      {/* 10. Modal: Editar Pedido (solo cliente y notas — el resto sigue su propio flujo de estados) */}
      {editingOrder && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">EDITAR PEDIDO {editingOrder.numero}</h3>
              <button onClick={() => setEditingOrder(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleSaveEditOrder(e)} className="flex flex-col gap-3.5 text-xs">
              <p className="text-[11px] text-neutral-500 font-mono">El estado, los ítems y el total se gestionan desde sus propios flujos — aquí solo puedes ajustar el cliente asociado y las notas.</p>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">CLIENTE</label>
                <select value={editOrderForm.cliente_id} onChange={(e) => setEditOrderForm({ ...editOrderForm, cliente_id: e.target.value })} className="neo-input font-mono">
                  <option value="">Sin cliente asociado</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOTAS</label>
                <textarea value={editOrderForm.notas} onChange={(e) => setEditOrderForm({ ...editOrderForm, notas: e.target.value })} className="neo-input min-h-[72px]" />
              </div>
              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5">GUARDAR CAMBIOS</button>
            </form>
          </div>
        </div>
      )}

      {/* 11. Modal: Editar Factura (solo vencimiento y notas — saldo/estado siempre los calcula el servidor) */}
      {editingInvoice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-md w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">EDITAR FACTURA {editingInvoice.numero}</h3>
              <button onClick={() => setEditingInvoice(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleSaveEditInvoice(e)} className="flex flex-col gap-3.5 text-xs">
              <p className="text-[11px] text-neutral-500 font-mono">El total, el saldo y el estado los recalcula siempre el servidor — aquí solo puedes ajustar la fecha de vencimiento y las notas.</p>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">FECHA DE VENCIMIENTO</label>
                <input type="date" required value={editInvoiceForm.fecha_vencimiento} onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, fecha_vencimiento: e.target.value })} className="neo-input font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">NOTAS</label>
                <textarea value={editInvoiceForm.notas} onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, notas: e.target.value })} className="neo-input min-h-[72px]" />
              </div>
              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5">GUARDAR CAMBIOS</button>
            </form>
          </div>
        </div>
      )}

      {/* 12. Modal: Editar Abono (solo medio de pago, referencia y fecha — NUNCA el monto) */}
      {editingAbono && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="neo-card bg-white max-w-sm w-full flex flex-col gap-4 relative">
            <div className="flex justify-between items-center border-b border-black pb-2">
              <h3 className="font-mono text-sm font-bold text-black">EDITAR ABONO</h3>
              <button onClick={() => setEditingAbono(null)} className="font-mono font-bold text-lg hover:text-brand-red">×</button>
            </div>
            <form onSubmit={(e) => void handleSaveEditAbono(e)} className="flex flex-col gap-3.5 text-xs">
              <p className="text-[11px] text-neutral-500 font-mono">El monto de un abono no se puede editar — si fue un error, elimínalo (puedes deshacerlo) y registra uno nuevo.</p>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">MONTO</label>
                <input type="text" disabled value={`$${editingAbono.monto.toLocaleString('es-CO')} COP`} className="neo-input font-mono bg-neutral-100 text-neutral-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">MEDIO DE PAGO</label>
                  <input type="text" placeholder="Ej. Transferencia" value={editAbonoForm.medio_pago} onChange={(e) => setEditAbonoForm({ ...editAbonoForm, medio_pago: e.target.value })} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono font-bold">FECHA</label>
                  <input type="date" value={editAbonoForm.fecha} onChange={(e) => setEditAbonoForm({ ...editAbonoForm, fecha: e.target.value })} className="neo-input font-mono" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono font-bold">REFERENCIA</label>
                <input type="text" value={editAbonoForm.referencia} onChange={(e) => setEditAbonoForm({ ...editAbonoForm, referencia: e.target.value })} className="neo-input font-mono" />
              </div>
              <button type="submit" className="neo-btn bg-brand-blue text-white hover:opacity-90 mt-2 py-2.5">GUARDAR CAMBIOS</button>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: CxP ABONO ─────────────────────────────────────────────── */}
      {showCxpAbonoModal && selectedCxpInvoice && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-2 border-black w-full max-w-md shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="border-b-2 border-black p-4 flex justify-between items-center">
              <h3 className="font-mono text-sm font-bold">REGISTRAR PAGO · {selectedCxpInvoice.numero}</h3>
              <button onClick={() => setShowCxpAbonoModal(false)} className="neo-btn p-1">✕</button>
            </div>
            <form onSubmit={(e) => void handleCxpAbono(e)} className="p-4 flex flex-col gap-3">
              <div className="flex justify-between text-xs font-mono bg-neutral-50 border border-neutral-200 p-3">
                <span>Total factura: <strong>${selectedCxpInvoice.total.toLocaleString('es-CO')}</strong></span>
                <span>Saldo pendiente: <strong className="text-brand-red">${selectedCxpInvoice.saldo.toLocaleString('es-CO')}</strong></span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">MONTO A PAGAR *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={selectedCxpInvoice.saldo}
                  value={cxpAbonoForm.monto}
                  onChange={e => setCxpAbonoForm(f => ({ ...f, monto: e.target.value }))}
                  className="neo-input font-mono"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">MEDIO DE PAGO</label>
                <select value={cxpAbonoForm.medioPago} onChange={e => setCxpAbonoForm(f => ({ ...f, medioPago: e.target.value }))} className="neo-input font-mono">
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">CUENTA BANCARIA (opcional)</label>
                <select value={cxpAbonoForm.cuentaBancariaId} onChange={e => setCxpAbonoForm(f => ({ ...f, cuentaBancariaId: e.target.value }))} className="neo-input font-mono">
                  <option value="">— Sin descontar de cuenta —</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.banco} · {b.numero} (${b.saldo.toLocaleString('es-CO')})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">REFERENCIA</label>
                <input type="text" value={cxpAbonoForm.referencia} onChange={e => setCxpAbonoForm(f => ({ ...f, referencia: e.target.value }))} className="neo-input" placeholder="Número de transferencia, cheque..." />
              </div>
              {cxpAbonoError && <p className="text-xs text-brand-red font-mono">{cxpAbonoError}</p>}
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={guardandoCxpAbono} className="neo-btn-secondary flex-1 py-2 font-bold">
                  {guardandoCxpAbono ? 'Registrando…' : '✓ Registrar Pago'}
                </button>
                <button type="button" onClick={() => setShowCxpAbonoModal(false)} className="neo-btn flex-1 py-2">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: TRANSFERENCIA BANCARIA ────────────────────────────────── */}
      {showTransferenciaModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-2 border-black w-full max-w-md shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="border-b-2 border-black p-4 flex justify-between items-center">
              <h3 className="font-mono text-sm font-bold">TRANSFERENCIA ENTRE CUENTAS</h3>
              <button onClick={() => { setShowTransferenciaModal(false); setTransferenciaError(null); }} className="neo-btn p-1">✕</button>
            </div>
            <form onSubmit={(e) => void handleCrearTransferencia(e)} className="p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">CUENTA ORIGEN *</label>
                <select
                  value={transferenciaForm.cuentaOrigenId}
                  onChange={e => setTransferenciaForm(f => ({ ...f, cuentaOrigenId: e.target.value }))}
                  className="neo-input font-mono"
                  required
                >
                  <option value="">— Selecciona cuenta de origen —</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.banco} · {b.numero} (${b.saldo.toLocaleString('es-CO')})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">CUENTA DESTINO *</label>
                <select
                  value={transferenciaForm.cuentaDestinoId}
                  onChange={e => setTransferenciaForm(f => ({ ...f, cuentaDestinoId: e.target.value }))}
                  className="neo-input font-mono"
                  required
                >
                  <option value="">— Selecciona cuenta de destino —</option>
                  {bankAccounts.filter(b => b.id !== transferenciaForm.cuentaOrigenId).map(b => (
                    <option key={b.id} value={b.id}>{b.banco} · {b.numero} (${b.saldo.toLocaleString('es-CO')})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">MONTO *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={transferenciaForm.monto}
                  onChange={e => setTransferenciaForm(f => ({ ...f, monto: e.target.value }))}
                  className="neo-input font-mono"
                  required
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">DESCRIPCIÓN</label>
                <input
                  type="text"
                  value={transferenciaForm.descripcion}
                  onChange={e => setTransferenciaForm(f => ({ ...f, descripcion: e.target.value }))}
                  className="neo-input"
                  placeholder="Ej: Traslado para pago de nómina"
                />
              </div>
              {transferenciaError && <p className="text-xs text-brand-red font-mono">{transferenciaError}</p>}
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={guardandoTransferencia} className="neo-btn-secondary flex-1 py-2 font-bold">
                  {guardandoTransferencia ? 'Transfiriendo…' : '⇌ Confirmar Transferencia'}
                </button>
                <button type="button" onClick={() => { setShowTransferenciaModal(false); setTransferenciaError(null); }} className="neo-btn flex-1 py-2">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: GASTO OPERATIVO ───────────────────────────────────────── */}
      {showGastoModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-2 border-black w-full max-w-md shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="border-b-2 border-black p-4 flex justify-between items-center">
              <h3 className="font-mono text-sm font-bold">REGISTRAR GASTO OPERATIVO</h3>
              <button onClick={() => setShowGastoModal(false)} className="neo-btn p-1">✕</button>
            </div>
            <form onSubmit={(e) => void handleCrearGasto(e)} className="p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">DESCRIPCIÓN *</label>
                <input
                  type="text"
                  value={gastoForm.descripcion}
                  onChange={e => setGastoForm(f => ({ ...f, descripcion: e.target.value }))}
                  className="neo-input"
                  placeholder="Ej: Arriendo local mes de junio"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">CATEGORÍA</label>
                  <select value={gastoForm.categoria} onChange={e => setGastoForm(f => ({ ...f, categoria: e.target.value as CategoriaGasto }))} className="neo-input font-mono text-sm">
                    {CATEGORIAS_GASTO_LOCAL.map(c => (
                      <option key={c} value={c}>{LABEL_CATEGORIA_GASTO[c]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">MONTO *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={gastoForm.monto}
                    onChange={e => setGastoForm(f => ({ ...f, monto: e.target.value }))}
                    className="neo-input font-mono"
                    required
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">FECHA</label>
                  <input type="date" value={gastoForm.fecha} onChange={e => setGastoForm(f => ({ ...f, fecha: e.target.value }))} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">MEDIO DE PAGO</label>
                  <select value={gastoForm.medioPago} onChange={e => setGastoForm(f => ({ ...f, medioPago: e.target.value }))} className="neo-input font-mono text-sm">
                    <option value="">— Sin especificar —</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">DESCONTAR DE CUENTA BANCARIA</label>
                <select value={gastoForm.cuentaBancariaId} onChange={e => setGastoForm(f => ({ ...f, cuentaBancariaId: e.target.value }))} className="neo-input font-mono">
                  <option value="">— No descontar —</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.banco} · {b.numero} (${b.saldo.toLocaleString('es-CO')})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">NOTAS</label>
                <textarea value={gastoForm.notas} onChange={e => setGastoForm(f => ({ ...f, notas: e.target.value }))} className="neo-input resize-none h-16" placeholder="Observaciones adicionales..." />
              </div>
              {gastoFormError && <p className="text-xs text-brand-red font-mono">{gastoFormError}</p>}
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={guardandoGasto} className="neo-btn-secondary flex-1 py-2 font-bold">
                  {guardandoGasto ? 'Registrando…' : '+ Registrar Gasto'}
                </button>
                <button type="button" onClick={() => setShowGastoModal(false)} className="neo-btn flex-1 py-2">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: INGRESO BANCARIO ──────────────────────────────────────── */}
      {showIngresoModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-2 border-black w-full max-w-md shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="border-b-2 border-black p-4 flex justify-between items-center">
              <h3 className="font-mono text-sm font-bold">REGISTRAR INGRESO BANCARIO</h3>
              <button onClick={() => setShowIngresoModal(false)} className="neo-btn p-1">✕</button>
            </div>
            <form onSubmit={(e) => void handleCrearIngreso(e)} className="p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">DESCRIPCIÓN *</label>
                <input
                  type="text"
                  value={ingresoForm.descripcion}
                  onChange={e => setIngresoForm(f => ({ ...f, descripcion: e.target.value }))}
                  className="neo-input"
                  placeholder="Ej: Aporte de capital inicial"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">CATEGORÍA</label>
                  <select value={ingresoForm.categoria} onChange={e => setIngresoForm(f => ({ ...f, categoria: e.target.value as CategoriaIngreso }))} className="neo-input font-mono text-sm">
                    {CATEGORIAS_INGRESO_LOCAL.map(c => (
                      <option key={c} value={c}>{c.replace('_', ' ').toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">MONTO *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={ingresoForm.monto}
                    onChange={e => setIngresoForm(f => ({ ...f, monto: e.target.value }))}
                    className="neo-input font-mono"
                    required
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">FECHA</label>
                  <input type="date" value={ingresoForm.fecha} onChange={e => setIngresoForm(f => ({ ...f, fecha: e.target.value }))} className="neo-input font-mono" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-xs font-bold">MEDIO DE PAGO</label>
                  <select value={ingresoForm.medioPago} onChange={e => setIngresoForm(f => ({ ...f, medioPago: e.target.value }))} className="neo-input font-mono text-sm">
                    <option value="">— Sin especificar —</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">ACREDITAR A CUENTA *</label>
                <select value={ingresoForm.cuentaBancariaId} onChange={e => setIngresoForm(f => ({ ...f, cuentaBancariaId: e.target.value }))} className="neo-input font-mono" required>
                  <option value="">— Selecciona cuenta —</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.banco} · {b.numero} (${b.saldo.toLocaleString('es-CO')})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-mono text-xs font-bold">NOTAS</label>
                <textarea value={ingresoForm.notas} onChange={e => setIngresoForm(f => ({ ...f, notas: e.target.value }))} className="neo-input resize-none h-16" placeholder="Observaciones adicionales..." />
              </div>
              {ingresoFormError && <p className="text-xs text-brand-red font-mono">{ingresoFormError}</p>}
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={guardandoIngreso} className="neo-btn-secondary flex-1 py-2 font-bold">
                  {guardandoIngreso ? 'Registrando…' : '+ Registrar Ingreso'}
                </button>
                <button type="button" onClick={() => setShowIngresoModal(false)} className="neo-btn flex-1 py-2">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: RECEPCIÓN OC CON CANTIDADES ───────────────────────────── */}
      {showRecepcionModal && recepcionTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-2 border-black w-full max-w-lg shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
            <div className="border-b-2 border-black p-4 flex justify-between items-center">
              <div>
                <h3 className="font-mono text-sm font-bold">RECEPCIÓN {recepcionTarget.estado === 'recibido_parcial' ? 'PARCIAL' : 'TOTAL'}</h3>
                <p className="text-[10px] text-neutral-500 font-mono">OC {recepcionTarget.compra.numero} — Ingresa las cantidades recibidas</p>
              </div>
              <button onClick={() => { setShowRecepcionModal(false); setRecepcionTarget(null); }} className="neo-btn p-1">✕</button>
            </div>
            <div className="p-4 flex flex-col gap-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold">
                    <th className="p-2 text-left">ÍTEM</th>
                    <th className="p-2 text-center">PEDIDO</th>
                    <th className="p-2 text-center">YA RECIBIDO</th>
                    <th className="p-2 text-center">RECIBIR AHORA</th>
                  </tr>
                </thead>
                <tbody>
                  {recepcionTarget.compra.items.map(item => {
                    const label = item.productoId
                      ? (products.find(p => p.id === item.productoId)?.nombre ?? item.productoId.slice(0, 8))
                      : (item.concepto ?? '—');
                    const pendiente = item.cantidad - (item.cantidadRecibida ?? 0);
                    return (
                      <tr key={item.id} className="border-b border-neutral-200">
                        <td className="p-2 font-semibold">{label}</td>
                        <td className="p-2 text-center font-mono">{item.cantidad}</td>
                        <td className="p-2 text-center font-mono text-neutral-500">{item.cantidadRecibida ?? 0}</td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            max={pendiente}
                            value={recepcionCantidades[item.id] ?? ''}
                            onChange={e => setRecepcionCantidades(prev => ({ ...prev, [item.id]: e.target.value }))}
                            className="neo-input font-mono text-center w-24"
                            placeholder={`máx ${pendiente}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={guardandoRecepcion}
                  onClick={() => void handleConfirmarRecepcion()}
                  className="neo-btn-secondary flex-1 py-2 font-bold text-sm"
                >
                  {guardandoRecepcion ? 'Registrando…' : `Confirmar Recepción ${recepcionTarget.estado === 'recibido_parcial' ? 'Parcial' : 'Total'}`}
                </button>
                <button type="button" onClick={() => { setShowRecepcionModal(false); setRecepcionTarget(null); }} className="neo-btn py-2 px-4">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: PAPELERA ──────────────────────────────────────────────── */}
      {showPapelera && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border-2 border-black w-full max-w-2xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col max-h-[90vh]">
            <div className="border-b-2 border-black p-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-mono text-sm font-bold">🗑 PAPELERA</h3>
                <p className="text-[10px] text-neutral-500 font-mono">Elementos eliminados recientemente — puedes restaurarlos.</p>
              </div>
              <button onClick={() => setShowPapelera(false)} className="neo-btn p-1">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {!papeleraCargando && papeleraItems.length === 0 && (
                <p className="text-xs text-neutral-500 font-mono text-center py-8">La papelera está vacía.</p>
              )}
              {papeleraCargando && <p className="text-xs font-mono text-neutral-500 p-4">Cargando…</p>}
              {papeleraError && <p className="text-xs text-brand-red font-mono p-4">{papeleraError}</p>}
              <div className="flex flex-col gap-2">
                {papeleraItems.map(item => (
                  <div key={`${item.entidad}-${item.id}`} className="flex items-center justify-between border border-neutral-200 bg-neutral-50 px-3 py-2 gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-black truncate">{item.etiqueta}</div>
                      <div className="text-[10px] text-neutral-500 font-mono">{item.entidad} · eliminado {new Date(item.eliminadoEn).toLocaleDateString('es-CO')}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRestaurarDePapelera(item.entidad, item.id)}
                      className="neo-btn-secondary text-[10px] px-2 py-1 shrink-0"
                    >
                      Restaurar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── POPUP: Evento de calendario ── */}
      {eventoPopup && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => setEventoPopup(null)}>
          <div className="bg-white border-2 border-black w-full max-w-md flex flex-col gap-0 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.8)]" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b-2 border-black ${
              eventoPopup.tipo === 'nota' ? 'bg-brand-yellow/30' :
              eventoPopup.tipo === 'recordatorio' ? 'bg-brand-blue/20' : 'bg-brand-red/15'
            }`}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold border border-black px-1.5 py-0.5 bg-white">{eventoPopup.tipo.toUpperCase()}</span>
                {eventoPopup.canal === 'instagram' && <Instagram size={14} />}
                {eventoPopup.canal === 'facebook' && <Facebook size={14} />}
                {eventoPopup.canal === 'tiktok' && <TikTokIcon size={14} />}
                <span className="font-mono text-xs text-neutral-500">{new Date(eventoPopup.fecha).toLocaleDateString('es-CO')}</span>
              </div>
              <button type="button" onClick={() => setEventoPopup(null)} className="text-neutral-500 hover:text-black text-lg leading-none font-bold">×</button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              {/* Título */}
              <h3 className="font-black text-base text-black">{eventoPopup.titulo}</h3>
              {/* Estado */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-neutral-500 uppercase">Estado:</span>
                {ESTADO_ANTERIOR_LOCAL[eventoPopup.estado] !== null && (
                  <button type="button" onClick={() => {
                    const ant = ESTADO_ANTERIOR_LOCAL[eventoPopup.estado];
                    if (ant) void handlePopupCambiarEstado(eventoPopup, ant);
                  }} className="text-neutral-400 hover:text-black font-bold">‹</button>
                )}
                <span className={`font-mono text-[9px] font-bold border-[1.5px] border-black px-2 py-1 ${
                  eventoPopup.estado === 'idea' ? 'bg-neutral-100 text-neutral-600' :
                  eventoPopup.estado === 'grabado' ? 'bg-orange-100 text-orange-700' :
                  eventoPopup.estado === 'editado' ? 'bg-brand-yellow/30 text-neutral-700' :
                  eventoPopup.estado === 'subido' || eventoPopup.estado === 'hecho' ? 'bg-green-100 text-green-700' :
                  'bg-white text-neutral-600'
                }`}>{eventoPopup.estado.toUpperCase()}</span>
                {TRANSICIONES_EVENTO_LOCAL[eventoPopup.estado] !== null && (
                  <button type="button" onClick={() => {
                    const sig = TRANSICIONES_EVENTO_LOCAL[eventoPopup.estado];
                    if (sig) void handlePopupCambiarEstado(eventoPopup, sig);
                  }} className="text-neutral-400 hover:text-black font-bold">›</button>
                )}
              </div>
              {/* Notas / Descripción */}
              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[9px] font-bold text-neutral-500 uppercase">Notas</label>
                <textarea
                  rows={4}
                  value={eventoPopupDesc}
                  onChange={e => setEventoPopupDesc(e.target.value)}
                  placeholder="Agrega notas, ideas, detalles..."
                  className="neo-input text-xs resize-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handleGuardarEventoDesc()}
                  disabled={eventoPopupGuardando}
                  className="neo-btn-primary text-[11px] py-1.5 self-end px-4"
                >
                  {eventoPopupGuardando ? 'Guardando...' : 'Guardar notas'}
                </button>
              </div>
            </div>
            {/* Footer */}
            <div className="border-t-2 border-black px-4 py-2.5 flex justify-between items-center bg-neutral-50">
              <button type="button" onClick={() => { void handleDeleteCalendarEvent(eventoPopup.id); setEventoPopup(null); }}
                className="text-xs font-mono text-brand-red hover:underline flex items-center gap-1">
                <Trash2 size={12} /> Eliminar
              </button>
              <button type="button" onClick={() => setEventoPopup(null)} className="neo-btn text-xs px-3 py-1">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── POPUP: Nota interna (desde dashboard) ── */}
      {notaPopup && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => setNotaPopup(null)}>
          <div className="bg-white border-2 border-black w-full max-w-md flex flex-col shadow-[6px_6px_0px_0px_rgba(0,0,0,0.8)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b-2 border-black bg-brand-yellow/20">
              <div className="flex items-center gap-2">
                <StickyNote size={14} />
                <span className="font-mono text-xs font-bold">NOTA</span>
              </div>
              <button type="button" onClick={() => setNotaPopup(null)} className="text-neutral-500 hover:text-black text-lg font-bold leading-none">×</button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                {notaPopup.tieneCheckbox && (
                  <button type="button" onClick={() => { void handleToggleNotaCompletada(notaPopup); setNotaPopup({ ...notaPopup, completada: !notaPopup.completada }); }}
                    className={`shrink-0 w-4 h-4 border-2 border-black flex items-center justify-center ${notaPopup.completada ? 'bg-black' : 'bg-white'}`}>
                    {notaPopup.completada && <span className="text-white text-[9px] font-black leading-none">✓</span>}
                  </button>
                )}
                <h3 className={`font-black text-base ${notaPopup.completada ? 'line-through opacity-50' : ''}`}>{notaPopup.titulo}</h3>
              </div>
              {notaPopup.contenido && (
                <p className="text-sm text-neutral-700 font-mono whitespace-pre-wrap leading-relaxed border-l-4 border-brand-yellow pl-3">{notaPopup.contenido}</p>
              )}
              <p className="font-mono text-[9px] text-neutral-400">{new Date(notaPopup.createdAt).toLocaleDateString('es-CO')}</p>
            </div>
            <div className="border-t-2 border-black px-4 py-2.5 flex justify-end bg-neutral-50">
              <button type="button" onClick={() => setNotaPopup(null)} className="neo-btn text-xs px-3 py-1">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast global de "deshacer" — aparece tras eliminar cualquier elemento de cualquier módulo */}
      {undoToast && (
        <div className="fixed bottom-6 right-6 z-[60] neo-card bg-black text-white max-w-sm w-full sm:w-auto flex items-center gap-4 py-3 px-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.4)]">
          <span className="text-xs font-mono leading-snug">{undoToast.mensaje}</span>
          <button
            type="button"
            onClick={() => void handleDeshacer()}
            className="neo-btn bg-white text-black hover:bg-neutral-200 text-[11px] py-1.5 px-3 shrink-0 whitespace-nowrap"
          >
            DESHACER
          </button>
        </div>
      )}

      {/* Burbuja IA flotante — contexto dinámico según tab activo */}
      {!superAdminMode && (
        <AiChat
          context={
            activeTab === 'pedidos' ? 'pedidos' :
            activeTab === 'inventario' ? 'inventario' :
            activeTab === 'crm' ? 'clientes' :
            activeTab === 'finanzas' ? 'finanzas' :
            activeTab === 'comunicaciones' && comunicacionesSubTab === 'redes' ? 'redes' :
            activeTab === 'comunicaciones' && comunicacionesSubTab === 'notas' ? 'notas' :
            'general'
          }
        />
      )}
    </main>
  );
}

// Icono ausente de Lucide re-declarado para evitar crashes
function ClockAlert({ size = 16, className = "" }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
      <path d="m21.7 17.6-.7-1a2 2 0 0 0-2.8 0l-.8.8" />
    </svg>
  );
}
