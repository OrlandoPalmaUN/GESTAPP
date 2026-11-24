-- CreateTable
CREATE TABLE "tenant_whatsapp_numbers" (
    "phone_number_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "waba_id" TEXT,
    "display_number" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_whatsapp_numbers_pkey" PRIMARY KEY ("phone_number_id")
);

-- CreateIndex
CREATE INDEX "tenant_whatsapp_numbers_tenant_id_idx" ON "tenant_whatsapp_numbers"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_whatsapp_numbers" ADD CONSTRAINT "tenant_whatsapp_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
