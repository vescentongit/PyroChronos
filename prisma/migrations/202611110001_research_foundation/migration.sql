-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "AnalysisArea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "geometryHash" TEXT NOT NULL,
    "areaKm2" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchDataset" (
    "id" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "analysisKey" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "error" JSONB,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisAttempt" (
    "runId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "AnalysisAttempt_pkey" PRIMARY KEY ("runId","attempt")
);

-- CreateTable
CREATE TABLE "ResearchRequest" (
    "scope" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchRequest_pkey" PRIMARY KEY ("scope","requestId")
);

-- CreateTable
CREATE TABLE "AnalysisArtifact" (
    "runId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "manifest" JSONB NOT NULL,
    "days" JSONB NOT NULL,

    CONSTRAINT "AnalysisArtifact_pkey" PRIMARY KEY ("runId")
);

-- CreateTable
CREATE TABLE "ResearchObservation" (
    "runId" TEXT NOT NULL,
    "periodRole" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ResearchObservation_pkey" PRIMARY KEY ("runId","periodRole","ordinal")
);

-- CreateTable
CREATE TABLE "ResearchTile" (
    "runId" TEXT NOT NULL,
    "periodRole" TEXT NOT NULL,
    "z" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ResearchTile_pkey" PRIMARY KEY ("runId","periodRole","z","x","y")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Membership_userId_active_idx" ON "Membership"("userId", "active");

-- CreateIndex
CREATE INDEX "AnalysisArea_workspaceId_id_idx" ON "AnalysisArea"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AnalysisRun_workspaceId_analysisKey_createdAt_idx" ON "AnalysisRun"("workspaceId", "analysisKey", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_status_leaseUntil_createdAt_idx" ON "AnalysisRun"("status", "leaseUntil", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_workspaceId_actorId_requestId_key" ON "AnalysisJob"("workspaceId", "actorId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisAttempt_token_key" ON "AnalysisAttempt"("token");

-- CreateIndex
CREATE INDEX "ResearchObservation_runId_periodRole_longitude_latitude_idx" ON "ResearchObservation"("runId", "periodRole", "longitude", "latitude");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
