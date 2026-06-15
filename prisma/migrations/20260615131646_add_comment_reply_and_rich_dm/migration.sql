-- CreateEnum
CREATE TYPE "DmMessageType" AS ENUM ('TEXT', 'CARD', 'CAROUSEL');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "commentReplies" TEXT[],
ADD COLUMN     "commentReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dmMessagePayload" JSONB,
ADD COLUMN     "dmMessageType" "DmMessageType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "followCheckButtonText" TEXT;
