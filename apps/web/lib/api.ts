import type { Abono, CategoriaGasto, CategoriaIngreso, Categoria, Cliente, CuentaBancaria, EntidadCrm, EstadoEventoCalendario, EstadoPedido, EstadoPedidoProveedor, EventoCalendario, Factura, GastoOperativo, IngresoBancario, IgComentario, IgCuenta, IgHashtagStat, IgHeatmapPunto, IgPost, IgPostDetalle, IgPostSnapshot, IgResumen, IgRun, IgSnapshotPerfil, MovimientoInventario, NotaCrm, NotaInterna, Pedido, PedidoProveedor, PlanId, Producto, Proveedor, ResumenFinanciero, Tenant, TipoCuentaBancaria, TipoEventoCalendario, TipoFactura, TransferenciaBancaria, Usuario } from '@antigravity/shared'

/** Un elemento en la papelera — puede ser de cualquier módulo (ver `EntidadPapelera` en la API). */
export interface ItemPapelera {
  entidad: string
  id: string
  etiqueta: string
  eliminadoEn: string
}

/** Info mínima del tenant — la incluye `/auth/me` cuando el usuario pertenece a una empresa. */
type TenantDeSesion = Pick<Tenant, 'id' | 'name' | 'slug' | 'status'> & { plan: PlanId }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/**
 * Las miniaturas de Instagram (thumbnailUrl/displayUrl de ig_posts) apuntan
 * directo al CDN de Instagram, que bloquea hotlinking desde otros dominios —
 * por eso se ven rotas si se usan tal cual en un <img src>. Esta función
 * arma la URL del proxy del backend (`GET /redes/ig/img-proxy`) que las
 * redescarga server-side y las re-sirve sin ese bloqueo.
 */
export function imgProxyUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return `${API_URL}/redes/ig/img-proxy?url=${encodeURIComponent(url)}`
}

const TOKEN_KEY = 'gestapp_token'

/** Guarda el JWT en localStorage (para iOS Safari que bloquea cookies cross-origin) */
export function saveToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem(TOKEN_KEY, token)
}
/** Limpia el JWT del localStorage al hacer logout */
export function clearToken() {
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY)
}
function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Wrapper de `fetch` contra la API propia (Fastify). Siempre manda
 * `credentials: 'include'` — la sesión viaja en una cookie httpOnly, no en
 * un header que tengamos que manejar nosotros.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // OJO: solo mandamos `Content-Type: application/json` cuando en verdad hay
  // un body — Fastify rechaza con "Body cannot be empty when content-type is
  // set to 'application/json'" si declaramos JSON pero el request (p.ej. los
  // `DELETE` de eliminarCategoria/eliminarProducto/etc., que no mandan body)
  // va vacío.
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    // `no-store` evita que el navegador/Service Worker sirvan respuestas
    // viejas en GETs idempotentes — crítico para el dashboard de IG, donde
    // tras un refresh queremos releer datos frescos y no la copia cacheada.
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      // Enviar como Bearer header además de cookie — resuelve iOS Safari ITP
      // que bloquea cookies cross-origin (vercel.app → onrender.com)
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new ApiError(body?.message ?? body?.error ?? `Error ${res.status} al llamar ${path}`, res.status)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  login: (email: string, password: string) =>
    request<{ usuario: Usuario; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ status: string }>('/auth/logout', { method: 'POST' }),

  me: () => request<{ usuario: Usuario; tenant: TenantDeSesion | null }>('/auth/me'),

  listarUsuarios: () => request<{ usuarios: Usuario[] }>('/admin/usuarios'),

  crearUsuario: (data: { email: string; password: string; nombre: string; rol: Usuario['rol']; tenantId?: string | null }) =>
    request<{ usuario: Usuario }>('/admin/usuarios', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarUsuario: (id: string, data: Partial<{ nombre: string; rol: Usuario['rol']; status: Usuario['status']; password: string }>) =>
    request<{ usuario: Usuario }>(`/admin/usuarios/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarUsuario: (id: string) =>
    request<{ status: string }>(`/admin/usuarios/${id}`, { method: 'DELETE' }),

  listarTenants: () => request<{ tenants: Tenant[] }>('/admin/tenants'),

  crearTenant: (data: { name: string; slug: string; plan?: PlanId }) =>
    request<{ tenant: Tenant }>('/admin/tenants', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  obtenerConfigEmpresa: () =>
    request<{ nombreDisplay: string | null; slogan: string | null }>('/tenant/config-empresa'),

  actualizarConfigEmpresa: (data: { nombreDisplay?: string | null; slogan?: string | null }) =>
    request<{ nombreDisplay: string | null; slogan: string | null }>('/tenant/config-empresa', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // --- Inventario (opera sobre el schema del tenant del usuario logueado) ---

  listarCategorias: () => request<{ categorias: Categoria[] }>('/inventario/categorias'),

  crearCategoria: (data: { nombre: string }) =>
    request<{ categoria: Categoria }>('/inventario/categorias', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarCategoria: (id: string, data: { nombre: string }) =>
    request<{ categoria: Categoria }>(`/inventario/categorias/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarCategoria: (id: string) =>
    request<void>(`/inventario/categorias/${id}`, { method: 'DELETE' }),

  listarProductos: () => request<{ productos: Producto[] }>('/inventario/productos'),

  crearProducto: (data: {
    sku?: string
    nombre: string
    descripcion?: string
    categoriaId?: string | null
    precioCosto?: number | null
    precioVenta?: number | null
    unidad?: string
    stockMinimo?: number
    stockInicial?: number
  }) =>
    request<{ producto: Producto }>('/inventario/productos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarProducto: (
    id: string,
    data: Partial<{
      sku: string
      nombre: string
      descripcion: string
      categoriaId: string | null
      precioCosto: number | null
      precioVenta: number | null
      unidad: string
      stockMinimo: number
      activo: boolean
    }>,
  ) =>
    request<{ producto: Producto }>(`/inventario/productos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarProducto: (id: string) =>
    request<void>(`/inventario/productos/${id}`, { method: 'DELETE' }),

  listarMovimientosInventario: () => request<{ movimientos: MovimientoInventario[] }>('/inventario/movimientos'),

  crearMovimientoInventario: (data: {
    productoId: string
    tipo: MovimientoInventario['tipo']
    cantidad: number
    precioUnitario?: number | null
    notas?: string
  }) =>
    request<{ movimiento: MovimientoInventario }>('/inventario/movimientos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // --- Clientes ---

  listarClientes: () => request<{ clientes: Cliente[] }>('/clientes'),

  crearCliente: (data: { nombre: string; nit?: string; email?: string; telefono?: string; direccion?: string; ciudad?: string }) =>
    request<{ cliente: Cliente }>('/clientes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarCliente: (
    id: string,
    data: Partial<{ nombre: string; nit: string | null; email: string | null; telefono: string | null; direccion: string | null; ciudad: string | null; activo: boolean }>,
  ) =>
    request<{ cliente: Cliente }>(`/clientes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarCliente: (id: string) =>
    request<void>(`/clientes/${id}`, { method: 'DELETE' }),

  // --- Pedidos (operan sobre el schema del tenant del usuario logueado) ---

  listarPedidos: () => request<{ pedidos: Pedido[] }>('/pedidos'),

  crearPedido: (data: {
    clienteId?: string | null
    notas?: string
    items: (
      | { productoId: string; cantidad: number; precioUnitario?: number }
      | { concepto: string; cantidad: number; precioUnitario: number }
    )[]
  }) =>
    request<{ pedido: Pedido }>('/pedidos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  transicionarPedido: (id: string, estado: EstadoPedido) =>
    request<{ pedido: Pedido }>(`/pedidos/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
    }),

  actualizarPedido: (id: string, data: Partial<{ clienteId: string | null; notas: string | null }>) =>
    request<{ pedido: Pedido }>(`/pedidos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarPedido: (id: string) =>
    request<void>(`/pedidos/${id}`, { method: 'DELETE' }),

  // --- CRM (proveedores + bitácora de interacciones) ---

  listarProveedores: () => request<{ proveedores: Proveedor[] }>('/proveedores'),

  crearProveedor: (data: { nombre: string; nit?: string; email?: string; telefono?: string; direccion?: string; contacto?: string }) =>
    request<{ proveedor: Proveedor }>('/proveedores', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarProveedor: (
    id: string,
    data: Partial<{ nombre: string; nit: string | null; email: string | null; telefono: string | null; direccion: string | null; contacto: string | null; activo: boolean }>,
  ) =>
    request<{ proveedor: Proveedor }>(`/proveedores/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarProveedor: (id: string) =>
    request<void>(`/proveedores/${id}`, { method: 'DELETE' }),

  listarNotasCrm: (entidadTipo: EntidadCrm, entidadId: string) =>
    request<{ notas: NotaCrm[] }>(`/crm/notas?entidadTipo=${entidadTipo}&entidadId=${entidadId}`),

  crearNotaCrm: (data: { entidadTipo: EntidadCrm; entidadId: string; nota: string }) =>
    request<{ nota: NotaCrm }>('/crm/notas', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // --- Finanzas (CxC/CxP + abonos — saldo y estado se calculan SIEMPRE en el servidor) ---

  listarFacturas: (tipo: TipoFactura) => request<{ facturas: Factura[] }>(`/finanzas/facturas?tipo=${tipo}`),

  crearFactura: (data: {
    tipo: TipoFactura
    clienteId?: string | null
    proveedorId?: string | null
    pedidoId?: string | null
    fechaVencimiento: string
    total: number
    notas?: string
  }) =>
    request<{ factura: Factura }>('/finanzas/facturas', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarFactura: (id: string, tipo: TipoFactura, data: Partial<{ fechaVencimiento: string; notas: string | null }>) =>
    request<{ factura: Factura }>(`/finanzas/facturas/${id}?tipo=${tipo}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarFactura: (id: string, tipo: TipoFactura) =>
    request<void>(`/finanzas/facturas/${id}?tipo=${tipo}`, { method: 'DELETE' }),

  listarAbonos: () => request<{ abonos: Abono[] }>('/finanzas/abonos'),

  crearAbono: (data: { facturaId: string; tipo: TipoFactura; monto: number; medioPago?: string; referencia?: string; cuentaBancariaId?: string }) =>
    request<{ abono: Abono }>('/finanzas/abonos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarAbono: (id: string, data: Partial<{ medioPago: string | null; referencia: string | null; fecha: string }>) =>
    request<{ abono: Abono }>(`/finanzas/abonos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarAbono: (id: string) =>
    request<void>(`/finanzas/abonos/${id}`, { method: 'DELETE' }),

  // --- Cuentas bancarias (reales — antes hardcodeadas como INITIAL_BANK_ACCOUNTS) ---

  listarCuentasBancarias: () => request<{ cuentas: CuentaBancaria[] }>('/finanzas/cuentas'),

  crearCuentaBancaria: (data: { banco: string; numero: string; tipo?: TipoCuentaBancaria; saldo?: number }) =>
    request<{ cuenta: CuentaBancaria }>('/finanzas/cuentas', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarCuentaBancaria: (id: string, data: Partial<{ banco: string; numero: string; tipo: TipoCuentaBancaria; saldo: number }>) =>
    request<{ cuenta: CuentaBancaria }>(`/finanzas/cuentas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarCuentaBancaria: (id: string) =>
    request<void>(`/finanzas/cuentas/${id}`, { method: 'DELETE' }),

  // --- Comunicaciones (calendario/planner: notas, recordatorios y posts planeados) ---

  listarEventosCalendario: (rango?: { desde?: string; hasta?: string }) => {
    const params = new URLSearchParams()
    if (rango?.desde) params.set('desde', rango.desde)
    if (rango?.hasta) params.set('hasta', rango.hasta)
    const query = params.toString()
    return request<{ eventos: EventoCalendario[] }>(`/comunicaciones/eventos${query ? `?${query}` : ''}`)
  },

  crearEventoCalendario: (data: {
    tipo: TipoEventoCalendario
    titulo: string
    descripcion?: string
    fecha: string
    canal?: 'instagram' | 'facebook' | 'tiktok' | null
    estado?: EstadoEventoCalendario
  }) =>
    request<{ evento: EventoCalendario }>('/comunicaciones/eventos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarEventoCalendario: (
    id: string,
    data: Partial<{
      titulo: string
      descripcion: string | null
      fecha: string
      canal: 'instagram' | 'facebook' | 'tiktok' | null
      estado: EstadoEventoCalendario
    }>,
  ) =>
    request<{ evento: EventoCalendario }>(`/comunicaciones/eventos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarEventoCalendario: (id: string) =>
    request<void>(`/comunicaciones/eventos/${id}`, { method: 'DELETE' }),

  // --- Pedidos a proveedores (órdenes de compra + CxP automática) ---

  listarCompras: () => request<{ pedidos: PedidoProveedor[] }>('/compras'),

  crearCompra: (data: {
    proveedorId?: string | null
    fechaEsperada?: string
    notas?: string
    totalManual?: number
    items: (
      | { productoId: string; cantidad: number; precioUnitario?: number }
      | { concepto: string; cantidad: number; precioUnitario?: number }
    )[]
  }) =>
    request<{ pedido: PedidoProveedor }>('/compras', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarCompra: (
    id: string,
    data: Partial<{
      proveedorId: string | null
      fechaEsperada: string | null
      notas: string | null
      items: (
        | { productoId: string; cantidad: number; precioUnitario?: number }
        | { concepto: string; cantidad: number; precioUnitario?: number }
      )[]
    }>,
  ) =>
    request<{ pedido: PedidoProveedor }>(`/compras/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  transicionarCompra: (
    id: string,
    estado: EstadoPedidoProveedor,
    opts?: { fechaVencimientoCxP?: string; cantidades?: { itemId: string; cantidadRecibida: number }[] },
  ) =>
    request<{ pedido: PedidoProveedor }>(`/compras/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado, ...opts }),
    }),

  listarIngresos: () =>
    request<{ ingresos: IngresoBancario[] }>('/finanzas/ingresos'),

  crearIngreso: (data: {
    descripcion: string
    categoria: CategoriaIngreso
    monto: number
    fecha?: string
    medioPago?: string
    cuentaBancariaId: string
    notas?: string
  }) =>
    request<{ ingreso: IngresoBancario }>('/finanzas/ingresos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  eliminarIngreso: (id: string) =>
    request<void>(`/finanzas/ingresos/${id}`, { method: 'DELETE' }),

  resumenFinanciero: (desde?: string, hasta?: string) => {
    const params = new URLSearchParams()
    if (desde) params.set('desde', desde)
    if (hasta) params.set('hasta', hasta)
    const qs = params.toString()
    return request<{ resumen: ResumenFinanciero }>(`/finanzas/resumen${qs ? `?${qs}` : ''}`)
  },

  eliminarCompra: (id: string) =>
    request<void>(`/compras/${id}`, { method: 'DELETE' }),

  // --- Notas internas (módulo de Comunicaciones) ---

  listarNotasInternas: () => request<{ notas: NotaInterna[] }>('/comunicaciones/notas'),

  crearNotaInterna: (data: { titulo: string; tipoContenido?: 'texto' | 'lista'; contenido?: string; tieneCheckbox?: boolean }) =>
    request<{ nota: NotaInterna }>('/comunicaciones/notas', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  actualizarNotaInterna: (id: string, data: Partial<{ titulo: string; tipoContenido: 'texto' | 'lista'; contenido: string | null; tieneCheckbox: boolean; completada: boolean; orden: number }>) =>
    request<{ nota: NotaInterna }>(`/comunicaciones/notas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  eliminarNotaInterna: (id: string) =>
    request<void>(`/comunicaciones/notas/${id}`, { method: 'DELETE' }),

  // --- Transferencias bancarias ---

  listarTransferencias: () => request<{ transferencias: TransferenciaBancaria[] }>('/finanzas/transferencias'),

  crearTransferencia: (data: { cuentaOrigenId: string; cuentaDestinoId: string; monto: number; descripcion?: string; fecha?: string }) =>
    request<{ transferencia: TransferenciaBancaria; cuentas: CuentaBancaria[] }>('/finanzas/transferencias', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // --- Gastos operativos ---

  listarGastos: () => request<{ gastos: GastoOperativo[] }>('/finanzas/gastos'),

  crearGasto: (data: { descripcion: string; categoria?: CategoriaGasto; monto: number; fecha?: string; medioPago?: string; cuentaBancariaId?: string; notas?: string }) =>
    request<{ gasto: GastoOperativo }>('/finanzas/gastos', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  eliminarGasto: (id: string) => request<void>(`/finanzas/gastos/${id}`, { method: 'DELETE' }),

  // --- Redes Sociales (Instagram via Apify) ---

  igCuenta: () =>
    request<{ cuenta: IgCuenta | null }>('/redes/ig/cuenta'),

  igVincularCuenta: (handle: string) =>
    request<{ cuenta: { id: string; handle: string; displayName: string | null }; mensaje: string }>(
      '/redes/ig/cuenta',
      { method: 'POST', body: JSON.stringify({ handle }) },
    ),

  igDesvincularCuenta: () =>
    request<void>('/redes/ig/cuenta', { method: 'DELETE' }),

  igResumen: (dias = 30) =>
    request<{ resumen: IgResumen | null }>(`/redes/ig/resumen?dias=${dias}`),

  igSeguidores: (dias = 90) =>
    request<{ serie: IgSnapshotPerfil[] }>(`/redes/ig/seguidores?dias=${dias}`),

  igPosts: (opts?: { limit?: number; order?: 'engagement' | 'fecha' }) => {
    const p = new URLSearchParams()
    if (opts?.limit) p.set('limit', String(opts.limit))
    if (opts?.order) p.set('order', opts.order)
    return request<{ posts: IgPost[] }>(`/redes/ig/posts?${p}`)
  },

  igPostDetalle: (id: string) =>
    request<{ post: IgPostDetalle; serie: IgPostSnapshot[] }>(`/redes/ig/posts/${id}`),

  igComentarios: (postId: string, opts?: { page?: number; filter?: 'todos' | 'sin-responder' | 'preguntas' }) => {
    const p = new URLSearchParams()
    if (opts?.page) p.set('page', String(opts.page))
    if (opts?.filter) p.set('filter', opts.filter)
    return request<{ comentarios: IgComentario[]; page: number; porPagina: number }>(
      `/redes/ig/posts/${postId}/comentarios?${p}`,
    )
  },

  igHashtags: (dias = 30) =>
    request<{ hashtags: IgHashtagStat[] }>(`/redes/ig/hashtags?dias=${dias}`),

  igMejoresHoras: (dias = 90) =>
    request<{ heatmap: IgHeatmapPunto[]; disclaimer: string | null }>(`/redes/ig/mejores-horas?dias=${dias}`),

  igRefresh: () =>
    request<{ ok: boolean; async?: boolean; mensaje?: string; postsActualizados?: number; comentariosActualizados?: number }>(
      '/redes/ig/refresh',
      { method: 'POST' },
    ),

  igRefreshStatus: () =>
    request<{
      run: {
        id: string
        trigger: 'cron' | 'manual' | 'backfill'
        status: 'running' | 'succeeded' | 'failed'
        startedAt: string
        finishedAt: string | null
        itemsCount: number | null
        errorMessage: string | null
      } | null
    }>('/redes/ig/refresh-status'),

  igRuns: (limit = 10) =>
    request<{ runs: IgRun[] }>(`/redes/ig/runs?limit=${limit}`),

  // --- Papelera / deshacer (genérico para todos los módulos) ---

  listarPapelera: () => request<{ items: ItemPapelera[] }>('/papelera'),

  restaurarDePapelera: (entidad: string, id: string) =>
    request<{ status: string }>('/papelera/restaurar', {
      method: 'POST',
      body: JSON.stringify({ entidad, id }),
    }),

  // --- Perfil propio (autoservicio: personalización de UI) ---

  actualizarPerfil: (data: { colorSecundario: string | null }) =>
    request<{ usuario: Usuario }>('/auth/perfil', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // --- AI -------------------------------------------------------------------

  aiChat: (messages: { role: 'user' | 'assistant'; content: string }[], context = 'general') =>
    request<{ response: string; actions: { tool: string; result: unknown }[] }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, context }),
    }),

  aiNotas: (texto: string, instruccion: 'mejorar' | 'formal' | 'resumir' | 'bullet' | 'custom', customPrompt?: string) =>
    request<{ resultado: string }>('/ai/notas', {
      method: 'POST',
      body: JSON.stringify({ texto, instruccion, customPrompt }),
    }),

  // --- Reportes (resumen periódico + análisis IA) ----------------------------

  reportesOverview: (tipo: 'meses' | 'semanas', año: number) =>
    request<{
      tipo: 'meses' | 'semanas'
      año: number
      periodos: Array<{
        label: string
        desde: string
        hasta: string
        mes?: number
        semana?: number
        año: number
        pedidos: number
        ventas: number
        gastos: number
        gananciaAprox: number
        tieneDatos: boolean
      }>
    }>(`/reportes/overview?tipo=${tipo}&año=${año}`),

  reportesPeriodo: (año: number, mes: number) => {
    const p = new URLSearchParams({ tipo: 'mes', año: String(año), mes: String(mes) })
    return request<Record<string, unknown>>(`/reportes/periodo?${p}`)
  },

  reportesPeriodoRango: (desde: string, hasta: string, label: string) => {
    const p = new URLSearchParams({ desde, hasta, label })
    return request<Record<string, unknown>>(`/reportes/periodo?${p}`)
  },

  reportesIA: (tipo: 'meses' | 'semanas', año: number, mes?: number, semana?: number) => {
    const p = new URLSearchParams({ tipo, año: String(año) })
    if (mes !== undefined) p.set('mes', String(mes))
    if (semana !== undefined) p.set('semana', String(semana))
    return request<{ analisis: string; postsAnalizados: number; guardado?: boolean }>(`/reportes/ia?${p}`)
  },

  reportesAnalisisGuardado: (desde: string, hasta: string) =>
    request<{ analisis: string | null; postsAnalizados?: number; generadoEn?: string }>(
      `/reportes/analisis-guardado?desde=${desde}&hasta=${hasta}`
    ),

  reportesTopClientes: (desde: string, hasta: string) => {
    const p = new URLSearchParams({ desde, hasta })
    return request<{
      periodo: { label: string; desde: string; hasta: string }
      clientes: Array<{ clienteId: string; nombre: string; pedidos: number; ventas: number; saldoPendiente: number }>
    }>(`/reportes/top-clientes?${p}`)
  },

  reportesCalor: (desde: string, hasta: string) => {
    const p = new URLSearchParams({ desde, hasta })
    return request<{
      periodo: { label: string }
      pedidos: Array<{ dow: number; hour: number; cantidad: number }>
      igPosts: Array<{ dow: number; hour: number; tipo: string; cantidad: number }>
    }>(`/reportes/calor?${p}`)
  },

  reportesSemanasComparacion: (año: number, semanas: number[]) =>
    request<{
      año: number
      semanas: Array<{
        semana: number; label: string; desde: string; hasta: string
        pedidos: number; ventas: number; gastos: number; margenBruto: number
        topProducto: { nombre: string; ventas: number } | null
      }>
    }>(`/reportes/semanas-comparacion?año=${año}&semanas=${semanas.join(',')}`),
}
