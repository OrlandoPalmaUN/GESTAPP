/**
 * Política de privacidad — página PÚBLICA.
 *
 * Existe por dos razones y conviene no perder ninguna de vista:
 *  1. Meta exige una URL de política de privacidad para pasar la app de
 *     WhatsApp a modo Live. Sin esto el canal no recibe mensajes reales.
 *  2. Acá se tratan datos de terceros de verdad — los clientes de cada
 *     empresa, con teléfono y compras — así que la obligación existe sin
 *     importar lo que pida Meta.
 *
 * Es una página estática a propósito: sin sesión, sin llamadas al API y sin
 * nada que pueda fallar. Quien la lee puede ser un revisor de Meta con el
 * backend dormido.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de privacidad — GESTAPP',
  description:
    'Qué datos trata GESTAPP, para qué, con quién se comparten y cómo ejercer tus derechos.',
}

/**
 * Canal por el que una persona ejerce sus derechos sobre sus datos. Tiene que
 * ser una dirección que alguien lea de verdad: si no, la política queda sin
 * efecto práctico. Cambiarla acá y no en diez lugares del texto.
 */
const CORREO_CONTACTO = 'orlandoandrespalma@gmail.com'

/** Fecha de la última revisión del texto. Actualizar cuando cambie el fondo. */
const ULTIMA_ACTUALIZACION = '23 de noviembre de 2026'

function Seccion({ n, titulo, children }: { n: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-mono font-black text-sm tracking-tight mb-3 flex items-center gap-2">
        <span className="bg-black text-white px-2 py-0.5">{n}</span>
        <span className="uppercase">{titulo}</span>
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-neutral-800">{children}</div>
    </section>
  )
}

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-white blueprint-grid py-12 px-4 font-sans">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8">
          <span className="font-mono font-black text-2xl tracking-tighter bg-black text-white px-3 py-1.5 select-none inline-block">
            {'// GESTAPP'}
          </span>
        </div>

        <div className="neo-card bg-white p-0 overflow-hidden">
          <div className="bg-black text-white p-5 border-b-2 border-black">
            <h1 className="font-mono font-black text-lg tracking-tight">POLÍTICA DE PRIVACIDAD</h1>
            <p className="font-mono text-xs mt-1 opacity-70">
              Última actualización: {ULTIMA_ACTUALIZACION}
            </p>
          </div>

          <div className="p-6 sm:p-8">
            <p className="text-[15px] leading-relaxed text-neutral-800 mb-10">
              GESTAPP es una herramienta de gestión operativa para pequeñas y medianas empresas:
              inventario, pedidos, clientes, finanzas y comunicaciones. Cada empresa que usa GESTAPP
              decide qué información carga; nosotros la guardamos y la procesamos para que la
              empresa pueda operar. Este documento explica qué datos son, qué hacemos con ellos y
              qué podés pedirnos.
            </p>

            <Seccion n="01" titulo="Quién responde por los datos">
              <p>
                Cada empresa que usa GESTAPP es responsable de los datos de sus propios clientes:
                decide qué carga, para qué los usa y por cuánto tiempo. GESTAPP actúa como
                encargado del tratamiento — los guardamos y procesamos siguiendo las instrucciones
                de esa empresa, y no los usamos para fines propios.
              </p>
            </Seccion>

            <Seccion n="02" titulo="Qué datos tratamos">
              <p><strong>De quien usa la plataforma:</strong> nombre, correo, contraseña (guardada cifrada, nunca en texto plano), rol y fecha del último ingreso.</p>
              <p><strong>De los clientes y proveedores de cada empresa:</strong> nombre, identificación tributaria, teléfono, correo, dirección y el historial comercial — pedidos, facturas, pagos y saldos.</p>
              <p><strong>De la operación:</strong> productos, inventario, compras, gastos, ingresos, cuentas bancarias, notas y eventos de calendario.</p>
              <p><strong>De WhatsApp:</strong> si la empresa activa el canal, guardamos los mensajes intercambiados con su número de WhatsApp Business, el número de quien escribe y el nombre de perfil que WhatsApp informa. Sirven para dar contexto a la conversación y para que la empresa tenga el historial.</p>
              <p><strong>De Instagram:</strong> si la empresa conecta su cuenta, guardamos métricas y publicaciones <em>públicas</em> de su propio perfil. No accedemos a mensajes privados ni a datos de los seguidores.</p>
              <p><strong>De auditoría:</strong> registramos quién creó, modificó o eliminó cada dato, y cuándo. Es lo que permite a la empresa saber qué pasó con su información.</p>
            </Seccion>

            <Seccion n="03" titulo="Para qué los usamos">
              <p>
                Únicamente para prestar el servicio: mostrar la información, calcular saldos y
                costos, generar reportes, enviar y recibir mensajes por los canales que la empresa
                configure, y mantener la trazabilidad de los cambios. No vendemos datos, no los
                cedemos a terceros con fines comerciales y no los usamos para publicidad.
              </p>
            </Seccion>

            <Seccion n="04" titulo="El asistente de inteligencia artificial">
              <p>
                GESTAPP incluye un asistente que responde preguntas y registra operaciones por
                indicación de quien lo usa. Para funcionar, le enviamos al proveedor del modelo el
                texto de la conversación y un resumen del negocio: nombres de productos, totales de
                ventas, nombres de clientes recientes y saldos. No le enviamos contraseñas,
                credenciales ni la base de datos completa.
              </p>
              <p>
                Los proveedores que usamos para esto son <strong>Groq</strong> y{' '}
                <strong>Google (Gemini)</strong>, según disponibilidad. El asistente puede crear y
                modificar registros, y cada acción queda en la auditoría a nombre de la persona que
                se la pidió.
              </p>
            </Seccion>

            <Seccion n="05" titulo="Con quién se comparten">
              <p>Solo con los proveedores de infraestructura necesarios para que el servicio funcione:</p>
              <ul className="list-none space-y-1.5 font-mono text-[13px]">
                <li>▸ <strong>Neon</strong> — base de datos (PostgreSQL, Estados Unidos)</li>
                <li>▸ <strong>Render</strong> — servidor de la aplicación</li>
                <li>▸ <strong>Vercel</strong> — sitio web</li>
                <li>▸ <strong>Meta</strong> — mensajería de WhatsApp Business, si la empresa la activa</li>
                <li>▸ <strong>Groq</strong> y <strong>Google</strong> — modelos del asistente</li>
                <li>▸ <strong>Apify</strong> — lectura de métricas públicas de Instagram, si se activa</li>
              </ul>
              <p>
                Esto implica que los datos se almacenan y procesan en servidores fuera de Colombia.
                Al usar GESTAPP, la empresa autoriza esa transferencia internacional.
              </p>
            </Seccion>

            <Seccion n="06" titulo="Cómo los protegemos">
              <p>
                Los datos de cada empresa viven en un espacio separado dentro de la base de datos,
                de modo que una empresa no puede ver los datos de otra. El acceso exige iniciar
                sesión; las contraseñas se guardan cifradas y las sesiones usan cookies que el
                navegador no expone a scripts. Las comunicaciones viajan cifradas (HTTPS), y los
                mensajes que entran desde WhatsApp se validan criptográficamente antes de
                procesarse.
              </p>
              <p>
                Ningún sistema es infalible. Si ocurriera un incidente que afecte datos
                personales, se lo informaremos a las empresas afectadas.
              </p>
            </Seccion>

            <Seccion n="07" titulo="Cuánto tiempo los conservamos">
              <p>
                Mientras la empresa mantenga su cuenta activa. Lo que se elimina desde la
                aplicación va primero a una papelera, de donde puede recuperarse; al vaciarla, se
                borra. Si una empresa cierra su cuenta, eliminamos sus datos salvo lo que debamos
                conservar por obligación legal o contable.
              </p>
            </Seccion>

            <Seccion n="08" titulo="Tus derechos">
              <p>
                Conforme a la Ley 1581 de 2012 y sus decretos reglamentarios, cualquier persona
                puede conocer, actualizar y rectificar sus datos, pedir prueba de la autorización
                otorgada, ser informada sobre el uso que se les ha dado, revocar la autorización o
                solicitar su supresión cuando no exista un deber legal de conservarlos, y presentar
                quejas ante la Superintendencia de Industria y Comercio.
              </p>
              <p>
                Si tus datos están en GESTAPP porque le comprás a una empresa que usa la
                plataforma, el primer canal es esa empresa, que es quien decide sobre ellos.
                También podés escribirnos y te ayudamos a canalizar la solicitud.
              </p>
            </Seccion>

            <Seccion n="09" titulo="Cambios y contacto">
              <p>
                Si cambiamos esta política, actualizaremos la fecha del encabezado y, cuando el
                cambio sea relevante, lo avisaremos dentro de la aplicación.
              </p>
              <p>
                Para cualquier solicitud sobre datos personales:{' '}
                <a
                  className="font-mono font-bold underline decoration-2 underline-offset-2"
                  href={`mailto:${CORREO_CONTACTO}`}
                >
                  {CORREO_CONTACTO}
                </a>
              </p>
            </Seccion>
          </div>
        </div>

        <p className="font-mono text-[11px] text-neutral-500 mt-6 text-center">
          GESTAPP · Gestión operativa para PYMEs
        </p>
      </div>
    </main>
  )
}
