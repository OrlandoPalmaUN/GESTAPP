-- Migration 012: transferencias bancarias + gastos operativos

CREATE TABLE transferencias_bancarias (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_origen_id  UUID NOT NULL REFERENCES cuentas_bancarias(id),
  cuenta_destino_id UUID NOT NULL REFERENCES cuentas_bancarias(id),
  monto             NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  descripcion       TEXT,
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_id        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT origen_distinto_destino CHECK (cuenta_origen_id <> cuenta_destino_id)
);

CREATE TABLE gastos_operativos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descripcion         TEXT NOT NULL,
  categoria           TEXT NOT NULL DEFAULT 'otros'
    CHECK (categoria IN ('arriendo','servicios','nomina','comisiones','marketing','otros')),
  monto               NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  medio_pago          TEXT,
  cuenta_bancaria_id  UUID REFERENCES cuentas_bancarias(id),
  notas               TEXT,
  usuario_id          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- Allow abonos to reference a bank account (optional — when set, the API
-- atomically deducts the monto from that account's saldo).
ALTER TABLE abonos ADD COLUMN IF NOT EXISTS cuenta_bancaria_id UUID REFERENCES cuentas_bancarias(id);
