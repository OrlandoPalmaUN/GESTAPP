-- CreateTable
CREATE TABLE "apify_scrape_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "apify_run_id" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "items_count" INTEGER,
    "apify_usage_usd" DECIMAL(10,4),
    "error_message" TEXT,

    CONSTRAINT "apify_scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apify_scrape_runs_tenant_id_started_at_idx" ON "apify_scrape_runs"("tenant_id", "started_at");
