-- pgvector lives in `public` so the `vector` type resolves under any connection
-- search_path (the test harness runs each Jest worker in its own schema).
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" public.vector(1024) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentChunk_userId_idx" ON "DocumentChunk"("userId");
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");
CREATE INDEX "DocumentChunk_embedding_idx" ON "DocumentChunk" USING hnsw ("embedding" public.vector_cosine_ops);

ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
