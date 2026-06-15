-- AlterEnum
ALTER TYPE "DmStatus" ADD VALUE 'WELCOME_SENT';

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "followCheckEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followCheckMessage" TEXT,
ADD COLUMN     "welcomeButtonText" TEXT,
ADD COLUMN     "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "welcomeImageUrl" TEXT,
ADD COLUMN     "welcomeMessage" TEXT;
