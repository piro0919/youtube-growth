-- AlterTable
ALTER TABLE "Analysis" ADD COLUMN     "modelType" TEXT DEFAULT 'gpt-4-turbo',
ADD COLUMN     "videoCount" INTEGER DEFAULT 25;
