-- CreateTable
CREATE TABLE "report_checkpoints" (
    "channel" VARCHAR(20) NOT NULL,
    "won" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "alerts_sent" INTEGER NOT NULL DEFAULT 0,
    "first_started_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_checkpoints_pkey" PRIMARY KEY ("channel")
);
