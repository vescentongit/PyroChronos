CREATE TABLE "InspectionReport" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "result" TEXT NOT NULL,
  "notes" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InspectionReport_requestId_key" ON "InspectionReport"("requestId");
CREATE INDEX "InspectionReport_candidateId_createdAt_idx" ON "InspectionReport"("candidateId", "createdAt");
