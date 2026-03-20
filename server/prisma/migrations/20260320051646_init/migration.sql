-- CreateTable
CREATE TABLE "Repository" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "githubUrl" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT,
    "totalApis" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastScanned" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" SERIAL NOT NULL,
    "repoId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "totalApis" INTEGER NOT NULL DEFAULT 0,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastScanned" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiEndpoint" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "optionalFields" JSONB NOT NULL DEFAULT '[]',
    "responseFields" JSONB NOT NULL DEFAULT '[]',
    "rawDefinition" TEXT NOT NULL DEFAULT '',
    "yamlContent" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictSession" (
    "id" SERIAL NOT NULL,
    "repoId" INTEGER NOT NULL,
    "mainBranchId" INTEGER NOT NULL,
    "branchIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConflictSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conflict" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "mainValue" TEXT NOT NULL DEFAULT '',
    "branchValue" TEXT NOT NULL DEFAULT '',
    "impactLevel" TEXT NOT NULL,
    "resolution" TEXT,
    "lineMain" INTEGER NOT NULL DEFAULT 0,
    "lineBranch" INTEGER NOT NULL DEFAULT 0,
    "branchName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unresolved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossBranchScenario" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "scenarioType" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL DEFAULT '',
    "affectedEndpoint" TEXT NOT NULL DEFAULT '',
    "involvedBranches" JSONB NOT NULL,
    "popupRequired" BOOLEAN NOT NULL DEFAULT true,
    "autoResolved" BOOLEAN NOT NULL DEFAULT false,
    "chosenOption" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossBranchScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_repoId_name_key" ON "Branch"("repoId", "name");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiEndpoint" ADD CONSTRAINT "ApiEndpoint_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictSession" ADD CONSTRAINT "ConflictSession_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conflict" ADD CONSTRAINT "Conflict_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConflictSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossBranchScenario" ADD CONSTRAINT "CrossBranchScenario_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConflictSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
