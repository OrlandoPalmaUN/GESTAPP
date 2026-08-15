'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Diálogo accesible, para reemplazar los ~30 overlays sueltos de `page.tsx`.
 *
 * Lo que faltaba en todos ellos:
 * - `role="dialog"` / `aria-modal` — no había ni uno solo.
 * - Cerrar con ESC.
 * - Trampa de foco: con Tab se salía del modal hacia la página de atrás.
 * - Devolver el foco al elemento que abrió el modal al cerrarlo.
 * - Guarda de cambios sin guardar: el cierre por clic en el fondo era
 *   inconsistente (4 de 32 modales) y donde existía perdía lo escrito en
 *   silencio — el caso real era el textarea de notas del Gestor de Pedido,
 *   donde escribías tres líneas de instrucciones de entrega, tocabas un poco
 *   afuera y desaparecían.
 */
export function Modal({
  open,
  onClose,
  titulo,
  children,
  footer,
  /** Ancho máximo del panel. */
  maxWidth = 'max-w-lg',
  /**
   * Cuando es `true`, cerrar por ESC o por el fondo pide confirmación.
   * Pasá acá tu estado "el formulario tiene cambios sin guardar".
   */
  hayCambiosSinGuardar = false,
}: {
  open: boolean;
  onClose: () => void;
  titulo: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  hayCambiosSinGuardar?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const abridorRef = useRef<HTMLElement | null>(null);

  const intentarCerrar = useCallback(() => {
    if (hayCambiosSinGuardar) {
      const ok = window.confirm('Tenés cambios sin guardar. ¿Cerrar y perderlos?');
      if (!ok) return;
    }
    onClose();
  }, [hayCambiosSinGuardar, onClose]);

  // Recordar quién abrió el modal para devolverle el foco al cerrar.
  useEffect(() => {
    if (open) {
      abridorRef.current = document.activeElement as HTMLElement | null;
      // Enfocar el panel para que ESC y Tab funcionen sin tocar nada primero.
      requestAnimationFrame(() => panelRef.current?.focus());
    } else if (abridorRef.current) {
      abridorRef.current.focus?.();
      abridorRef.current = null;
    }
  }, [open]);

  // ESC para cerrar y Tab que no se escapa del diálogo.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        intentarCerrar();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const primero = focusables[0]!;
      const ultimo = focusables[focusables.length - 1]!;

      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, intentarCerrar]);

  // Evitar que la página de atrás siga scrolleando bajo el modal.
  useEffect(() => {
    if (!open) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previo; };
  }, [open]);

  if (!open) return null;

  const tituloId = `modal-titulo-${titulo.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) intentarCerrar(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={`neo-card bg-white w-full ${maxWidth} flex flex-col gap-4 relative max-h-[90vh] overflow-y-auto outline-none`}
      >
        <div className="flex justify-between items-center border-b border-black pb-2 sticky top-0 bg-white z-10">
          <h3 id={tituloId} className="font-mono text-sm font-bold text-black">{titulo}</h3>
          <button
            type="button"
            onClick={intentarCerrar}
            className="neo-btn p-2 hover:bg-neutral-50"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {children}

        {footer}
      </div>
    </div>
  );
}
