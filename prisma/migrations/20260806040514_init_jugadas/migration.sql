-- CreateTable
CREATE TABLE "jugadas" (
    "id" BIGSERIAL NOT NULL,
    "uuid" UUID NOT NULL,
    "resultado" SMALLINT NOT NULL,
    "ganador" VARCHAR(20) NOT NULL,
    "jugada_en" TIMESTAMPTZ(3) NOT NULL,
    "payload_original" JSONB,
    "insertado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jugadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jugadas_uuid_key" ON "jugadas"("uuid");

-- CreateIndex
CREATE INDEX "jugadas_jugada_en_idx" ON "jugadas"("jugada_en" DESC);

-- CreateIndex
CREATE INDEX "jugadas_ganador_jugada_en_idx" ON "jugadas"("ganador", "jugada_en");
